import {recordingAuthorized,directCallTwiml} from './direct-call-entry.ts';
import {sellerContractToolMatches} from './seller-contract-tool.ts';
import {recordingConfidence} from './recording-consent-evidence.ts';
import {sellerContinuedSpeech,sellerNoticeTwiml,sellerNoticeEndTwiml} from './seller-call-notice.ts';
import {createHmac,randomBytes} from 'node:crypto';
import {usdMicros} from './voice-usage-service.ts';
import {affirmativeSpeech,recordingGateOptOut,audioAvailable,endTwiml,object,privateHeaders,readRecordingReview,recordingAgentMatches,recordingBaseUrl,recordingDisclosure,recordingPolicy,recordingPricing,sha,sid,uuid,verifiedTwilioForm,consentTwiml,type RecordingRow,type RecordingReview} from './required-call-recording.ts';
import {boundedBytes,RecordingProviderError,type RecordingEnv,type RecordingProviders} from './required-call-recording-provider.ts';
export type RecordingDb=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
export type RecordingDeps={db:RecordingDb;provider:RecordingProviders;now?:()=>number;dispatchAllowed?:()=>boolean};
const hangup=()=>new Response('<Response><Hangup/></Response>',{headers:{...privateHeaders,'Content-Type':'text/xml'}});
const xml=(s:string)=>new Response(s,{headers:{...privateHeaders,'Content-Type':'text/xml'}});
const eq=encodeURIComponent;
export const recordingStopToken=(operation:string,env:RecordingEnv)=>createHmac('sha256',env.TWILIO_AUTH_TOKEN!).update('icash-recording-stop-v1:'+operation).digest('hex');
const transition=(db:RecordingDb,r:RecordingRow,action:string,payload:Record<string,unknown>={})=>db<RecordingRow|null>('rpc/icash_transition_call_recording','POST',{p_id:r.id,p_account:r.account_id,p_operation:r.operation_key,p_expected_state:r.state,p_action:action,p_payload:payload});
async function getRow(db:RecordingDb,id:string,accountId?:string){if(!uuid(id)||accountId!==undefined&&!uuid(accountId))return null;const rows=await db<RecordingRow[]>(`icash_call_recordings?id=eq.${id}${accountId?'&account_id=eq.'+eq(accountId):''}&select=*`);return rows.length===1?rows[0]:null;}
function canonicalCall(row:RecordingRow,c:Record<string,unknown>,now:number,active=false,fresh=true){
 const age=now-Date.parse(String(c.date_created));
 return sid(c.sid,'CA')&&(row.call_sid===null||row.call_sid===c.sid)&&c.account_sid===row.provider_account_sid&&c.from===row.from_phone&&c.to===row.to_phone&&c.direction==='outbound-api'&&(!fresh||Number.isFinite(age)&&age>=0&&age<=20*60000)&&(!active||c.status==='in-progress');
}
function recordingReceipt(r:RecordingRow,p:Record<string,unknown>){return sid(p.sid,'RE')&&p.account_sid===r.provider_account_sid&&p.call_sid===r.call_sid&&(r.recording_sid===null||r.recording_sid===p.sid);}
function finalRecordingPayload(p:Record<string,unknown>){
 const duration=Number(p.duration),start=Date.parse(String(p.start_time));
 if(typeof p.duration!=='string'||!/^\d+$/.test(p.duration)||!Number.isSafeInteger(duration)||duration<0||duration>600||!Number.isFinite(start))throw Error('RECORDING_RECEIPT_INVALID');
 const price=typeof p.price==='string'&&/^-?\d+(?:\.\d{1,6})?$/.test(p.price)&&p.price_unit==='USD'?usdMicros(p.price.replace(/^-/,'') ):null;
 return {recordingSid:p.sid,providerStartedAt:new Date(start).toISOString(),endedAt:new Date(start+duration*1000).toISOString(),durationSeconds:duration,...(price===null?{}:{providerRecordingPriceMicros:price})};
}
export function recordingService(env:RecordingEnv,{db,provider,now=Date.now,dispatchAllowed=()=>true}:RecordingDeps){
 async function endBound(row:RecordingRow){
  if(!row.call_sid)return false;
  if(row.start_claimed_at&&!row.end_requested_at){const requested=await transition(db,row,'stop',{stopTokenHash:row.stop_token_hash}).catch(()=>null);if(requested)Object.assign(row,requested);}
  try{const c=await provider.end(row.call_sid);const ended=c.sid===row.call_sid&&c.account_sid===row.provider_account_sid&&c.status==='completed';
   if(ended&&row.end_requested_at&&!row.call_ended_at){const saved=await transition(db,row,'call_ended',{callSid:row.call_sid,providerAccountSid:row.provider_account_sid,status:'completed'}).catch(()=>null);if(saved)Object.assign(row,saved);}
   return ended;
  }catch{return false;}
 }
 async function readReview(){if(env.ICASH_RECORDED_OUTBOUND_READY!=='true')return null;const r=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON,now());if(!r||r.providerAccountSid!==env.TWILIO_ACCOUNT_SID)return null;return r;}
 async function checkAgent(review:RecordingReview){
  if(!recordingAgentMatches(review,await provider.agent(review)))return false;
  if(review.contractToolId&&!sellerContractToolMatches(await provider.tool(review.contractToolId),review.contractToolId))return false;
  const tool=await provider.tool(review.stopToolId),config=object(tool.tool_config),api=object(config.api_schema),body=object(api.request_body_schema),props=object(body.properties),id=object(props.recordingId),auth=object(object(api.request_headers).Authorization);
  return tool.id===review.stopToolId&&config.type==='webhook'&&config.name==='icash_stop_recording'&&api.url===recordingBaseUrl+'/stop'&&api.method==='POST'&&Object.keys(auth).length===1&&auth.variable_name==='secret__icash_recording_stop_token'&&body.type==='object'&&Array.isArray(body.required)&&body.required.length===1&&body.required[0]==='recordingId'&&Object.keys(props).length===1&&id.type==='string'&&id.dynamic_variable==='icash_recording_id'&&(api.auth_connection===null||api.auth_connection===undefined)&&(!tool.response_mocks||Array.isArray(tool.response_mocks)&&tool.response_mocks.length===0);
 }
 async function bindCall(row:RecordingRow,call:Record<string,unknown>){
  if(!canonicalCall(row,call,now()))return null;
  return row.call_sid?row:transition(db,row,'bind_call',{callSid:call.sid,providerAccountSid:call.account_sid,fromPhone:call.from,toPhone:call.to});
 }
 return {
  /** Internal adapter only. SQL requires already-reserved/dispatched operation and reviewed contact gates.
   * Wired only after normal dispatcher reserve/claim; recorded rate/config rollout is required first. */
  async dispatch(input:{maxTotalSeconds?:number;buyerKind?:'company'|'individual';accountId:string;operationKey:string;principal:string;assistantName:string;voiceId?:string;firstMessage:string;prompt:string;strategyKey:'cash_interest'|'flexible_timing'}){
   if(!dispatchAllowed())return {status:'recording_release_required'};
   const review=await readReview();if(!review||!await checkAgent(review))return {status:'recording_review_required'};
   if(!dispatchAllowed())return {status:'recording_release_required'};
   if(!uuid(input.accountId)||!/^voice:[0-9a-f-]{36}$/i.test(input.operationKey)||input.prompt.length>24000||input.firstMessage.length>2000)throw Error('RECORDING_CONTEXT_REQUIRED');
   const maxSeconds=input.maxTotalSeconds??600;if(!Number.isInteger(maxSeconds)||maxSeconds<120||maxSeconds>600||maxSeconds%60!==0)throw Error('CALL_CAP_REQUIRED');
   const disclosure=recordingDisclosure(input.principal,input.assistantName,input.buyerKind),nonce=randomBytes(32).toString('hex'),stop=recordingStopToken(input.operationKey,env);
   let row=await db<RecordingRow|null>('rpc/icash_create_direct_recorded_call','POST',{p_account:input.accountId,p_operation:input.operationKey,p_provider_account_sid:review.providerAccountSid,p_call_sid:null,p_nonce_hash:sha(nonce),p_stop_token_hash:sha(stop),p_disclosure_version:recordingPolicy.disclosureVersion,p_pricing_policy:recordingPricing,p_context:{fromPhone:review.fromPhone,branchId:review.branchId,versionId:review.versionId,maxTotalSeconds:maxSeconds,callContext:{principal:input.principal,assistantName:input.assistantName,firstMessage:input.firstMessage,prompt:input.prompt,strategyKey:input.strategyKey,...(input.voiceId?{voiceId:input.voiceId}:{})}}});
   if(!row)return {status:'recording_admission_held'};
   if(!dispatchAllowed())return {status:'recording_release_required'};
   row=await transition(db,row,'claim_dial');if(!row)return {status:'recording_dial_already_claimed'};
   // A changed release after any asynchronous preflight/admission cannot start a call.
   if(!dispatchAllowed())return {status:'recording_release_required'};
   try{
    const call=await provider.dial(row.from_phone,row.to_phone,directCallTwiml(recordingBaseUrl+'/connect',row.id,nonce),recordingBaseUrl+'/terminal?id='+row.id,row.max_total_seconds);
    const bound=await bindCall(row,call);if(!bound)throw Error('CALL_BINDING_UNCERTAIN');
    return {status:'recording_consent_pending',recordingId:row.id};
   }catch{await transition(db,row,'dial_unknown').catch(()=>null);return {status:'recording_dial_unknown_no_retry'};}
  },
  async consent(request:Request,noticeMode=false,directMode=false){
   let row:RecordingRow|null=null;
   const finishTwiml=noticeMode?sellerNoticeEndTwiml:endTwiml;
   try{
    const u=new URL(request.url),id=u.searchParams.get('id'),nonce=u.searchParams.get('nonce');
    const path=directMode?'connect':noticeMode?'notice':'consent';
    if(request.method!=='POST'||u.pathname!=='/api/internal/voice/recording/'+path||u.searchParams.size!==2||!uuid(id)||!nonce||!/^[a-f0-9]{64}$/.test(nonce)||request.headers.get('content-type')?.split(';')[0]!=='application/x-www-form-urlencoded')return hangup();
    const canonical=recordingBaseUrl+'/'+path+'?id='+id+'&nonce='+nonce;
    const form=verifiedTwilioForm((await boundedBytes(request,16384)).toString('utf8'),request.headers.get('x-twilio-signature'),env.TWILIO_AUTH_TOKEN??'',canonical);
    if(!form||form.get('AccountSid')!==env.TWILIO_ACCOUNT_SID||!sid(form.get('CallSid'),'CA'))return hangup();
    row=await getRow(db,id);if(!row||row.nonce_hash!==sha(nonce)||row.provider_account_sid!==env.TWILIO_ACCOUNT_SID||noticeMode&&row.party!=='seller'||directMode!==(row.entry_policy==='direct_recorded_v1'))return hangup();
    const call=await provider.getCall(form.get('CallSid')!);
    if(!canonicalCall(row,call,now(),true))return hangup();
    row=await bindCall(row,call);if(!row)return hangup();
    // Replayed or concurrent callbacks cannot start/register again. Ending is safest.
    if(row.state!=='consent_pending'||row.consent_at){await endBound(row);return hangup();}
    const optOut=recordingGateOptOut(form);
    if(optOut){const stopped=await transition(db,row,'contact_opt_out',{nonceHash:sha(nonce),utterance:optOut});if(stopped)row=stopped;await endBound(row);return xml(finishTwiml);}
    const age=now()-Date.parse(String(call.start_time));
    const review=await readReview();
    if(!review||row.agent_id!==review.agentId||row.branch_id!==review.branchId||row.version_id!==review.versionId||row.disclosure_version!==recordingPolicy.disclosureVersion||!Number.isFinite(age)||age<0||age>recordingPolicy.consentWindowSeconds*1000||!await checkAgent(review)){
     await transition(db,row,'decline',{reason:'timeout'});await endBound(row);return hangup();
    }
    if(directMode){
     const authorized=await transition(db,row,'authorize_recording',{nonceHash:sha(nonce),policy:'direct_recorded_v1'});if(!authorized){await endBound(row);return hangup();}row=authorized;
    }else{
    const yes=noticeMode?sellerContinuedSpeech(form):affirmativeSpeech(form);
    if(!yes){
     const confidence=recordingConfidence(form.get('Confidence'));
     if(form.has('SpeechResult')&&(confidence.status==='malformed'||form.has('UnstableSpeechResult')))await transition(db,row,'fail',{reason:'consent_asr_evidence_unverified'});
     else await transition(db,row,'decline',{reason:form.has('SpeechResult')?'ambiguous':'timeout'});
     await endBound(row);return xml(finishTwiml);
    }
    const consented=await transition(db,row,noticeMode?'notice_continue':'consent',{nonceHash:sha(nonce),source:'twilio_gather_speech',...yes,disclosureVersion:recordingPolicy.disclosureVersion});if(!consented){await endBound(row);return hangup();}row=consented;
    }
    const claimed=await transition(db,row,'claim_start');if(!claimed){await endBound(row);return hangup();}row=claimed;
    try{
     const p=await provider.start(row.call_sid!,recordingBaseUrl+'/status?id='+row.id);
     if(!recordingReceipt(row,p)||p.status!=='in-progress'||!Number.isFinite(Date.parse(String(p.start_time))))throw Error('START_NOT_CONFIRMED');
     const saved=await transition(db,row,'started',{recordingSid:p.sid,providerStartedAt:new Date(String(p.start_time)).toISOString()});
     if(saved)row=saved;else{
      // The authenticated in-progress callback may win the same immutable binding first.
      const current=await getRow(db,row.id);
      if(!current||current.account_id!==row.account_id||current.operation_key!==row.operation_key||current.state!=='recording'||current.end_requested_at||!recordingAuthorized(current)||!current.start_claimed_at||current.recording_sid!==p.sid||Date.parse(current.provider_started_at??'')!==Date.parse(String(p.start_time)))throw Error('START_NOT_SAVED');
      row=current;
     }
     const seconds=Math.floor((now()-Date.parse(String(call.start_time)))/1000),remaining=row.max_total_seconds-seconds;
     if(remaining<1||remaining>row.max_total_seconds)throw Error('CALL_CAP_REQUIRED');
     // Record confirmed before connecting AI; no unrecorded continuation.
     return xml(await provider.register(row,remaining,recordingStopToken(row.operation_key,env)));
    }catch{
     if(row){if(row.state==='starting')await transition(db,row,'start_unknown').catch(()=>null);await endBound(row);}return hangup();
    }
   }catch{if(row)await endBound(row);return hangup();}
  },
  async status(request:Request){
   try{
    const u=new URL(request.url),id=u.searchParams.get('id');if(!uuid(id)||u.searchParams.size!==1||request.method!=='POST'||u.pathname!=='/api/internal/voice/recording/status')return new Response(null,{status:400});
    const f=verifiedTwilioForm((await boundedBytes(request,16384)).toString('utf8'),request.headers.get('x-twilio-signature'),env.TWILIO_AUTH_TOKEN??'',recordingBaseUrl+'/status?id='+id);
    const row=await getRow(db,id);if(!f||!row||f.get('AccountSid')!==row.provider_account_sid||f.get('CallSid')!==row.call_sid||!sid(f.get('RecordingSid'),'RE')||row.recording_sid&&row.recording_sid!==f.get('RecordingSid'))return new Response(null,{status:401});
    const p=await provider.getRecording(f.get('RecordingSid')!);if(!recordingReceipt(row,p)||!recordingAuthorized(row)||!row.start_claimed_at)return new Response(null,{status:409});
    let current=row;
    if(!current.recording_sid&&['starting','failed'].includes(current.state)){const bound=await transition(db,current,'started',{recordingSid:p.sid,providerStartedAt:new Date(String(p.start_time)).toISOString()});if(!bound)return new Response(null,{status:409});current=bound;}
    if(p.status==='completed'&&!['deleted','expired','deletion_pending'].includes(current.state)){await endBound(current);await transition(db,current,'available',finalRecordingPayload(p));}
    else if(p.status==='absent'&&!['deleted','expired','deletion_pending'].includes(current.state)){const ended=await endBound(current);await transition(db,current,'absent',{});if(!ended)return new Response(null,{status:503,headers:privateHeaders});}
    return new Response(null,{status:204,headers:privateHeaders});
   }catch{return new Response(null,{status:503,headers:privateHeaders});}
  },
  async stop(request:Request){
   try{
    const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!token||!/^[a-f0-9]{64}$/.test(token))return Response.json({stopped:false},{status:401,headers:privateHeaders});
    const b=object(JSON.parse((await boundedBytes(request,2048)).toString('utf8')));if(Object.keys(b).length!==1||!uuid(b.recordingId))return Response.json({stopped:false},{status:400,headers:privateHeaders});
    let row=await getRow(db,b.recordingId);if(!row||row.stop_token_hash!==sha(token)||!row.call_sid||!recordingAuthorized(row)||now()-Date.parse(row.created_at)>20*60000)return Response.json({stopped:false},{status:401,headers:privateHeaders});
    const next=await transition(db,row,'stop',{stopTokenHash:sha(token)});if(next)row=next;
    // Required-recording withdrawal ends the whole call. Partial success is not completion.
    const ended=await endBound(row);let stopped=ended;
    if(!ended&&row.recording_sid){try{const p=await provider.stop(row.call_sid!,row.recording_sid);stopped=recordingReceipt(row,p)&&['stopped','completed','processing'].includes(String(p.status));}catch{/* Durable end request remains due. */}}
    if(!ended)return Response.json({stopped,callEnded:false,instruction:'Call termination is not confirmed. End this call now; do not continue talking.'},{status:503,headers:privateHeaders});
    const confirmed=await transition(db,row,'call_ended',{callSid:row.call_sid,providerAccountSid:row.provider_account_sid,status:'completed'});if(confirmed)row=confirmed;
    if(row.recording_sid&&row.provider_started_at)await transition(db,row,'processing',{recordingSid:row.recording_sid,providerStartedAt:row.provider_started_at}).catch(()=>null);
    return Response.json({stopped:stopped||ended,callEnded:ended,instruction:'Permission withdrawn. End the call; do not continue the conversation.'},{headers:privateHeaders});
   }catch{return Response.json({stopped:false,instruction:'Stop is not confirmed. End this call now.'},{status:503,headers:privateHeaders});}
  },
  async audio(accountId:string,id:string,range:string|null){
   const row=await getRow(db,id,accountId);if(!row||row.account_id!==accountId||!audioAvailable(row,now()))return new Response(null,{status:404,headers:privateHeaders});
   if(range&&!/^bytes=\d+-\d*$/.test(range))return new Response(null,{status:416,headers:privateHeaders});
   const media=await provider.media(row.recording_sid!);
   if(!audioAvailable(row,now()))return new Response(null,{status:404,headers:privateHeaders});
   const headers={...privateHeaders,'Content-Type':'audio/mpeg','Accept-Ranges':'bytes'};
   if(!range)return new Response(media,{headers:{...headers,'Content-Length':String(media.length)}});
   const [start,end]=range.slice(6).split('-'),from=Number(start),to=end?Number(end):media.length-1;
   if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>to||from>=media.length||to>=media.length)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${media.length}`}});
   return new Response(media.subarray(from,to+1),{status:206,headers:{...headers,'Content-Length':String(to-from+1),'Content-Range':`bytes ${from}-${to}/${media.length}`}});
  },
 };
}
export {getRow as getRecordingRow,transition as recordingTransition,recordingReceipt,finalRecordingPayload,canonicalCall};
