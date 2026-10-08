import {z} from 'zod';
import {boundedBytes} from './required-call-recording-provider.ts';

export const primaryBusinessPhone='+14243948384';
export const secondaryBusinessPhone='+14244377030';
export const businessVoiceIngress='+17816093521';
const phone=z.string().regex(/^\+[1-9]\d{7,14}$/);
const forwardingSchema=z.object({object:z.literal('response'),data:z.object({number:phone,call_forwarding:z.object({enabled:z.boolean(),to:phone.nullable(),status:z.enum(['active','queued']),estimated_completion:z.number().nullable()})})});
const leaseSchema=z.object({data:z.object({numbers:z.array(z.object({number:z.object({e164:phone}),lease_status:z.string(),capabilities:z.object({channels:z.array(z.string())})}))})});
type Env={ [key:string]:string|undefined;CONTIGUITY_API_KEY?:string;TWILIO_ACCOUNT_SID?:string;TWILIO_AUTH_TOKEN?:string;VERCEL_ENV?:string};
type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export class BusinessPhoneError extends Error{}
export function businessVoiceProviders(env:Env,fetcher:typeof fetch=fetch){
 if(typeof window!=='undefined'||!env.CONTIGUITY_API_KEY||!/^AC[a-f\d]{32}$/i.test(env.TWILIO_ACCOUNT_SID??'')||!env.TWILIO_AUTH_TOKEN)throw new BusinessPhoneError('The calling connection is unavailable.');
 const account=env.TWILIO_ACCOUNT_SID!,auth='Basic '+Buffer.from(account+':'+env.TWILIO_AUTH_TOKEN).toString('base64');
 async function read(url:string,headers:Record<string,string>,body?:unknown){
  const r=await fetcher(url,{method:body===undefined?'GET':'POST',headers:{...headers,Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});
  const label=url.includes('OutgoingCallerIds')?'Twilio caller ID':url.includes('IncomingPhoneNumbers')?'Twilio reception':url.includes('call_forwarding')?'Contiguity call routing':'Contiguity leased numbers';
  if(!r.ok){
   let reason='';
   try{
    const v=obj(JSON.parse((await boundedBytes(r,8192)).toString('utf8'))),candidate=obj(v.data).error;
    // Only the provider's short error label is relevant to this owner-only
    // setup. Never forward bodies, request metadata, or credential-like values.
    if(typeof candidate==='string'&&candidate.length<=300){
     reason=candidate;for(const secret of Object.values(env).filter((s):s is string=>typeof s==='string'&&s.length>=16))reason=reason.split(secret).join('[redacted]');
     reason=reason.replace(/[A-Za-z0-9_-]{24,}/g,'[redacted]').replace(/[<>\r\n]/g,' ').slice(0,240);
    }
   }catch{/* Status remains available when the provider has no safe error label. */}
   throw new BusinessPhoneError(`${label} returned HTTP ${r.status}${reason?': '+reason:'.'} ${body===undefined?'':'Refresh before retrying the change.'}`.trim());
  }
  if(r.redirected||r.url&&r.url!==url||!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')??''))throw new BusinessPhoneError(`${label} returned an unexpected response.`);
  return JSON.parse((await boundedBytes(r,262144)).toString('utf8')) as unknown;
 }
 async function forwarding(){const r=forwardingSchema.parse(await read(`https://api.contiguity.com/numbers/lease/${encodeURIComponent(secondaryBusinessPhone)}/call_forwarding`,{Authorization:'Bearer '+env.CONTIGUITY_API_KEY}));if(r.data.number!==secondaryBusinessPhone)throw new BusinessPhoneError('The provider returned a different number.');return r.data.call_forwarding;}
 async function leased(){const r=leaseSchema.parse(await read('https://api.contiguity.com/numbers/leased',{Authorization:'Token '+env.CONTIGUITY_API_KEY}));return r.data.numbers.some(n=>n.number.e164===secondaryBusinessPhone&&n.lease_status==='active'&&n.capabilities.channels.includes('sms'));}
 async function callerId(){
  const r=obj(await read(`https://api.twilio.com/2010-04-01/Accounts/${account}/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(secondaryBusinessPhone)}&PageSize=2`,{Authorization:auth}));
  if(!Array.isArray(r.outgoing_caller_ids)||r.outgoing_caller_ids.length>1||r.next_page_uri!==null)throw new BusinessPhoneError('Caller ID could not be verified.');
  const p=obj(r.outgoing_caller_ids[0]);return p.phone_number===secondaryBusinessPhone&&p.account_sid===account&&typeof p.sid==='string'&&/^PN[a-f\d]{32}$/i.test(p.sid)?p.sid:null;
 }
 async function ingress(){
  const r=obj(await read(`https://api.twilio.com/2010-04-01/Accounts/${account}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(businessVoiceIngress)}&PageSize=2`,{Authorization:auth}));
  const rows=r.incoming_phone_numbers;if(!Array.isArray(rows)||rows.length!==1||r.next_page_uri!==null)return false;const p=obj(rows[0]);
  return p.phone_number===businessVoiceIngress&&p.account_sid===account&&obj(p.capabilities).voice===true&&p.voice_method==='POST'&&['https://www.geticashx.com/api/reception/inbound','https://www.geticashx.com/api/reception/recorded/inbound'].includes(String(p.voice_url))&&!p.voice_application_sid&&!p.trunk_sid;
 }
 return {account,forwarding,leased,callerId,ingress,enable:async()=>{
  if(env.VERCEL_ENV!=='production')throw new BusinessPhoneError('Connect this number from the live admin page.');
  const r=forwardingSchema.parse(await read(`https://api.contiguity.com/numbers/lease/${encodeURIComponent(secondaryBusinessPhone)}/call_forwarding/enable`,{Authorization:'Bearer '+env.CONTIGUITY_API_KEY},{to:businessVoiceIngress}));
  if(r.data.number!==secondaryBusinessPhone||!r.data.call_forwarding.enabled||r.data.call_forwarding.to!==businessVoiceIngress)throw new BusinessPhoneError('The provider has not confirmed incoming routing.');return r.data.call_forwarding;
 }};
}
export async function inspectBusinessPhone(env:Env,fetcher:typeof fetch=fetch){
 const p=businessVoiceProviders(env,fetcher),[lease,f,callerRead,ingress]=await Promise.all([p.leased(),p.forwarding(),p.callerId().then(value=>({value,error:null as string|null})).catch(e=>({value:null,error:e instanceof BusinessPhoneError?e.message:'Caller ID could not be checked.'})),p.ingress()]);
 const caller=callerRead.value;
 return {phone:secondaryBusinessPhone,leaseActive:lease,incoming:lease&&ingress&&f.enabled&&f.to===businessVoiceIngress&&f.status==='active',incomingPending:f.enabled&&f.to===businessVoiceIngress&&f.status==='queued',differentDestination:f.enabled&&f.to!==businessVoiceIngress,callerIdVerified:caller!==null,callerIdError:callerRead.error,callerIdSid:caller,providerAccountSid:p.account,ingressReady:ingress};
}
/** Explicit owner action. Provider receipts, not submitted booleans, enable calls. */
export async function connectBusinessPhone(database:Database,env:Env,fetcher:typeof fetch=fetch){
 if(env.VERCEL_ENV!=='production')throw new BusinessPhoneError('Connect this number from the live admin page.');
 const before=await inspectBusinessPhone(env,fetcher);
 if(!before.leaseActive||!before.ingressReady)throw new BusinessPhoneError('The number or AI reception is not ready.');
 if(before.differentDestination)throw new BusinessPhoneError('This number already forwards somewhere else. Review that destination first.');
 if(!before.incoming&&!before.incomingPending)await businessVoiceProviders(env,fetcher).enable();
 const checked=await inspectBusinessPhone(env,fetcher);
 await database('rpc/icash_save_business_voice_number','POST',{p_account_sid:checked.providerAccountSid,p_caller_id_sid:checked.callerIdSid,p_forwarding:checked.incoming,p_enabled:checked.incoming&&checked.callerIdVerified});
 return checked;
}
export async function secondaryCallingReady(database:Database,env:Env,fetcher:typeof fetch=fetch){
 const [row]=await database<{outbound_enabled:boolean;forwarding_ready:boolean;provider_account_sid:string;caller_id_sid:string|null}[]>(`icash_business_voice_numbers?phone=eq.${encodeURIComponent(secondaryBusinessPhone)}&select=outbound_enabled,forwarding_ready,provider_account_sid,caller_id_sid`);
 if(!row?.outbound_enabled||!row.forwarding_ready||row.provider_account_sid!==env.TWILIO_ACCOUNT_SID||!row.caller_id_sid)return false;
 const p=businessVoiceProviders(env,fetcher),[lease,id]=await Promise.all([p.leased(),p.callerId()]);return lease&&id===row.caller_id_sid;
}
export function selectBusinessCaller(primary:string|undefined,threads:{sender:string;sender_pool_assigned?:boolean}[]){
 if(primary!==primaryBusinessPhone)throw new BusinessPhoneError('The primary calling number does not match.');
 const numbers=[...new Set(threads.map(t=>t.sender))];
 if(!numbers.length)return primary;
 if(numbers.length!==1||!numbers.every(n=>n===primary||n===secondaryBusinessPhone))throw new BusinessPhoneError('This conversation needs a calling number review.');
 if(numbers[0]===secondaryBusinessPhone&&!threads.every(t=>t.sender_pool_assigned))throw new BusinessPhoneError('This conversation needs a calling number review.');
 return numbers[0];
}
