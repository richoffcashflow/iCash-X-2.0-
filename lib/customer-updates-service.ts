import {customerUpdateConfiguration,updateCopy,type UpdateKind} from './customer-updates.ts';
import {uuidPattern,unsubscribePattern} from './attention-notifications.ts';
import {readCampaignSettings} from './messaging-settings.ts';
type Database=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
type Job={id:string;channel:'email'|'sms';kind:UpdateKind;screeningId:string|null;sender?:string;recipient:string;unsubscribeToken:string};
/** Call only after verifying the provider's webhook signature. */
export async function recordCustomerUpdateDelivery(event:{type?:string;data?:{email_id?:unknown;to?:unknown;tags?:Record<string,unknown>}},db:Database){
 const data=event.data,recipient=Array.isArray(data?.to)&&data.to.length===1?data.to[0]:null;
 if(!['email.delivered','email.bounced','email.complained','email.failed','email.suppressed'].includes(event.type??'')||typeof data?.email_id!=='string'||!uuidPattern.test(data.email_id)||typeof recipient!=='string'||recipient.length>254)return;
 const id=data.tags?.icash_update_id;
 await db('rpc/icash_customer_update_delivery_event','POST',{p_id:typeof id==='string'&&uuidPattern.test(id)?id:null,p_provider:data.email_id,p_recipient:recipient,p_event:event.type});
}
export async function dispatchCustomerUpdate(accountId:string,{db,env=process.env,transport=fetch,signal:parent}:{db:Database;env?:Record<string,string|undefined>;transport?:typeof fetch;signal?:AbortSignal}){
 if(!uuidPattern.test(accountId)||(!env.RESEND_API_KEY&&!env.CONTIGUITY_API_KEY))return {status:'updates_disabled'};
 const signal=parent?AbortSignal.any([parent,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000);
 let id:string|null=null;
 try{
  signal.throwIfAborted();
  const {settings}=await readCampaignSettings(db,signal),config=customerUpdateConfiguration(env,settings.fromEmail);
  if(!config.origin||(!config.email&&!config.sms))return {status:'updates_disabled'};
  id=await db<string|null>('rpc/icash_claim_customer_update','POST',{p_account:accountId,p_email_ready:config.email,p_sms_ready:config.sms},signal);
  if(!id)return {status:'updates_idle'};
  if(!uuidPattern.test(id))throw Error('Invalid claim');
  const job=await db<Job|null>('rpc/icash_authorize_customer_update','POST',{p_account:accountId,p_id:id},signal);
  if(!job)return {status:'updates_held'};
  if(job.id!==id||(job.kind!=='credits_low'&&(!job.screeningId||!uuidPattern.test(job.screeningId)))||!Object.hasOwn(updateCopy,job.kind)||!unsubscribePattern.test(job.unsubscribeToken))throw Error('Invalid update');
  const target=new URL('/',config.origin);if(job.kind==='credits_low')target.hash='funding';else if(job.screeningId)target.searchParams.set('screeningId',job.screeningId);
  const unsubscribe=new URL('/api/notifications/updates/unsubscribe',config.origin);unsubscribe.searchParams.set('token',job.unsubscribeToken);
  const copy=updateCopy[job.kind];let response:Response;
  if(job.channel==='email'){
   if(!config.email||typeof job.recipient!=='string'||job.recipient.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.recipient))throw Error('Invalid recipient');
   response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`bot-update-${id}`},body:JSON.stringify({from:`iCash X <${config.from}>`,to:[job.recipient],subject:`iCash X: ${copy.title}`,text:`${copy.title}\n\n${copy.detail}\n\n${job.kind==='credits_low'?'Review your balance and add credits':'Open your property'} (sign-in required):\n${target.href}\n\nManage your bot and daily budget: ${config.origin}/\n\nYou chose bot activity updates. Up to 2 emails and 1 text per day. Turn them off: ${unsubscribe.href}\n\nThis reflects a saved event. Open the workspace for the latest status.`,tags:[{name:'icash_update_id',value:id}],headers:{'List-Unsubscribe':`<${unsubscribe.href}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}})});
  }else if(job.channel==='sms'){
   if(!config.sms||!/^\+[1-9]\d{7,14}$/.test(job.recipient)||!/^\+[1-9]\d{7,14}$/.test(job.sender??''))throw Error('Invalid recipient');
   response=await transport('https://api.contiguity.com/send/text',{method:'POST',redirect:'error',signal,headers:{Authorization:`Token ${env.CONTIGUITY_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:job.sender,to:job.recipient,message:`iCash X: ${copy.title}. ${job.kind==='credits_low'?'Add credits':'View your property'}: ${target.href} Reply STOP to stop bot updates.`,attachments:[],fast_track:false})});
  }else throw Error('Invalid channel');
  if(!response.ok)throw Error('Delivery unconfirmed');
  const receipt=await response.json();const provider=job.channel==='email'?receipt?.id:receipt?.data?.message_id;
  if(typeof provider!=='string'||!provider||provider.length>200||(job.channel==='email'&&!uuidPattern.test(provider)))throw Error('Missing receipt');
  await db('rpc/icash_finish_customer_update','POST',{p_account:accountId,p_id:id,p_provider:provider},signal);
  return {status:'updates_accepted'};
 }catch{
  if(id&&uuidPattern.test(id)&&!signal.aborted)try{await db('rpc/icash_finish_customer_update','POST',{p_account:accountId,p_id:id,p_provider:null},signal);}catch{}
  return {status:'updates_needs_review'};
 }
}
