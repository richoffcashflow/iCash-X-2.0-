import {directCallTwiml} from './direct-call-entry.ts';
import {object,recordingBaseUrl,sha,sid,uuid,type RecordingRow} from './required-call-recording.ts';
import {RecordingProviderError,type RecordingEnv,type RecordingProviders} from './required-call-recording-provider.ts';

const terminal=new Set(['completed','failed','busy','no-answer','canceled']);
type ReadProvider=Pick<RecordingProviders,'listCallCandidates'|'getCall'|'getCallEventsPage'>;
type Result={status:string;call?:Record<string,unknown>;evidenceHash?:string;providerStatus?:number};
const timestamp=(value:unknown)=>typeof value==='string'?Date.parse(value):NaN;

function canonicalCandidate(row:RecordingRow,call:Record<string,unknown>){
 const created=timestamp(call.date_created),claimed=timestamp(row.dial_claimed_at);
 return sid(call.sid,'CA')&&call.account_sid===row.provider_account_sid&&call.from===row.from_phone&&call.to===row.to_phone
  &&call.direction==='outbound-api'&&(call.parent_call_sid===null||call.parent_call_sid===undefined)
  &&Number.isFinite(created)&&created>=claimed-2000&&created<=claimed+60000;
}

/** Original provider requests bind identity; a phone/time match is discovery only. */
function originalRequest(row:RecordingRow,call:Record<string,unknown>,raw:unknown,now:number){
 const event=object(raw),request=object(event.request),params=object(request.parameters),response=object(event.response);
 const occurred=timestamp(response.date_created);
 if(request.method!=='POST'||typeof request.url!=='string'||request.url.length>2048
  ||params.account_sid!==row.provider_account_sid||params.from!==row.from_phone||params.to!==row.to_phone
  ||!Number.isFinite(occurred)||occurred<timestamp(call.date_created)-2000||occurred>now)return false;
 let url:URL;try{url=new URL(request.url);}catch{return false;}
 if(url.username||url.password||url.hash)return false;
 const base=new URL(recordingBaseUrl);
 if(url.origin===base.origin&&url.pathname===base.pathname+'/terminal'){
  return url.searchParams.size===1&&url.searchParams.getAll('id').length===1&&url.searchParams.get('id')===row.id
   &&params.call_sid===call.sid&&params.call_status===call.status;
 }
 if(url.origin===base.origin&&['/connect','/consent','/notice'].some(path=>url.pathname===base.pathname+path)){
  const nonce=url.searchParams.get('nonce');
  return url.searchParams.size===2&&url.searchParams.getAll('id').length===1&&url.searchParams.get('id')===row.id
   &&url.searchParams.getAll('nonce').length===1&&typeof nonce==='string'&&/^[a-f0-9]{64}$/.test(nonce)
   &&sha(nonce)===row.nonce_hash&&params.call_sid===call.sid;
 }
 // Twilio also retains the original REST request and its 201 response.
 // The exact generated TwiML and saved nonce hash bind a lost creation receipt.
 if(row.entry_policy!=='direct_recorded_v1'||url.origin!=='https://api.twilio.com'||url.search
  ||![`/2010-04-01/Accounts/${row.provider_account_sid}/Calls.json`,`/2010-04-01/Accounts/${row.provider_account_sid}/Calls/${call.sid}.json`].includes(url.pathname)
  ||response.response_code!==201||occurred>timestamp(row.dial_claimed_at)+60000
  ||typeof params.twiml!=='string'||params.twiml.length>64000||typeof response.response_body!=='string'||response.response_body.length>64000)return false;
 const nonce=params.twiml.match(/&amp;nonce=([a-f0-9]{64})<\/Redirect>/)?.[1];
 if(!nonce||sha(nonce)!==row.nonce_hash||params.twiml!==directCallTwiml(recordingBaseUrl+'/connect',row.id,nonce)
  ||params.status_callback!==undefined&&params.status_callback!==recordingBaseUrl+'/terminal?id='+row.id)return false;
 let receipt:Record<string,unknown>;try{receipt=object(JSON.parse(response.response_body));}catch{return false;}
 return receipt.sid===call.sid&&['account_sid','from','to','direction'].every(key=>receipt[key]===undefined||receipt[key]===call[key]);
}

/** Three bounded GETs at most. No dial, end, retry, release or billing capability. */
export async function findMissingRecordedCall(row:RecordingRow,provider:ReadProvider,env:RecordingEnv,now=Date.now()):Promise<Result>{
 const claimed=timestamp(row.dial_claimed_at),created=timestamp(row.created_at);
 if(!uuid(row.id)||row.call_sid!==null||row.state!=='consent_pending'||row.start_claimed_at||row.recording_sid||row.conversation_id
  ||!sid(row.provider_account_sid,'AC')||row.provider_account_sid!==env.TWILIO_ACCOUNT_SID
  ||!/^[a-f0-9]{64}$/.test(row.nonce_hash??'')||!Number.isFinite(claimed)||!Number.isFinite(created)||claimed<created
  ||now-claimed<15*60000||now-created>30*86400000)return {status:'binding_not_eligible'};
 try{
  const page=await provider.listCallCandidates(row.from_phone,row.to_phone);
  if(page.page!==0||page.page_size!==25||page.next_page_uri!==null||!Array.isArray(page.calls)||page.calls.length>25)return {status:'candidate_page_incomplete'};
  const candidates=page.calls.map(object).filter(call=>canonicalCandidate(row,call));
  if(candidates.length!==1)return {status:candidates.length?'candidate_ambiguous':'original_call_not_found'};
  const call=await provider.getCall(String(candidates[0].sid));
  if(call.sid!==candidates[0].sid||!canonicalCandidate(row,call)||!terminal.has(String(call.status)))return {status:'terminal_call_required'};
  const finished=timestamp(call.end_time??call.date_updated);
  if(!Number.isFinite(finished)||finished<timestamp(call.date_created)||now-finished<15*60000)return {status:'events_not_ready'};
  const events=await provider.getCallEventsPage(String(call.sid),0);
  if(events.page!==0||events.page_size!==100||events.next_page_uri!==null||!Array.isArray(events.events)||events.events.length>100)return {status:'event_page_incomplete'};
  const matched=events.events.find(event=>originalRequest(row,call,event,now));
  if(!matched)return {status:'original_request_not_matched'};
  return {status:'original_receipt_matched',call,evidenceHash:sha(JSON.stringify(matched))};
 }catch(error){return {status:'provider_read_unavailable',...(error instanceof RecordingProviderError?{providerStatus:error.status}:{})};}
}
