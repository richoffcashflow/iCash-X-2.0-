import {db} from '@/lib/stripe-test';
import {smsWorkEnabled} from './live-work-admission.ts';
/** Read-only configuration/release check. Recipient, pricing and budget authority remain atomic at claim. */
export async function smsAccountReady(accountId:string,userId:string){
 if(!smsWorkEnabled()||!process.env.CONTIGUITY_API_KEY||!process.env.CONTIGUITY_WEBHOOK_SECRET)return false;
 const sender=process.env.CONTIGUITY_FROM;if(!sender||!/^\+1[2-9]\d{9}$/.test(sender))return false;
 try{
  const [campaign,senders,rates]=await Promise.all([
   db<{released:boolean}>('rpc/icash_sms_inbound_campaign_status','POST',{p_account:accountId,p_user:userId}),
   db<{phone:string}[]>(`icash_text_senders?phone=eq.${encodeURIComponent(sender)}&enabled=eq.true&select=phone&limit=1`),
   db<{id:string}[]>('icash_operation_rates?operation=eq.sms_send&enabled=eq.true&order=verified_at.desc,id&select=id&limit=20'),
  ]);
  if(campaign.released!==true||senders.length!==1)return false;
  for(const rate of rates)if(await db<boolean>('rpc/icash_sms_intake_rate_current','POST',{p_rate:rate.id})===true)return true;
  return false;
 }catch{return false;}
}
