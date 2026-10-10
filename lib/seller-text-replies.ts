type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dispatch=(account:string,message:string)=>Promise<{status:string}>;
type Reply={accountId:string;messageId?:string;textAiJobId?:string;voiceJobId?:string};

/** Authenticated provider event only. The database binds the recipient, property,
 * exact reply and revision; ordinary dispatch still owns permission and spending. */
export async function replyToSellerText(db:Database,dispatch:Dispatch,eventId:string,processAi:Dispatch,dispatchVoice:Dispatch){
 const reply=await db<Reply|null>('rpc/icash_prepare_seller_text_event','POST',{p_event:eventId});
 if(!reply)return {status:'no_seller_reply'};
 if(reply.voiceJobId){
  const result=await dispatchVoice(reply.accountId,reply.voiceJobId);
  // Only the database can prove this call was rejected before dialing. Unknown
  // provider outcomes never produce a false failure notice or a retry.
  if(result.status!=='call_started'){
   const message=await db<string|null>('rpc/icash_seller_sms_call_unavailable','POST',{p_account:reply.accountId,p_job:reply.voiceJobId});
   if(message)await dispatch(reply.accountId,message);
  }
  return result;
 }
 if(reply.messageId)return dispatch(reply.accountId,reply.messageId);
 if(reply.textAiJobId)return processAi(reply.accountId,reply.textAiJobId);
 return {status:'no_seller_reply'};
}
