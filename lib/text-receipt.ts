type Database=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
/** Only retry the idempotent database receipt. The caller sends to the provider once. */
export async function saveTextReceipt(db:Database,accountId:string,messageId:string,providerId:string){
 for(let attempt=0;attempt<2;attempt++){
  try{
   const signal=AbortSignal.timeout(5000);
   await db('rpc/icash_accept_text','POST',{p_account:accountId,p_message:messageId,p_provider:providerId},signal);
   const [message]=await db<{state:string;provider_id:string|null}[]>(`icash_text_messages?id=eq.${messageId}&account_id=eq.${accountId}&select=state,provider_id`,'GET',undefined,signal);
   return message?.provider_id===providerId&&['accepted','delivered'].includes(message.state)?{status:'message_accepted'}:{status:'message_delivery_needs_review'};
  }catch{if(attempt===0)await new Promise(resolve=>setTimeout(resolve,200));}
 }
 // Preserve the known provider ID if the RPC remains unavailable. Never overwrite
 // a webhook's delivered state and never retry the external send.
 try{await db(`icash_text_messages?id=eq.${messageId}&account_id=eq.${accountId}&state=eq.dispatching&provider_id=is.null`,'PATCH',{provider_id:providerId,state:'needs_review',updated_at:new Date().toISOString()},AbortSignal.timeout(3000));}catch{}
 return {status:'message_delivery_needs_review'};
}
