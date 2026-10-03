import {object,sha,sid,uuid} from './required-call-recording.ts';
import {RecordingProviderError,type RecordingEnv,type RecordingProviders} from './required-call-recording-provider.ts';
import type {RecordingDb} from './required-call-recording-service.ts';
import {ownerRecordingBase} from './owner-recording-test.ts';

export type OwnerReplyEvent={
 speechStatus:'present'|'empty'|'missing'|'invalid'|'partial';speech:string|null;redacted:boolean;truncated:boolean;
 confidenceStatus:'valid'|'empty'|'missing'|'invalid';confidence:number|null;partial:boolean;
 eventTime:string|null;httpResponse:number|null;
};
export type OwnerReplyInspection={
 status:'complete'|'incomplete'|'not_ready'|'unavailable'|'provider_access_denied';reason:string;
 attempt?:number;events:OwnerReplyEvent[];pagesRead:number;matchedEvents:number;finalEvents:number;
};
type Owner={accountId:string;userId:string};
type ReplyProvider=Pick<RecordingProviders,'getCall'|'getCallEventsPage'>;
const terminal=new Set(['completed','busy','failed','no-answer','canceled']);
const has=(o:Record<string,unknown>,key:string)=>Object.prototype.hasOwnProperty.call(o,key);
const result=(status:OwnerReplyInspection['status'],reason:string,extra:Partial<OwnerReplyInspection>={}):OwnerReplyInspection=>({status,reason,events:[],pagesRead:0,matchedEvents:0,finalEvents:0,...extra});
const phone=(value:unknown)=>typeof value==='string'&&/^\+[1-9]\d{7,14}$/.test(value);

// Return only a short diagnostic reply, never provider payloads, headers or URLs.
// Preserve ordinary spelling and punctuation: changing them would hide the ASR failure.
export function safeOwnerReply(value:string){
 // Bound CPU before any regex; never expose a prefix cut through a credential.
 if(value.length>1024)return {speech:'[withheld: overlong reply]',redacted:true,truncated:true};
 let text=value,redacted=false;
 const replace=(pattern:RegExp)=>{text=text.replace(pattern,()=>{redacted=true;return '[redacted]';});};
 replace(/(?:\b[a-z][a-z0-9+.-]{1,20}:\/\/|www\.)[^\s<>]+/gi);
 replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
 replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|dev|test|co|us|uk)\b(?:\/[^\s<>]*)?|\b(?:[a-z0-9-]+\.)+[a-z]{2,24}\/[^\s<>]*/gi);
 replace(/\+?\p{Nd}(?:[()./\s\p{Zs}\p{Pd}\u2212\u2044\u2215\uff0f]{0,4}\p{Nd}){6,14}/gu);
 replace(/\b(?:AC|CA|RE|SK)[a-f0-9]{32}\b/gi);
 replace(/\b(?:sk|pk|rk)_[A-Za-z0-9_-]{8,}\b/g);
 replace(/\b(?:bearer|basic)\s+[A-Za-z0-9+/=_\-.]+/gi);
 replace(/\b(?:password|passwd|secret|token|api[_ -]?key|signature|nonce)(?:\s*[:=]\s*|\s+)(?:is\s+)?[^\s,;]+/gi);
 replace(/\b[A-Za-z0-9_+/=-]{24,}\b/g);
 replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g);
 const truncated=text.length>500;return {speech:truncated?text.slice(0,500)+'…':text,redacted,truncated};
}

function summarize(parameters:Record<string,unknown>,response:Record<string,unknown>):OwnerReplyEvent{
 const partial=has(parameters,'unstable_speech_result'),speech=parameters.speech_result;
 const speechStatus=partial?'partial':!has(parameters,'speech_result')?'missing':typeof speech!=='string'?'invalid':speech.length?'present':'empty';
 const safe=!partial&&typeof speech==='string'?safeOwnerReply(speech):{speech:null,redacted:false,truncated:false};
 const value=parameters.confidence;
 const confidenceStatus=!has(parameters,'confidence')?'missing':value===''?'empty':
  (typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value))&&Number(value)>=0&&Number(value)<=1?'valid':'invalid';
 const date=typeof response.date_created==='string'?Date.parse(response.date_created):NaN;
 const code=response.response_code;
 return {speechStatus,...safe,confidenceStatus,confidence:confidenceStatus==='valid'?Number(value):null,
  partial,eventTime:Number.isFinite(date)?new Date(date).toISOString():null,
  httpResponse:Number.isInteger(code)&&Number(code)>=100&&Number(code)<=599?Number(code):null};
}

function nextPage(value:unknown,account:string,call:string,page:number):{page:number;token?:string}|null{
 if(typeof value!=='string'||value.length>2048)return null;
 try{
  const u=new URL(value,'https://api.twilio.com'),path=`/2010-04-01/Accounts/${account}/Calls/${call}/Events.json`;
  if(u.origin!=='https://api.twilio.com'||u.pathname!==path||u.username||u.password||u.hash)return null;
  if([...u.searchParams.keys()].some(k=>!['Page','PageSize','PageToken'].includes(k))||u.searchParams.getAll('Page').length!==1||u.searchParams.get('Page')!==String(page+1)||u.searchParams.getAll('PageSize').length!==1||u.searchParams.get('PageSize')!=='100'||u.searchParams.getAll('PageToken').length>1)return null;
  const token=u.searchParams.get('PageToken')??undefined;
  if(token!==undefined&&!/^[A-Za-z0-9._~-]{1,512}$/.test(token))return null;
  return {page:page+1,token};
 }catch{return null;}
}

export function ownerCallReplyInspector(env:RecordingEnv,{db,provider,now=Date.now}:{db:RecordingDb;provider:ReplyProvider;now?:()=>number}){
 return async(owner:Owner,id:string):Promise<OwnerReplyInspection>=>{
  if(!uuid(id)||!uuid(owner.accountId)||!uuid(owner.userId))return result('unavailable','owner_run_unavailable');
  const configs=await db<Record<string,unknown>[]>(`icash_owner_recording_test_config?id=eq.1&account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&select=id,account_id,owner_user_id,phone,from_phone,review&limit=2`);
  const config=configs.length===1?configs[0]:null,review=object(config?.review);
  if(!config||config.id!==1||config.account_id!==owner.accountId||config.owner_user_id!==owner.userId||!phone(config.phone)||!String(config.phone).endsWith('5280')||config.from_phone!=='+14243948384'||config.from_phone!==env.CONTIGUITY_FROM||!sid(env.TWILIO_ACCOUNT_SID,'AC')||review.providerAccountSid!==env.TWILIO_ACCOUNT_SID)return result('unavailable','owner_run_unavailable');
  const runs=await db<Record<string,unknown>[]>(`icash_owner_recording_test_runs?id=eq.${id}&config_id=eq.1&account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&select=id,config_id,account_id,owner_user_id,configuration,attempt,call_sid,nonce_hash&limit=2`);
  const run=runs.length===1?runs[0]:null,snapshot=object(run?.configuration),savedReview=object(snapshot.review);
  if(!run||run.id!==id||run.config_id!==1||run.account_id!==owner.accountId||run.owner_user_id!==owner.userId||!Number.isInteger(run.attempt)||Number(run.attempt)<1||Number(run.attempt)>3||!sid(run.call_sid,'CA')||typeof run.nonce_hash!=='string'||!/^[a-f0-9]{64}$/.test(run.nonce_hash)||snapshot.id!==1||snapshot.account_id!==owner.accountId||snapshot.owner_user_id!==owner.userId||snapshot.phone!==config.phone||snapshot.from_phone!==config.from_phone||savedReview.providerAccountSid!==env.TWILIO_ACCOUNT_SID)return result('unavailable','owner_run_unavailable');
  const callId=String(run.call_sid),account=env.TWILIO_ACCOUNT_SID!,attempt=Number(run.attempt),events:OwnerReplyEvent[]=[];
  let pagesRead=0,matchedEvents=0,finalEvents=0;
  const complete=(status:OwnerReplyInspection['status'],reason:string)=>result(status,reason,{attempt,events,pagesRead,matchedEvents,finalEvents});
  try{
   const call=await provider.getCall(callId);
   if(call.sid!==callId||call.account_sid!==account||call.from!==config.from_phone||call.to!==config.phone||call.direction!=='outbound-api')return complete('unavailable','carrier_binding_unverified');
   if(!terminal.has(String(call.status)))return complete('not_ready','call_not_ended');
   const ended=typeof call.end_time==='string'?Date.parse(call.end_time):NaN;
   if(!Number.isFinite(ended)||ended>now())return complete('not_ready','call_end_time_unverified');
   if(now()-ended<15*60*1000)return complete('not_ready','events_available_after_15_minutes');
   let page=0,token:string|undefined;
   while(page<3){
    const list=await provider.getCallEventsPage(callId,page,token);pagesRead++;
    if(!Array.isArray(list.events)||list.events.length>100||list.page!==page||list.page_size!==100)return complete('incomplete','provider_page_invalid');
    for(const raw of list.events){
     const event=object(raw),request=object(event.request),parameters=object(request.parameters);
     if(request.method!=='POST'||typeof request.url!=='string')continue;
     let url:URL;try{url=new URL(request.url);}catch{continue;}
     if(url.origin!==new URL(ownerRecordingBase).origin||url.pathname!==new URL(ownerRecordingBase+'/consent').pathname||url.username||url.password||url.hash)continue;
     // Event payloads are not authority. Bind again to the exact run and original callback nonce.
     if(parameters.account_sid!==account||parameters.call_sid!==callId||url.searchParams.size!==2||url.searchParams.getAll('id').length!==1||url.searchParams.get('id')!==id||url.searchParams.getAll('nonce').length!==1||!/^[a-f0-9]{64}$/.test(url.searchParams.get('nonce')??'')||sha(url.searchParams.get('nonce')!)!==run.nonce_hash)return complete('incomplete','event_binding_unverified');
     matchedEvents++;
     const reply=summarize(parameters,object(event.response));events.push(reply);
     if((reply.speechStatus==='present'||reply.speechStatus==='empty')&&!reply.partial)finalEvents++;
    }
    if(list.next_page_uri===null)return complete('complete',matchedEvents===0?'no_matching_consent_event':finalEvents===0?'no_final_speech_result':finalEvents>1?'multiple_final_speech_results':'final_speech_result_found');
    const next=nextPage(list.next_page_uri,account,callId,page);
    if(!next)return complete('incomplete','pagination_unverified');
    if(next.page>=3)return complete('incomplete','page_limit_reached');
    page=next.page;token=next.token;
   }
   return complete('incomplete','page_limit_reached');
  }catch(error){
   if(error instanceof RecordingProviderError&&(error.status===401||error.status===403))return complete('provider_access_denied','provider_read_not_authorized');
   return complete('incomplete','provider_read_unavailable');
  }
 };
}
