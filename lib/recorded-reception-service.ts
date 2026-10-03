import {randomBytes} from 'node:crypto';
import {affirmativeSpeech,recordingGateOptOut,endTwiml,object,privateHeaders,sha,sid,uuid,verifiedTwilioForm} from './required-call-recording.ts';
import {boundedBytes} from './required-call-recording-provider.ts';
import {finalRecordingPayload} from './required-call-recording-service.ts';
import {receptionTarget,rejectTwiml,receptionWorkspacePostcallAbsent} from './general-reception.ts';
import {propertyReceptionEnabled} from './reception-property-context.ts';
import {recordedReceptionUrl,recordedReceptionPolicy,receptionConsentTwiml,receptionCallerHash,receptionStopToken,validRecordedReceptionConfig,inspectRecordedReceptionAgent,recordedReceptionToolMatches,incomingCallMatches,incomingCallIdentityMatches,receptionRecordingMatches,receptionAudioAvailable,type RecordedReceptionRpc,type RecordedReceptionRow,type RecordedReceptionConfig,type RecordedReceptionEnv} from './recorded-reception.ts';
import type {RecordedReceptionProviders} from './recorded-reception-provider.ts';
const xml=(body:string)=>new Response(body,{headers:{...privateHeaders,'Content-Type':'application/xml; charset=utf-8'}});
const hangup=()=>xml('<Response><Hangup/></Response>');
const terminalStatuses=new Set(['completed','failed','busy','no-answer','canceled']);
export const getRecordedReception=(rpc:RecordedReceptionRpc,id:string,account:string|null=null)=>rpc<RecordedReceptionRow|null>('icash_get_recorded_reception_session',{p_id:id,p_account:account,p_operation:null});
export const transitionRecordedReception=(rpc:RecordedReceptionRpc,row:RecordedReceptionRow,action:string,payload:Record<string,unknown>={})=>rpc<RecordedReceptionRow|null>('icash_transition_recorded_reception',{p_id:row.id,p_account:row.account_id,p_operation:row.operation_key,p_expected_version:row.row_version,p_action:action,p_payload:payload});
export const boundEndReceipt=(r:RecordedReceptionRow,c:Record<string,unknown>)=>({callSid:r.call_sid,providerAccountSid:r.provider_account_sid,fromPhone:r.from_phone,toPhone:r.to_phone,direction:'inbound',status:c.status});
/** Freeze the answered-call clock only from a canonical, fully bound readback.
 * A lost CAS response may recover the identical value, never move the deadline.
 * Unanswered calls do not need a start time to terminate or settle carrier cost. */
export async function bindRecordedReceptionCallStart(rpc:RecordedReceptionRpc,row:RecordedReceptionRow,call:Record<string,unknown>){
 if(!incomingCallMatches(row,call))throw Error('CALL_BINDING_REQUIRED');
 if(row.call_started_at)return row;
 if(!row.setup_confirmed_at||call.status==='ringing')return row;
 if(call.start_time===null||call.start_time===undefined){if(['in-progress','completed'].includes(String(call.status)))throw Error('CALL_START_REQUIRED');return row;}
 const started=Date.parse(String(call.start_time));if(!Number.isFinite(started))throw Error('CALL_START_REQUIRED');
 const next=await transitionRecordedReception(rpc,row,'bind_call_start',{...boundEndReceipt(row,call),callStartedAt:new Date(started).toISOString()});
 if(next)return next;
 const fresh=await getRecordedReception(rpc,row.id,row.account_id);
 if(!fresh?.call_started_at||Date.parse(fresh.call_started_at)!==started||!incomingCallMatches(fresh,call))throw Error('CALL_START_NOT_SAVED');
 return fresh;
}
/** Best-effort immediate termination plus durable end intent. A stopped recording
 * alone is never treated as successful call termination. No capture flag here. */
export async function endRecordedReception(rpc:RecordedReceptionRpc,provider:RecordedReceptionProviders,input:RecordedReceptionRow,reason='required_recording_ended'){
 let row=input;
 if(!row.end_requested_at){const next=await transitionRecordedReception(rpc,row,'request_end',{reason}).catch(()=>null);if(next)row=next;else{const fresh=await getRecordedReception(rpc,row.id,row.account_id).catch(()=>null);if(fresh)row=fresh;}}
 let actual=await provider.getCall(row.call_sid).catch(()=>null);
 if(!actual||!incomingCallIdentityMatches(row,actual)||!terminalStatuses.has(String(actual.status))){
  const c=await provider.end(row.call_sid).catch(()=>null);
  if(!c||c.sid!==row.call_sid||c.account_sid!==row.provider_account_sid||c.status!=='completed')return {ended:false,row};
  // Read canonical call after mutation: never invent direction/phone binding.
  actual=await provider.getCall(row.call_sid).catch(()=>null);
 }
 if(!actual||!incomingCallIdentityMatches(row,actual)||!terminalStatuses.has(String(actual.status)))return {ended:false,row};
 row=await bindRecordedReceptionCallStart(rpc,row,actual).catch(()=>row);
 if(!row.end_requested_at){const next=await transitionRecordedReception(rpc,row,'request_end',{reason}).catch(()=>null);if(next)row=next;}
 if(!row.call_ended_at){const next=await transitionRecordedReception(rpc,row,'call_ended',boundEndReceipt(row,actual)).catch(()=>null);if(next)row=next;}
 return {ended:!!row.call_ended_at,row};
}
export function recordedReceptionService(env:RecordedReceptionEnv,deps:{rpc:RecordedReceptionRpc;provider:RecordedReceptionProviders;now?:()=>number}){
 const {rpc,provider}=deps,now=deps.now??Date.now;
 const transition=(r:RecordedReceptionRow,a:string,p:Record<string,unknown>={})=>transitionRecordedReception(rpc,r,a,p);
 async function currentConfig(called:string){if(env.ICASH_RECORDED_RECEPTION_READY!=='true')return null;const c=await rpc<RecordedReceptionConfig|null>('icash_get_recorded_reception_config',{p_called_number:called});return validRecordedReceptionConfig(c,now())&&c.provider_account_sid===env.TWILIO_ACCOUNT_SID?c:null;}
 async function checkAgent(c:RecordedReceptionConfig){
  const [agent,branches,workspace,tool]=await Promise.all([provider.agent(c),provider.branches(c),provider.workspace(),provider.tool(c.stop_tool_id)]);
  const rows=branches.results,meta=object(branches.meta);if(!Array.isArray(rows)||rows.length>=100||meta.total!==undefined&&meta.total!==rows.length)return false;
  const found=rows.filter(r=>object(r).id===c.branch_id);
  return found.length===1&&inspectRecordedReceptionAgent(c,agent,found[0],receptionWorkspacePostcallAbsent(workspace),tool).safe&&recordedReceptionToolMatches(c.stop_tool_id,tool);
 }
 async function signed(request:Request,part:string,nonceRequired=false){
  const u=new URL(request.url),id=u.searchParams.get('id'),nonce=u.searchParams.get('nonce');
  if(request.method!=='POST'||u.pathname!=='/api/reception/recorded/'+part||u.searchParams.size!==(nonceRequired?2:1)||!uuid(id)||nonceRequired&&!/^[a-f0-9]{64}$/.test(nonce??'')||request.headers.get('content-type')?.split(';')[0].trim()!=='application/x-www-form-urlencoded')return null;
  const target=recordedReceptionUrl+'/'+part+'?id='+id+(nonceRequired?'&nonce='+nonce:'');
  const f=verifiedTwilioForm((await boundedBytes(request,16384)).toString('utf8'),request.headers.get('x-twilio-signature'),env.TWILIO_AUTH_TOKEN??'',target);
  if(!f||f.get('AccountSid')!==env.TWILIO_ACCOUNT_SID||!sid(f.get('CallSid'),'CA'))return null;
  const row=await getRecordedReception(rpc,id);if(!row||row.call_sid!==f.get('CallSid')||row.provider_account_sid!==env.TWILIO_ACCOUNT_SID||nonceRequired&&row.nonce_hash!==sha(nonce!))return null;
  return {row,f,nonce};
 }
 return {
  async inbound(request:Request){
   let row:RecordedReceptionRow|null=null;
   try{
    if(env.ICASH_RECORDED_RECEPTION_READY!=='true')return xml(rejectTwiml);
    const u=new URL(request.url);if(request.method!=='POST'||u.pathname!=='/api/reception/recorded/inbound'||u.search||request.headers.get('content-type')?.split(';')[0].trim()!=='application/x-www-form-urlencoded')return xml(rejectTwiml);
    const f=verifiedTwilioForm((await boundedBytes(request,16384)).toString('utf8'),request.headers.get('x-twilio-signature'),env.TWILIO_AUTH_TOKEN??'',recordedReceptionUrl+'/inbound');
    if(!f||f.get('AccountSid')!==env.TWILIO_ACCOUNT_SID||f.get('Direction')!=='inbound'||f.get('CallStatus')!=='ringing'||f.get('To')!==receptionTarget.calledNumber||!sid(f.get('CallSid'),'CA'))return xml(rejectTwiml);
    const from=f.get('From')??'';if(!/^\+[1-9]\d{7,14}$/.test(from)&&!['anonymous','restricted','unknown'].includes(from))return xml(rejectTwiml);
    const c=await currentConfig(f.get('To')!);if(!c)return xml(rejectTwiml);
    const callerHash=receptionCallerHash(from,env);if(c.call_profile==='owner_quick_test'&&c.owner_caller_hash!==callerHash)return xml(rejectTwiml);
    const call=await provider.getCall(f.get('CallSid')!);const age=now()-Date.parse(String(call.date_created));
    if(call.sid!==f.get('CallSid')||call.account_sid!==c.provider_account_sid||call.from!==from||call.to!==c.called_number||call.direction!=='inbound'||call.status!=='ringing'||!Number.isFinite(age)||age<0||age>120000||!await checkAgent(c))return xml(rejectTwiml);
    const nonce=randomBytes(32).toString('hex'),op='recorded-reception:'+call.sid,token=receptionStopToken({operation_key:op},env);
    const admission=await rpc<{allowed:boolean;session:RecordedReceptionRow}>('icash_reserve_recorded_reception',{p_config_id:c.id,p_call_sid:call.sid,p_provider_account_sid:c.provider_account_sid,p_from_phone:from,p_to_phone:c.called_number,p_direction:'inbound',p_caller_hash:callerHash,p_nonce_hash:sha(nonce),p_stop_token_hash:sha(token),p_config_hash:c.config_hash,p_version_id:c.reviewed_version_id});
    if(admission?.allowed!==true||!admission.session)return xml(rejectTwiml);row=admission.session;
    if(row.operation_key!==op||row.account_id!==c.account_id||row.config_id!==c.id||row.call_sid!==call.sid||row.provider_account_sid!==c.provider_account_sid||row.from_phone!==from||row.to_phone!==c.called_number||row.max_total_seconds!==c.max_duration_seconds||row.charge_cap_cents!==c.customer_charge_cap_cents||row.rate_id!==c.rate_id||row.nonce_hash!==sha(nonce)||row.stop_token_hash!==sha(token))throw Error('RESERVATION_BINDING_REQUIRED');
    const claimed=await transition(row,'claim_setup');if(!claimed)throw Error('SETUP_ALREADY_CLAIMED');row=claimed;
    const bounded=await provider.boundCall(row);if(!incomingCallMatches(row,bounded,now())||!['ringing','in-progress'].includes(String(bounded.status)))throw Error('PROVIDER_BOUND_UNCONFIRMED');
    const saved=await transition(row,'bounded',{callSid:row.call_sid,providerAccountSid:row.provider_account_sid,fromPhone:row.from_phone,toPhone:row.to_phone,direction:'inbound',timeLimitSeconds:row.max_total_seconds});if(!saved)throw Error('PROVIDER_BOUND_NOT_SAVED');row=await bindRecordedReceptionCallStart(rpc,saved,bounded);
    return xml(receptionConsentTwiml(row.id,nonce));
   }catch{if(row){await transition(row,'setup_unknown').catch(()=>null);await endRecordedReception(rpc,provider,row,'setup_failed');}return hangup();}
  },
  async consent(request:Request){
   let row:RecordedReceptionRow|null=null;
   try{
    const auth=await signed(request,'consent',true);if(!auth)return hangup();row=auth.row;
    const call=await provider.getCall(row.call_sid);if(!incomingCallIdentityMatches(row,call))return hangup();
    if(!incomingCallMatches(row,call,now(),true)){await endRecordedReception(rpc,provider,row,'call_clock_or_status_conflict');return hangup();}
    if(row.state!=='consent_pending'||row.consent_at){await endRecordedReception(rpc,provider,row,'replayed_consent');return hangup();}
    row=await bindRecordedReceptionCallStart(rpc,row,call);
    const optOut=recordingGateOptOut(auth.f);
    if(optOut){const stopped=await transition(row,'contact_opt_out',{nonceHash:row.nonce_hash,utterance:optOut});if(stopped)row=stopped;await endRecordedReception(rpc,provider,row,'contact_opt_out');return xml(endTwiml);}
    const c=await currentConfig(row.to_phone),age=now()-Date.parse(row.call_started_at??'');
    if(!c||c.id!==row.config_id||!Number.isFinite(age)||age<0||age>45000||Date.parse(row.consent_deadline_at)<=now()||!await checkAgent(c)){await transition(row,'decline',{reason:'timeout'});await endRecordedReception(rpc,provider,row,'consent_unavailable');return hangup();}
    const yes=affirmativeSpeech(auth.f);
    if(!yes){await transition(row,'decline',{reason:auth.f.has('SpeechResult')?'ambiguous':'timeout'});await endRecordedReception(rpc,provider,row,'consent_declined');return xml(endTwiml);}
    let next=await transition(row,'consent',{nonceHash:row.nonce_hash,source:'twilio_gather_speech',...yes,disclosureVersion:'required-audio-30d-speech-2026-10-03'});if(!next)throw Error('CONSENT_NOT_SAVED');row=next;
    next=await transition(row,'claim_start');if(!next)throw Error('START_ALREADY_CLAIMED');row=next;
    const recording=await provider.start(row.call_sid,recordedReceptionUrl+'/status?id='+row.id);
    if(!receptionRecordingMatches(row,recording)||recording.status!=='in-progress'||!Number.isFinite(Date.parse(String(recording.start_time))))throw Error('START_UNCONFIRMED');
    next=await transition(row,'started',{recordingSid:recording.sid,providerStartedAt:new Date(String(recording.start_time)).toISOString()});
    if(next)row=next;else{const fresh=await getRecordedReception(rpc,row.id,row.account_id);if(!fresh||fresh.recording_sid!==recording.sid||fresh.state!=='recording'||fresh.end_requested_at||Date.parse(fresh.provider_started_at??'')!==Date.parse(String(recording.start_time)))throw Error('RECORDING_NOT_SAVED');row=fresh;}
    let context:unknown=null;
    if(propertyReceptionEnabled(c))try{context=await rpc('icash_recorded_reception_property_context',{p_id:row.id,p_nonce_hash:row.nonce_hash});}catch{/* Only ask caller for address; never infer tenant. */}
    next=await transition(row,'claim_register');if(!next)throw Error('REGISTER_ALREADY_CLAIMED');row=next;
    const remaining=Math.floor((Date.parse(row.call_deadline_at)-now())/1000);if(remaining<1||remaining>row.max_total_seconds)throw Error('CALL_CAP_EXHAUSTED');
    return xml(await provider.register(row,remaining,context));
   }catch{if(row){await transition(row,row.register_claimed_at?'register_unknown':'start_unknown').catch(()=>null);await endRecordedReception(rpc,provider,row,'recording_failed');}return hangup();}
  },
  async status(request:Request){
   try{
    const auth=await signed(request,'status');if(!auth)return new Response(null,{status:401,headers:privateHeaders});let row=auth.row;
    if(!sid(auth.f.get('RecordingSid'),'RE')||row.recording_sid&&row.recording_sid!==auth.f.get('RecordingSid'))return new Response(null,{status:401,headers:privateHeaders});
    const p=await provider.getRecording(auth.f.get('RecordingSid')!);if(!receptionRecordingMatches(row,p)||!row.consent_at||!row.start_claimed_at)return new Response(null,{status:409,headers:privateHeaders});
    if(!row.recording_sid){const next=await transition(row,'started',{recordingSid:p.sid,providerStartedAt:new Date(String(p.start_time)).toISOString()});if(!next)return new Response(null,{status:409,headers:privateHeaders});row=next;}
    if(['completed','absent'].includes(String(p.status))&&!['deleted','deletion_pending','expired'].includes(row.state)){
     const ended=await endRecordedReception(rpc,provider,row,'audio_terminal');row=ended.row;
     const saved=p.status==='absent'?await transition(row,'absent'):await transition(row,'available',finalRecordingPayload(p));
     if(!saved)return new Response(null,{status:503,headers:privateHeaders});
     if(!ended.ended)return new Response(null,{status:503,headers:privateHeaders});
    }
    return new Response(null,{status:204,headers:privateHeaders});
   }catch{return new Response(null,{status:503,headers:privateHeaders});}
  },
  async terminal(request:Request){
   try{
    const auth=await signed(request,'terminal');if(!auth)return new Response(null,{status:401,headers:privateHeaders});let row=auth.row;
    const call=await provider.getCall(row.call_sid);if(!incomingCallIdentityMatches(row,call)||!terminalStatuses.has(String(call.status)))return new Response(null,{status:409,headers:privateHeaders});
    row=await bindRecordedReceptionCallStart(rpc,row,call).catch(()=>row);
    if(!row.end_requested_at){const next=await transition(row,'request_end',{reason:'carrier_terminal'});if(next)row=next;}
    const next=await transition(row,'call_ended',boundEndReceipt(row,call));if(!next)return new Response(null,{status:409,headers:privateHeaders});
    return new Response(null,{status:204,headers:privateHeaders});
   }catch{return new Response(null,{status:503,headers:privateHeaders});}
  },
  async stop(request:Request){
   try{
    const u=new URL(request.url);if(request.method!=='POST'||u.pathname!=='/api/reception/recorded/stop'||u.search)return Response.json({stopped:false},{status:400,headers:privateHeaders});
    const token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!token||!/^[a-f0-9]{64}$/.test(token))return Response.json({stopped:false},{status:401,headers:privateHeaders});
    const b=object(JSON.parse((await boundedBytes(request,2048)).toString('utf8')));if(Object.keys(b).length!==1||!uuid(b.recordingId))return Response.json({stopped:false},{status:400,headers:privateHeaders});
    let row=await getRecordedReception(rpc,b.recordingId);if(!row||row.stop_token_hash!==sha(token)||!row.consent_at||!row.start_claimed_at||now()-Date.parse(row.created_at)>20*60000)return Response.json({stopped:false},{status:401,headers:privateHeaders});
    const next=await transition(row,'stop',{stopTokenHash:sha(token)});if(next)row=next;
    const ended=await endRecordedReception(rpc,provider,row,'permission_withdrawn');row=ended.row;let stopped=ended.ended;
    if(!ended.ended&&row.recording_sid)try{const p=await provider.stop(row.call_sid,row.recording_sid);stopped=receptionRecordingMatches(row,p)&&['stopped','completed','processing'].includes(String(p.status));}catch{/* Durable termination remains due. */}
    return Response.json({stopped,callEnded:ended.ended,instruction:'End this call now. Recording permission was withdrawn; do not continue talking.'},{status:ended.ended?200:503,headers:privateHeaders});
   }catch{return Response.json({stopped:false,callEnded:false,instruction:'End this call now. Stop is not confirmed.'},{status:503,headers:privateHeaders});}
  },
  async audio(account:string,id:string,range:string|null){
   if(!uuid(account)||!uuid(id))return new Response(null,{status:404,headers:privateHeaders});const row=await getRecordedReception(rpc,id,account);
   if(!row||row.account_id!==account||!receptionAudioAvailable(row,now()))return new Response(null,{status:404,headers:privateHeaders});
   if(range&&!/^bytes=\d+-\d*$/.test(range))return new Response(null,{status:416,headers:privateHeaders});const bytes=await provider.media(row.recording_sid!);
   if(!receptionAudioAvailable(row,now()))return new Response(null,{status:404,headers:privateHeaders});
   const headers={...privateHeaders,'Content-Type':'audio/mpeg','Accept-Ranges':'bytes'};if(!range)return new Response(bytes,{headers:{...headers,'Content-Length':String(bytes.length)}});
   const [a,b]=range.slice(6).split('-'),start=Number(a),end=b?Number(b):bytes.length-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length||end>=bytes.length)return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+bytes.length}});
   return new Response(bytes.subarray(start,end+1),{status:206,headers:{...headers,'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});
  },
 };
}
