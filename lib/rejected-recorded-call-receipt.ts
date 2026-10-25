import {directCallTwiml} from './direct-call-entry.ts';
import {object,recordingBaseUrl,sha,sid,uuid,type RecordingRow} from './required-call-recording.ts';
import {RecordingProviderError,type RecordingEnv,type RecordingProviders} from './required-call-recording-provider.ts';

// Documented pre-creation rejections, never carrier terminal-call failures.
const rejectedCodes=new Set([21210,21211,21212,21215]);
type ReadProvider=Pick<RecordingProviders,'listCallCreationAlerts'|'getCallCreationAlert'>;
type Result={status:string;proof?:Record<string,unknown>;errorCode?:number;providerStatus?:number;alertCount?:number;candidateCount?:number;errorCodes?:number[]};
function parameters(raw:unknown){
 if(typeof raw!=='string'||raw.length>64000)return null;
 let entries:[string,unknown][];
 try{
  if(raw.trim().startsWith('{')){const parsed=JSON.parse(raw);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return null;entries=Object.entries(parsed);}
  else entries=[...new URLSearchParams(raw)];
 }catch{return null;}
 const result:Record<string,string>={};
 for(const [key,value] of entries){const normalized=key.toLowerCase().replaceAll('_','');if(Object.hasOwn(result,normalized)||typeof value!=='string')return null;result[normalized]=value;}
 return result;
}
function proofFor(row:RecordingRow,raw:unknown,now:number){
 const a=object(raw),code=Number(a.error_code),generated=typeof a.date_generated==='string'?Date.parse(a.date_generated):NaN;
 const claimed=Date.parse(typeof row.dial_claimed_at==='string'?row.dial_claimed_at:'');
 if(typeof a.sid!=='string'||!sid(a.sid,'NO')||a.account_sid!==row.provider_account_sid||a.request_method!=='POST'
  ||a.request_url!==`https://api.twilio.com/2010-04-01/Accounts/${row.provider_account_sid}/Calls.json`
  ||a.resource_sid!==null&&a.resource_sid!==''||!rejectedCodes.has(code)
  ||!Number.isFinite(generated)||generated<claimed-2000||generated>claimed+60000||generated>now)return null;
 const p=parameters(a.request_variables);
 if(!p||p.from!==row.from_phone||p.to!==row.to_phone||typeof p.twiml!=='string')return null;
 const nonce=p.twiml.match(/&amp;nonce=([a-f0-9]{64})<\/Redirect>/)?.[1];
 if(!nonce||sha(nonce)!==row.nonce_hash||p.twiml!==directCallTwiml(recordingBaseUrl+'/connect',row.id,nonce)
  ||p.statuscallback!==undefined&&p.statuscallback!==recordingBaseUrl+'/terminal?id='+row.id)return null;
 let response:Record<string,unknown>;
 try{if(typeof a.response_body!=='string'||a.response_body.length>64000)return null;response=object(JSON.parse(a.response_body));}catch{return null;}
 if(response.status!==400||response.code!==code||response.sid!==undefined||response.call_sid!==undefined)return null;
 return {recordingId:row.id,providerAccountSid:a.account_sid,alertSid:a.sid,errorCode:code,responseStatus:400,
  resourceSid:null,requestMethod:'POST',requestUrl:a.request_url,fromPhone:p.from,toPhone:p.to,nonceHash:row.nonce_hash,
  generatedAt:new Date(generated).toISOString(),requestHash:sha(JSON.stringify(p)),
  evidenceHash:sha(JSON.stringify({sid:a.sid,account_sid:a.account_sid,date_generated:a.date_generated,error_code:a.error_code,
   request_method:a.request_method,request_url:a.request_url,request_variables:a.request_variables,response_body:a.response_body,resource_sid:a.resource_sid}))};
}
/** GET-only recovery. Absence of a call is never proof of a rejected request. */
export async function findRejectedRecordedCall(row:RecordingRow,provider:ReadProvider,env:RecordingEnv,now=Date.now()):Promise<Result>{
 const claimedAt=typeof row.dial_claimed_at==='string'?row.dial_claimed_at:'',claimed=Date.parse(claimedAt),created=Date.parse(row.created_at);
 if(!uuid(row.id)||row.entry_policy!=='direct_recorded_v1'||row.call_sid!==null||row.state!=='consent_pending'
  ||row.start_claimed_at||row.recording_sid||row.conversation_id||row.recording_authorized_at||row.consent_at||row.provider_started_at||row.end_requested_at||row.call_ended_at
  ||typeof row.provider_account_sid!=='string'||!sid(row.provider_account_sid,'AC')
  ||row.provider_account_sid!==env.TWILIO_ACCOUNT_SID||!/^[a-f0-9]{64}$/.test(row.nonce_hash??'')
  ||!Number.isFinite(claimed)||!Number.isFinite(created)||claimed<created||now-claimed<60000||now-created>30*86400000)return {status:'binding_not_eligible'};
 try{
  const page=await provider.listCallCreationAlerts(claimedAt),meta=object(page.meta);
  if(meta.page!==0||meta.page_size!==20||meta.next_page_url!==null||!Array.isArray(page.alerts)||page.alerts.length>20)return {status:'alert_page_incomplete'};
  const candidates=page.alerts.map(object).filter(a=>typeof a.sid==='string'&&sid(a.sid,'NO')&&a.account_sid===row.provider_account_sid
   &&a.request_method==='POST'&&a.request_url===`https://api.twilio.com/2010-04-01/Accounts/${row.provider_account_sid}/Calls.json`
   &&rejectedCodes.has(Number(a.error_code)));
  const diagnostic={alertCount:page.alerts.length,candidateCount:candidates.length,errorCodes:[...new Set(page.alerts.map(object).map(a=>Number(a.error_code)).filter(c=>Number.isSafeInteger(c)&&c>=10000&&c<=99999))].sort()};
  if(candidates.length>3)return {status:'alert_candidates_incomplete',...diagnostic};
  const matches:Record<string,unknown>[]=[];
  for(const candidate of candidates){const detail=await provider.getCallCreationAlert(String(candidate.sid));if(detail.sid!==candidate.sid)continue;const proof=proofFor(row,detail,now);if(proof)matches.push(proof);}
  if(matches.length!==1)return {status:matches.length?'original_rejection_ambiguous':'original_rejection_not_found',...diagnostic};
  return {status:'original_rejection_matched',proof:matches[0],errorCode:Number(matches[0].errorCode)};
 }catch(error){return {status:'rejection_read_unavailable',...(error instanceof RecordingProviderError?{providerStatus:error.status}:{})};}
}
