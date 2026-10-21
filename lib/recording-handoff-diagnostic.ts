import {object,recordingBaseUrl,sha,sid,uuid,type RecordingRow} from './required-call-recording.ts';
import {RecordingProviderError,type RecordingEnv,type RecordingProviders} from './required-call-recording-provider.ts';

/** Read-only evidence for missing AI identities. Never authorizes binding, retry or settlement. */
export async function recordingHandoffDiagnostic(row:RecordingRow,provider:Pick<RecordingProviders,'getCall'|'getCallEventsPage'>,env:RecordingEnv,now=Date.now()){
 const result=(status:string,extra:Record<string,unknown>={})=>({status,...extra});
 if(!uuid(row.id)||!sid(row.call_sid,'CA')||row.provider_account_sid!==env.TWILIO_ACCOUNT_SID||!sid(row.provider_account_sid,'AC')||!row.start_claimed_at||row.conversation_id||!/^[a-f0-9]{64}$/.test(row.nonce_hash??''))return result('binding_unavailable');
 try{
  const call=await provider.getCall(row.call_sid);
  if(call.sid!==row.call_sid||call.account_sid!==row.provider_account_sid||call.from!==row.from_phone||call.to!==row.to_phone||call.direction!=='outbound-api')return result('carrier_binding_mismatch');
  if(!['completed','busy','failed','no-answer','canceled'].includes(String(call.status)))return result('call_not_terminal');
  const ended=typeof call.end_time==='string'?Date.parse(call.end_time):NaN;
  if(!Number.isFinite(ended)||now-ended<15*60*1000)return result('events_not_ready');
  const page=await provider.getCallEventsPage(row.call_sid,0);
  if(!Array.isArray(page.events)||page.events.length>100||page.page!==0||page.page_size!==100)return result('event_page_invalid');
  const events:Record<string,unknown>[]=[];
  for(const raw of page.events){
   const event=object(raw),request=object(event.request),params=object(request.parameters),response=object(event.response);
   if(request.method!=='POST'||typeof request.url!=='string'||request.url.length>2048)continue;
   let url:URL;try{url=new URL(request.url);}catch{continue;}
   const base=new URL(recordingBaseUrl);
   if(url.origin!==base.origin||!['/connect','/consent'].some(path=>url.pathname===base.pathname+path))continue;
   if(url.username||url.password||url.hash||url.searchParams.size!==2||url.searchParams.getAll('id').length!==1||url.searchParams.get('id')!==row.id||url.searchParams.getAll('nonce').length!==1||!/^[a-f0-9]{64}$/.test(url.searchParams.get('nonce')??'')||sha(url.searchParams.get('nonce')!)!==row.nonce_hash||params.account_sid!==row.provider_account_sid||params.call_sid!==row.call_sid)return result('event_binding_mismatch');
   const body=response.response_body;
   const bounded=typeof body==='string'&&body.length<=64000;
   // Presence markers only: they do not assert a valid XML document or an AI connection.
   events.push({httpStatus:Number.isInteger(response.response_code)&&Number(response.response_code)>=100&&Number(response.response_code)<=599?response.response_code:null,bodyBounded:bounded,connectMarker:bounded?/<Connect\b/.test(body):null,streamMarker:bounded?/<Stream\b/.test(body):null,hangupMarker:bounded?/<Hangup\b/.test(body):null});
  }
  return result(page.next_page_uri===null?'complete':'incomplete_page',{matchedEvents:events.length,events});
 }catch(error){return result('provider_read_unavailable',error instanceof RecordingProviderError?{providerStatus:error.status}:{});}
}
