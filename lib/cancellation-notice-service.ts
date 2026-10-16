import type {CancellationNotice} from './cancellation-notice-policy.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Prepared={id:string;channel:CancellationNotice['channel'];state:string;sms_id:string|null;email_id:string|null;voice_job_id:string|null};
type Deps={db:Database;text:(account:string,id:string,manual:boolean)=>Promise<{status:string}>;email:(account:string,id:string)=>Promise<{status:string}>;voice:(account:string,id:string)=>Promise<{status:string}>};
const detail:Record<string,string>={cancellation_notice_waiting:'Waiting for available calling conditions, credits or another active call to finish.',live_work_not_ready:'Sending is temporarily unavailable.',messaging_configuration_required:'Texting setup needs attention.',email_configuration_required:'Email setup needs attention.',email_held:'Email is held. Check account status, credits and contact permission.',message_held:'Text is held. Check contact permission, credits and recent messages.',identity_or_start_required:'Run bot and check Account details to allow this cancellation call.',outside_contact_hours:'Waiting for the seller’s calling hours.',waiting_for_available_credits:'Add credits to send this cancellation call.',contact_operating_checks_required:'Calling permission needs attention.',contact_opted_out:'The contact opted out. Use another permitted channel.',provider_outcome_unknown_no_retry:'Call result is uncertain. It will not be redialed automatically.'};
/** Durable DB claims and provider-specific idempotency prevent a retry from redialing/resending. */
export async function processCancellationNotices(deps:Deps){
 const due=await deps.db<{id:string;account_id:string}[]>('rpc/icash_due_cancellation_notices','POST',{p_limit:12});
 let cursor=0,processed=0,held=0;
 await Promise.all(Array.from({length:Math.min(3,due.length)},async()=>{
  while(cursor<due.length){const n=due[cursor++];try{
   const item=await deps.db<Prepared|null>('rpc/icash_prepare_cancellation_notice','POST',{p_account:n.account_id,p_notice:n.id});
   if(!item){held++;continue;}
   let result:{status:string}|null=null;
   if(item.channel==='sms'&&item.sms_id)result=await deps.text(n.account_id,item.sms_id,true);
   if(item.channel==='email'&&item.email_id)result=await deps.email(n.account_id,item.email_id);
   if(item.channel==='voice'&&item.voice_job_id){
    // Only a never-dispatched job may be made ready again after a preflight hold.
    const allowed=await deps.db<boolean>('rpc/icash_retry_cancellation_voice','POST',{p_account:n.account_id,p_job:item.voice_job_id});
    if(allowed)result=await deps.voice(n.account_id,item.voice_job_id);
   }
   if(result){
    const success=['message_accepted','email_accepted','call_started'].includes(result.status);
    await deps.db(`icash_cancellation_notices?id=eq.${n.id}&account_id=eq.${n.account_id}&state=neq.superseded`,'PATCH',{detail:success?'':detail[result.status]??'Delivery needs attention. Check the channel and account status.',state:success?'queued':'held',updated_at:new Date().toISOString()});
    if(success)processed++;else held++;
   }else held++;
  }catch{
   held++;
   await deps.db(`icash_cancellation_notices?id=eq.${n.id}&account_id=eq.${n.account_id}&state=neq.superseded`,'PATCH',{detail:'Notice needs attention. Check contact details, account status and credits.',state:'held',updated_at:new Date().toISOString()}).catch(()=>undefined);
  }}
 }));
 return {checked:due.length,processed,held};
}
