type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type ResponseWork={leadId:string;accountId:string;screeningId:string;smsMessageId:string|null;voiceJobId:string|null;status:string};
type Dispatch=(accountId:string,id:string)=>Promise<{status:string}>;
/** Immediate after-response attempt, with the existing cron as a durable fallback.
 * Only the database may bind a seller to a customer. No permission is inferred,
 * no provider outcome is retried, and SMS failure does not swallow voice work. */
export async function processSellerResponses(db:Database,dispatchText:Dispatch,dispatchVoice:Dispatch,leadId?:string){
 const work=await db<ResponseWork[]>('rpc/icash_prepare_seller_responses','POST',{p_lead:leadId??null});
 const results=[];
 for(const item of work){
  const outcome:{sms?:string;voice?:string}={};
  await Promise.all(([
   ['sms',item.smsMessageId,dispatchText],['voice',item.voiceJobId,dispatchVoice]
  ] as const).map(async([channel,id,dispatch])=>{
   if(!id)return;
   try{outcome[channel]=(await dispatch(item.accountId,id)).status;}
   catch{outcome[channel]='dispatch_requires_review';}
  }));
  // Conditional provider claims, rather than this status record, own delivery.
  // A bookkeeping timeout cannot reopen an operation or authorize a redial.
  if(Object.keys(outcome).length)await db('rpc/icash_note_seller_response','POST',{p_lead:item.leadId,p_account:item.accountId,p_outcome:outcome});
  results.push({leadId:item.leadId,status:item.status,...outcome});
 }
 return results;
}
