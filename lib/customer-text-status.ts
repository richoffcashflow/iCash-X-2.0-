import {db} from '@/lib/stripe-test';

const reasons:Record<string,string>={
 live_work_not_ready:'Texting is temporarily unavailable. Your draft is saved.',
 messaging_configuration_required:'Business texting needs setup. Your draft is saved.',
 business_number_mismatch:'Business texting number is unavailable. Your draft is saved.',
 business_number_verification_required:'Business texting number could not be verified. Try again.',
};

// A claim can fail before contacting the provider. Read the durable state instead
// of reporting every exception as an uncertain delivery (and locking the draft).
export async function customerTextStatus(accountId:string,messageId:string,threadId:string,fallback?:string){
 const [message]=await db<{state:string}[]>(`icash_text_messages?id=eq.${messageId}&account_id=eq.${accountId}&thread_id=eq.${threadId}&select=state`);
 if(message&&['accepted','sent','delivered'].includes(message.state))return {status:'message_accepted',state:message.state};
 if(message?.state==='ready'){
  const reason=await db<string|null>('rpc/icash_manual_text_reason','POST',{p_account:accountId,p_thread:threadId,p_exclude:messageId});
  return {status:'message_not_sent',state:'ready',notSent:true,error:reason??reasons[fallback??'']??'Text not sent. Your draft is ready to retry.'};
 }
 if(message?.state==='cancelled'||message?.state==='failed')return {status:'message_not_sent',state:message.state,notSent:true,error:'Text was not delivered. Your draft is saved.'};
 return {status:'message_delivery_needs_review',state:message?.state??'unknown'};
}
