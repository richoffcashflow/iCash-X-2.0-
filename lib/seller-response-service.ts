type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type ResponseWork={leadId:string;accountId:string;screeningId:string;smsMessageId:string|null;voiceJobId:string|null;status:string};
type Dispatch=(accountId:string,id:string)=>Promise<{status:string}>;
/** Immediate after-response attempt, with the existing cron as a durable fallback.
 * Only the database may bind saved seller consent to a matched customer;
 * no provider outcome is retried, and SMS failure does not swallow voice work. */
export async function processSellerResponses(db:Database,dispatchText:Dispatch,dispatchVoice:Dispatch,leadId?:string){
 const work=await db<ResponseWork[]>('rpc/icash_prepare_seller_responses','POST',{p_lead:leadId??null});
 const results=[];
 let receiptFailed=false;
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
  if(Object.keys(outcome).length){
   try{await db('rpc/icash_note_seller_response','POST',{p_lead:item.leadId,p_account:item.accountId,p_outcome:outcome});}
   catch{receiptFailed=true;}
  }
  results.push({leadId:item.leadId,status:item.status,...outcome});
 }
 // Report the failed checkpoint after independently admitted sellers progress.
 // Original channel claims own delivery; neither channel is repeated here.
 if(receiptFailed)throw Error('SELLER_RESPONSE_RECEIPT_PENDING');
 return results;
}
