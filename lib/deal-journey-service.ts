type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type AssignmentClaim={id:string;accountId:string;dealId:string;userId:string;customerEmail:string;signerName:string;email:string;phone:string};
type SendInput={accountId:string;dealId:string;userId:string;customerEmail:string;kind:'assignment';signers:{name:string;email:string;phone:string}[];phoneLinkOnly:true};
type Dependencies={db:Database;send:(input:SendInput)=>Promise<{id:string}>;text:(account:string,envelope:string,phone:string)=>Promise<{sent:boolean}>;dispatch:(account:string,message:string)=>Promise<{status:string}>;title:(account:string,deal:string)=>Promise<{status:string}>};

/** No provider call is retried after uncertain completion. Transport failures
 * leave durable evidence for the workspace and the next read-only reconciliation. */
export async function processDealJourneys(d:Dependencies,env:Record<string,string|undefined>){
 if(env.VERCEL_ENV!=='production'||env.ICASH_LIVE_WORK_READY!=='true'||env.DOCUSEAL_MODE!=='live')return {status:'journey_held'};
 const ids=await d.db<string[]>('rpc/icash_due_journeys','POST',{});
 let assignments=0,titleChecked=false;
 for(const id of ids.slice(0,5)){
  try{
   await d.db('rpc/icash_advance_journey','POST',{p_id:id});
   if(assignments<1){
    const claim=await d.db<AssignmentClaim|null>('rpc/icash_claim_journey_assignment','POST',{p_id:id});
    if(claim){
     assignments++;
     try{
      const sent=await d.send({accountId:claim.accountId,dealId:claim.dealId,userId:claim.userId,customerEmail:claim.customerEmail,kind:'assignment',signers:[{name:claim.signerName,email:claim.email,phone:claim.phone}],phoneLinkOnly:true});
      await d.db(`icash_deal_journeys?id=eq.${id}&account_id=eq.${claim.accountId}&state=eq.sending`,'PATCH',{envelope_id:sent.id,state:'signing',last_progress_at:new Date().toISOString()});
      const delivery=await d.text(claim.accountId,sent.id,claim.phone);
      if(!delivery.sent)throw Error('Contract text not confirmed');
     }catch{
      await d.db(`icash_deal_journeys?id=eq.${id}&account_id=eq.${claim.accountId}`,'PATCH',{state:'needs_review',review_reason:'Assignment or contract text needs reconciliation. Review the existing request before sending again.'});
     }
    }
   }
   const [journey]=await d.db<{account_id:string;deal_id:string;state:string}[]>(`icash_deal_journeys?id=eq.${id}&select=account_id,deal_id,state`);
   if(journey&&!titleChecked&&['signing','deposit_due','reserved'].includes(journey.state)){
    titleChecked=true;
    if(await d.db<boolean>('rpc/icash_journey_allowed','POST',{p_account:journey.account_id,p_deal:journey.deal_id}))await d.title(journey.account_id,journey.deal_id);
   }
  }catch{
   // Keep other properties moving. A leased row becomes due again in five minutes.
  }
 }
 let messages=0;
 for(let n=0;n<2;n++){
  const m=await d.db<{accountId:string;messageId:string}|null>('rpc/icash_claim_journey_message','POST',{});
  if(m){await d.dispatch(m.accountId,m.messageId);messages++;}
 }
 return {status:'journey_processed',checked:ids.length,assignments,messages};
}
