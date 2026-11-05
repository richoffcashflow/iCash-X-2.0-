type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type AssignmentClaim={id:string;accountId:string;dealId:string;userId:string;customerEmail:string;signerName:string;email:string;phone:string};
type SendInput={accountId:string;dealId:string;userId:string;customerEmail:string;kind:'assignment';signers:{name:string;email:string;phone:string}[];phoneLinkOnly:true};
type Dependencies={db:Database;send:(input:SendInput)=>Promise<{id:string}>;text:(account:string,envelope:string,phone:string)=>Promise<{sent:boolean}>;dispatch:(account:string,message:string)=>Promise<{status:string}>;title:(account:string,deal:string)=>Promise<{status:string}>};

/** No provider call is retried after uncertain completion. Transport failures
 * leave durable evidence for the workspace and the next read-only reconciliation. */
export async function processDealJourneys(d:Dependencies,env:Record<string,string|undefined>){
 if(env.VERCEL_ENV!=='production'||env.ICASH_LIVE_WORK_READY!=='true'||env.DOCUSEAL_MODE!=='live')return {status:'journey_held'};
 let failures=0;
 const failed=(stage:string)=>{failures++;console.error('journey_step_failed',{stage});};
 let ids:string[]=[];
 try{ids=await d.db<string[]>('rpc/icash_due_journeys','POST',{});}
 catch{failed('journey_selection');}
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
      failed('assignment_delivery');
      // A late completion or cancellation owns its newer state. Preserve the
      // original signing request and never replay it to repair this checkpoint.
      await d.db(`icash_deal_journeys?id=eq.${id}&account_id=eq.${claim.accountId}&state=in.(sending,signing)`,'PATCH',{state:'needs_review',review_reason:'Assignment or contract text needs reconciliation. Review the existing request before sending again.'});
     }
    }
   }
   const [journey]=await d.db<{account_id:string;deal_id:string;state:string}[]>(`icash_deal_journeys?id=eq.${id}&select=account_id,deal_id,state`);
   if(journey&&!titleChecked&&['signing','deposit_due','reserved'].includes(journey.state)){
    if(await d.db<boolean>('rpc/icash_journey_allowed','POST',{p_account:journey.account_id,p_deal:journey.deal_id})){
     titleChecked=true;
     await d.title(journey.account_id,journey.deal_id);
    }
   }
  }catch{
   // Keep other properties moving. A leased row becomes due again in five minutes.
   failed('journey_progress');
  }
 }
 let messages=0,messageAttempts=0,heldMessages=0;
 const attempted=new Set<string>();
 for(let n=0;n<2;n++){
  let m:{accountId:string;messageId:string}|null;
  try{m=await d.db('rpc/icash_claim_journey_message','POST',{});}
  catch{failed('message_claim');break;}
  if(!m)continue;
  const key=m.accountId+':'+m.messageId;
  if(attempted.has(key)){failed('duplicate_message_claim');continue;}
  attempted.add(key);messageAttempts++;
  try{
   const result=await d.dispatch(m.accountId,m.messageId);
   if(['message_accepted','message_delivered'].includes(result.status))messages++;
   else{heldMessages++;if(result.status==='message_delivery_needs_review')failed('message_delivery');}
  }catch{
   // The database owns the original hold and the next fresh claim. A failure
   // for this recipient must not suppress the other independently admitted row.
   failed('message_dispatch');
  }
 }
 return {status:failures?'journey_processing_needs_review':'journey_processed',checked:Math.min(ids.length,5),assignments,messages,messageAttempts,heldMessages,failures};
}
