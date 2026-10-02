import {boundedBody,receptionTarget} from './general-reception.ts';
import {ownerInboundTarget} from './owner-inbound-acceptance.ts';

// Fixed read-only window for the owner's reception routing test. No outbound
// calls, arbitrary filters, pagination following, Events API or provider writes.
// https://www.twilio.com/docs/voice/api/call-resource
// https://raw.githubusercontent.com/twilio/twilio-node/main/src/rest/api/v2010/account/call/notification.ts
const earliest=Date.parse('2026-10-02T19:40:45Z');
type Obj=Record<string,unknown>;
type Env={TWILIO_ACCOUNT_SID?:string;TWILIO_AUTH_TOKEN?:string};
type Deps={rpc:(name:string,body?:Obj)=>Promise<unknown>;fetcher?:typeof fetch;now?:()=>number};
export type ReceptionCarrierCall={sid:string;status:string;createdAt:string;startTime:string|null;durationSeconds:number|null;ownerCallerMatched:boolean;errorCodes:number[]};
export type ReceptionCarrierDiagnostic={status:'matched'|'no_calls'|'unavailable';complete:boolean;calls:ReceptionCarrierCall[]};
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const unavailable=():ReceptionCarrierDiagnostic=>({status:'unavailable',complete:false,calls:[]});
const callSid=(v:unknown):v is string=>typeof v==='string'&&/^CA[0-9a-fA-F]{32}$/.test(v);
const statuses=new Set(['queued','ringing','in-progress','completed','busy','failed','no-answer','canceled']);
function timestamp(value:unknown){
 if(typeof value!=='string'||value.length>64||!(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} (?:[+-]\d{4}|GMT)$/.test(value)||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)))return NaN;
 return Date.parse(value);
}
export async function readReceptionCarrierDiagnostic(env:Env,deps:Deps):Promise<ReceptionCarrierDiagnostic>{
 const account=env.TWILIO_ACCOUNT_SID,token=env.TWILIO_AUTH_TOKEN,now=deps.now?.()??Date.now();
 if(typeof window!=='undefined'||typeof account!=='string'||!/^AC[0-9a-fA-F]{32}$/.test(account)||typeof token!=='string'||token.length<20||token.length>4096||!/^[\x21-\x7e]+$/.test(token)||!Number.isSafeInteger(now)||now<earliest)return unavailable();
 try{
  const c=obj(await deps.rpc('icash_get_general_reception_config'));
  if(c.account_id!==receptionTarget.accountId||c.owner_user_id!==receptionTarget.ownerUserId||c.called_number!==receptionTarget.calledNumber)return unavailable();
  const base=`https://api.twilio.com/2010-04-01/Accounts/${account}`,signal=AbortSignal.timeout(15000);
  async function read(suffix:string){
   const url=base+suffix,r=await(deps.fetcher??fetch)(url,{method:'GET',headers:{Authorization:'Basic '+Buffer.from(account+':'+token).toString('base64'),Accept:'application/json'},cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
   // Includes 403: stop immediately. Never retry, follow provider URLs, or
   // substitute another account, credential or endpoint after a denial.
   if(!r.ok||r.redirected||(r.url&&r.url!==url)){await r.body?.cancel().catch(()=>undefined);throw Error('UNAVAILABLE');}
   if(!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')??''))throw Error('UNAVAILABLE');
   const data=JSON.parse(await boundedBody(r,256*1024));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('UNAVAILABLE');return data as Obj;
  }
  // A From filter could hide a forwarded call. A start-time filter could hide
  // an unanswered call. Filter the fixed test window locally by date_created.
  const data=await read('/Calls.json?To='+encodeURIComponent(receptionTarget.calledNumber)+'&PageSize=20');
  if(!Array.isArray(data.calls)||data.calls.length>20)return unavailable();
  let complete=data.next_page_uri===null;
  const matches:ReceptionCarrierCall[]=[],seen=new Set<string>();
  for(const input of data.calls){
   const call=obj(input),created=timestamp(call.date_created);
   if(call.account_sid!==account||!callSid(call.sid)||seen.has(call.sid)||call.to!==receptionTarget.calledNumber||!Number.isFinite(created))return unavailable();seen.add(call.sid);
   if(created<earliest||created>now)continue;
   if(typeof call.status!=='string'||!statuses.has(call.status))return unavailable();
   const started=call.start_time==null||call.start_time===''?null:timestamp(call.start_time);
   if(started!==null&&(!Number.isFinite(started)||started<created||started>now))return unavailable();
   const duration=call.duration==null||call.duration===''?null:typeof call.duration==='string'&&/^\d{1,7}$/.test(call.duration)?Number(call.duration):call.duration;
   if(duration!==null&&(typeof duration!=='number'||!Number.isSafeInteger(duration)||duration<0||duration>86400))return unavailable();
   matches.push({sid:call.sid,status:call.status,createdAt:new Date(created).toISOString(),startTime:started===null?null:new Date(started).toISOString(),durationSeconds:duration as number|null,ownerCallerMatched:call.from===ownerInboundTarget.ownerPhone,errorCodes:[]});
  }
  matches.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.sid.localeCompare(b.sid));if(matches.length>5)complete=false;
  const calls=matches.slice(0,5);
  for(const call of calls){
   const notes=await read('/Calls/'+call.sid+'/Notifications.json?PageSize=20');
   if(!Array.isArray(notes.notifications)||notes.notifications.length>20)return unavailable();
   if(notes.next_page_uri!==null)complete=false;
   for(const input of notes.notifications){
    const note=obj(input);if(note.account_sid!==account||note.call_sid!==call.sid)return unavailable();
    const code=note.error_code;if(typeof code==='string'&&/^[1-9]\d{4}$/.test(code))call.errorCodes.push(Number(code));else if(typeof code==='number'&&Number.isSafeInteger(code)&&code>=10000&&code<=99999)call.errorCodes.push(code);else complete=false;
   }
   call.errorCodes=[...new Set(call.errorCodes)].sort((a,b)=>a-b);
  }
  return {status:calls.length?'matched':'no_calls',complete,calls};
 }catch{return unavailable();}
}
