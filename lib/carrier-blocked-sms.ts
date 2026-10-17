import type {parseTextWebhook} from './contiguity.ts';

type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type TextEvent=ReturnType<typeof parseTextWebhook>;

/** Call only after signature verification and recognition of our sending number. */
export async function suppressCarrierBlockedSms(database:Database,event:TextEvent):Promise<boolean>{
 // Contiguity also reports missing delivery confirmations as failures. Only
 // this explicit recipient-blocking reason suppresses later SMS reminders.
 if(event.type!=='text.delivery.failed'||!event.data.message_id||!/\bmessage blocking is active\b/i.test(event.data.error??''))return false;
 const phone=event.data.to,query=`icash_webinar_phone_suppressions?phone=eq.${encodeURIComponent(phone)}&select=phone`;
 if(!(await database<{phone:string}[]>(query)).length){
  try{await database('icash_webinar_phone_suppressions','POST',{phone});}
  catch(error){
   // Concurrent/replayed receipts may insert the same primary key. A real
   // write failure must escape so the provider retries its webhook, not a send.
   if(!(await database<{phone:string}[]>(query)).length)throw error;
  }
 }
 // Persist the suppression first: final send admission already checks this
 // table, even if cancellation fails and the delivery webhook is replayed.
 await database(`icash_webinar_outbox?channel=eq.sms&recipient=eq.${encodeURIComponent(phone)}&state=in.(pending,claimed)`,'PATCH',{state:'canceled',last_error:'Carrier message blocking is active; SMS reminders stopped'});
 return true;
}
