import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {recordingGateOptOut,consentTwiml,recordingDisclosure,recordingBaseUrl,verifiedTwilioForm,object,sha,uuid,sid,privateHeaders} from './required-call-recording.ts';
import {boundedBytes,RecordingProviderError,type RecordingEnv} from './required-call-recording-provider.ts';
import {usdMicros} from './voice-usage-service.ts';
import type {RecordingDb} from './required-call-recording-service.ts';
import {ownerRecordingBase,ownerRecordingReview,ownerProviderRow,asProviderReview,type OwnerRecordingConfig,type OwnerRecordingRun} from './owner-recording-test.ts';
import type {OwnerRecordingProviders} from './owner-recording-test-provider.ts';
import {ownerConsentDiagnostic,ownerRecoveryDiagnostic,ownerCarrierDiagnostic} from './owner-recording-diagnostics.ts';
import {ownerAffirmativeSpeech} from './owner-recording-consent.ts';
const terminal=(s:unknown)=>['completed','busy','failed','no-answer','canceled'].includes(String(s));
const xml=(s='<Response><Hangup/></Response>')=>new Response(s,{headers:{...privateHeaders,'Content-Type':'text/xml'}});
const tokenFor=(id:string,env:RecordingEnv)=>createHmac('sha256',env.TWILIO_AUTH_TOKEN!).update('icash-owner-recording-v1:'+id).digest('hex');
export function ownerRecordingService(env:RecordingEnv,{db,provider,now=Date.now}:{db:RecordingDb;provider:OwnerRecordingProviders;now?:()=>number}){
 const get=async(id:string,account?:string,user?:string)=>{if(!uuid(id))return null;const rows=await db<OwnerRecordingRun[]>(`icash_owner_recording_test_runs?id=eq.${id}${account?'&account_id=eq.'+account:''}${user?'&owner_user_id=eq.'+user:''}&select=*`);return rows.length===1?rows[0]:null;};
 const trans=async(r:OwnerRecordingRun,action:string,payload:Record<string,unknown>={})=>db<OwnerRecordingRun|null>('rpc/icash_transition_owner_recording_test','POST',{p_id:r.id,p_version:r.row_version,p_action:action,p_payload:payload});
 async function update(r:OwnerRecordingRun,action:string,payload:Record<string,unknown>={}){const n=await trans(r,action,payload);if(!n)throw Error('OWNER_RECORDING_STATE_CHANGED');Object.assign(r,n);return r;}
 const callMatches=(r:OwnerRecordingRun,c:Record<string,unknown>)=>sid(c.sid,'CA')&&(r.call_sid===null||r.call_sid===c.sid)&&c.account_sid===r.configuration.review.providerAccountSid&&c.from===r.configuration.from_phone&&c.to===r.configuration.phone&&c.direction==='outbound-api';
 const recordingMatches=(r:OwnerRecordingRun,p:Record<string,unknown>)=>sid(p.sid,'RE')&&p.call_sid===r.call_sid&&p.account_sid===r.configuration.review.providerAccountSid&&(!r.recording_sid||r.recording_sid===p.sid);
 async function preflight(c:OwnerRecordingConfig){const r=c.review;if(!/^agent_[A-Za-z0-9]+$/.test(String(r.agentId))||!/^agtbrch_[A-Za-z0-9]+$/.test(String(r.branchId))||!/^phnum_[A-Za-z0-9]+$/.test(c.phone_number_id)||r.stopToolId!=null&&!/^tool_[A-Za-z0-9]+$/.test(String(r.stopToolId)))throw Error('OWNER_FIXED_TARGET_REQUIRED');const [agent,branch,phone,tool,pricing,caller]=await Promise.all([provider.agent(asProviderReview(c)),provider.branch(String(r.agentId),String(r.branchId)),provider.phone(c.phone_number_id),/^tool_[A-Za-z0-9]+$/.test(String(r.stopToolId))?provider.tool(String(r.stopToolId)):Promise.resolve({}),provider.voicePrice(c.phone,c.from_phone),provider.callerId(c.from_phone)]);const review=ownerRecordingReview(c,agent,branch,phone,tool,env.CONTIGUITY_FROM,env.TWILIO_ACCOUNT_SID,now());const prices=pricing.outbound_call_prices;const priceIdentity=pricing.destination_number===c.phone&&pricing.origination_number===c.from_phone&&pricing.price_unit==='USD'&&pricing.iso_country==='US'&&Array.isArray(prices)&&prices.length>0&&prices.every(x=>{try{usdMicros(object(x).current_price);return true;}catch{return false;}});const currentRate=priceIdentity?Math.max(...(prices as unknown[]).map(x=>usdMicros(object(x).current_price))):null;const priceGood=currentRate!==null&&currentRate<=Number(c.quote.voiceMaxMicrosPerMinute);return {ready:review.ready&&priceGood&&caller.usable,checks:{...review.checks,currentCarrierPrice:priceGood,directTwilioCallerUsable:caller.usable},observed:{...review.observed,currentCarrierRateMicros:currentRate}};}
 async function end(r:OwnerRecordingRun){
  if(r.call_ended_at)return true;if(!r.call_sid)return false;
  try{if(!r.end_requested_at){const requested=await trans(r,'end_request');if(requested)Object.assign(r,requested);else{const fresh=await get(r.id);if(fresh)Object.assign(r,fresh);if(!r.end_requested_at)await update(r,'end_request');}}
   const c=await provider.end(r.call_sid);if(c.sid!==r.call_sid||c.account_sid!==r.configuration.review.providerAccountSid||!terminal(c.status))return false;
   if(!r.call_ended_at)await update(r,'ended',{callSid:r.call_sid,accountSid:c.account_sid,status:c.status});return true;
  }catch{return false;}
 }
 async function signed(request:Request,kind:'consent'|'status'|'terminal'){
  const u=new URL(request.url),id=u.searchParams.get('id'),nonce=u.searchParams.get('nonce');if(request.method!=='POST'||u.pathname!==new URL(ownerRecordingBase+'/'+kind).pathname||!uuid(id)||u.searchParams.size!==(kind==='consent'?2:1)||kind==='consent'&&(!nonce||!/^[a-f0-9]{64}$/.test(nonce)))return null;
  const canonical=ownerRecordingBase+'/'+kind+'?id='+id+(kind==='consent'?'&nonce='+nonce:'');
  const f=verifiedTwilioForm((await boundedBytes(request,16384)).toString(),request.headers.get('x-twilio-signature'),env.TWILIO_AUTH_TOKEN??'',canonical);if(!f)return null;
  const r=await get(id);if(!r||f.get('AccountSid')!==r.configuration.review.providerAccountSid||!sid(f.get('CallSid'),'CA')||r.call_sid&&r.call_sid!==f.get('CallSid')||kind==='consent'&&sha(nonce!)!==r.nonce_hash)return null;
  const c=await provider.getCall(f.get('CallSid')!);if(!callMatches(r,c))return null;
  if(!r.call_sid){const created=Date.parse(String(c.date_created));if(!Number.isFinite(created)||Math.abs(created-Date.parse(r.created_at))>120000)return null;await update(r,'bind_call',{callSid:c.sid,accountSid:c.account_sid,from:c.from,to:c.to,startedAt:c.start_time??null});}
  if(!r.call_started_at&&typeof c.start_time==='string')await update(r,'answered',{startedAt:c.start_time});
  return {r,c,f};
 }
 async function bindConversation(r:OwnerRecordingRun){
  if(!r.registration_claimed_at)return null;
  let id=r.conversation_id;
  if(!id){const list=await provider.conversations(ownerProviderRow(r));if(list.has_more!==false||!Array.isArray(list.conversations)||list.conversations.length!==1)throw Error('OWNER_CONVERSATION_ID_PENDING');id=String(object(list.conversations[0]).conversation_id);}
  const c=await provider.conversation(id),p=object(object(c.metadata).phone_call),init=object(c.conversation_initiation_client_data),review=r.configuration.review;
  if(c.conversation_id!==id||c.agent_id!==review.agentId||c.branch_id!==review.branchId||c.version_id!==review.versionId||c.user_id!=='icash-recorded:'+r.id||init.user_id!==c.user_id||p.call_sid!==r.call_sid||p.direction!=='outbound'||p.external_number!==r.configuration.phone||p.agent_number!==r.configuration.from_phone)throw Error('OWNER_CONVERSATION_BINDING_REQUIRED');
  if(!r.conversation_id)await update(r,'conversation',{conversationId:id});return c;
 }
 async function settle(r:OwnerRecordingRun,c:Record<string,unknown>){
  if(r.settlement)return;
  if(!callMatches(r,c)||!terminal(c.status)||!r.call_ended_at||typeof c.price!=='string'||!/^-(?:\d+)(?:\.\d{1,6})?$|^0(?:\.0+)?$/.test(c.price)||c.price_unit!=='USD'||typeof c.duration!=='string'||!/^\d+$/.test(c.duration)||Number(c.duration)>60){console.warn('owner_recording_diagnostic',{stage:'carrier_receipt',runId:r.id,...ownerCarrierDiagnostic(c,callMatches(r,c),terminal(c.status))});throw Error('OWNER_CARRIER_PRICE_PENDING');}
  const items:{provider:string;label:string;micros:number;basis:string;receipt:string}[]=[];
  const seconds=Number(c.duration),q=r.configuration.quote;
  items.push({provider:'twilio',label:'Call',micros:usdMicros(c.price.replace('-','')),basis:'observed',receipt:String(c.sid)});
  if(r.registration_claimed_at){const convo=await bindConversation(r),m=object(convo?.metadata);if(convo?.status!=='done'&&convo?.status!=='failed')throw Error('OWNER_AI_USAGE_PENDING');items.push({provider:'elevenlabs',label:'Inclusive AI USD',micros:usdMicros(m.cost_fiat),basis:'observed',receipt:r.conversation_id!});items.push({provider:'twilio',label:'Media stream allowance',micros:Math.ceil(seconds*Number(q.streamMicrosPerMinute)/60),basis:'estimated',receipt:'Reviewed carrier-duration proxy'});}
  else items.push({provider:'elevenlabs',label:'No registration attempted',micros:0,basis:'not_applicable',receipt:r.id});
  items.push({provider:'twilio',label:'One speech Gather',micros:c.status==='completed'?20000:0,basis:'estimated',receipt:'One-use ASR allowance; no reprompt'});
  if(r.start_claimed_at){if(!r.recording_sid||r.duration_seconds===null)throw Error('OWNER_RECORDING_PRICE_PENDING');const min=Math.ceil(r.duration_seconds/60);items.push({provider:'twilio',label:'Audio recording',micros:r.recording_price_micros??min*2500,basis:r.recording_price_micros===null?'estimated':'observed',receipt:r.recording_sid});items.push({provider:'twilio',label:'30-day audio storage',micros:Math.ceil(min*500*30/28),basis:'estimated',receipt:'Conservative30/28 allocation'});}
  const totalMicros=items.reduce((n,x)=>n+x.micros,0);await update(r,'settle',{totalMicros,items,carrier:{callSid:c.sid,accountSid:c.account_sid,from:c.from,to:c.to,status:c.status,durationSeconds:seconds,priceMicros:items[0].micros,currency:'USD'},budgetBasis:'Observed USD plus explicitly estimated Twilio add-ons; no customer wallet debit'});
 }
 const api={
  get,
  async status(owner:{accountId:string;userId:string}){const [c]=await db<OwnerRecordingConfig[]>(`icash_owner_recording_test_config?id=eq.1&account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&select=*`);if(!c)return {ready:false,reason:'owner_test_not_configured'};const runs=await db<OwnerRecordingRun[]>(`icash_owner_recording_test_runs?account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&select=*&order=attempt.asc`);const checks=await preflight(c).catch(()=>({ready:false,checks:{providerPreflight:false},observed:null}));const allowance=runs.length+c.prior_attempts<3&&runs.every(r=>r.call_ended_at&&r.settlement&&!r.contact_opted_out&&r.settled_micros!<=r.reserved_micros)&&runs.reduce((n,r)=>n+(r.settled_micros??r.reserved_micros),c.prior_spend_micros)+Number(c.quote.maxAttemptMicros)<=3000000;return {ready:env.ICASH_OWNER_RECORDING_TEST_READY==='true'&&checks.ready&&allowance,allowanceReady:allowance,checks:checks.checks,observed:checks.observed,phoneEnding:c.phone.slice(-4),maxSeconds:60,totalBudgetCents:300,priorAttempts:c.prior_attempts,priorSpendMicros:c.prior_spend_micros,remainingAttempts:Math.max(0,3-c.prior_attempts-runs.length),remainingBudgetMicros:Math.max(0,3000000-runs.reduce((n,r)=>n+(r.settled_micros??r.reserved_micros),c.prior_spend_micros)),runs:runs.map(r=>({id:r.id,attempt:r.attempt,state:r.state,callSid:r.call_sid,recordingSid:r.recording_sid,conversationId:r.conversation_id,durationSeconds:r.duration_seconds,audioExpiresAt:r.audio_expires_at,deletedAt:r.deleted_at,settlement:r.settlement,callEnded:!!r.call_ended_at,error:r.last_error}))};},
  async start(owner:{accountId:string;userId:string}){
   if(env.ICASH_OWNER_RECORDING_TEST_READY!=='true')return {status:'disabled'};
   const [c]=await db<OwnerRecordingConfig[]>(`icash_owner_recording_test_config?id=eq.1&account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&select=*`);if(!c||!(await preflight(c)).ready)return {status:'owner_preflight_held'};
   const nonce=randomBytes(32).toString('hex'),runId=randomUUID(),stop=tokenFor(runId,env);
   const r=await db<OwnerRecordingRun|null>('rpc/icash_claim_owner_recording_test','POST',{p_account:owner.accountId,p_user:owner.userId,p_expected:c,p_run:runId,p_nonce_hash:sha(nonce),p_stop_hash:sha(stop)});if(!r)return {status:'owner_allowance_held'};
   // Derive a stable secret from the random nonce-bound run, not owner-supplied call data.
   // Store only its hash; stop secret is assigned through the claim capability below.
   try{const twiml=consentTwiml(r.id,nonce,recordingDisclosure(String(c.review.principal),String(c.review.assistantName))).replaceAll(recordingBaseUrl,ownerRecordingBase);const result=await provider.dial60(c.from_phone,c.phone,twiml,ownerRecordingBase+'/terminal?id='+r.id);if(!callMatches(r,result))throw Error('OWNER_DIAL_BINDING_UNKNOWN');await update(r,'bind_call',{callSid:result.sid,accountSid:result.account_sid,from:result.from,to:result.to,startedAt:result.start_time??null});return {status:'consent_pending',id:r.id};}
   catch{await trans(r,'retry',{reason:'dial_outcome_unknown_no_retry'}).catch(()=>null);return {status:'dial_outcome_unknown_no_retry',id:r.id};}
  },
  async consent(request:Request){let r:OwnerRecordingRun|null=null;
   try{const checked=await signed(request,'consent');if(!checked)return xml();r=checked.r;const {c,f}=checked;if(r.state!=='consent_pending'||r.consent_at){await end(r);return xml();}
    if(env.ICASH_OWNER_RECORDING_TEST_READY!=='true'||c.status!=='in-progress'||!(await preflight(r.configuration)).ready){await update(r,'fail',{reason:'current_owner_review_required'});await end(r);return xml();}
    if(recordingGateOptOut(f)){await update(r,'contact_opt_out');await end(r);return xml();}
    const yes=ownerAffirmativeSpeech(f);if(!yes){const diagnostic=ownerConsentDiagnostic(f);const invalid=diagnostic.unstable||diagnostic.confidenceStatus==='low'||diagnostic.confidenceStatus==='malformed';console.warn('owner_recording_diagnostic',{stage:'consent_rejected',runId:r.id,...diagnostic});await update(r,invalid?'fail':'decline',{reason:invalid?diagnostic.reason:'consent_not_verified'});await end(r);return xml();}
    await update(r,'consent',{nonceHash:r.nonce_hash,source:'twilio_gather_speech',...yes});await update(r,'claim_start');
    const rec=await provider.start(r.call_sid!,ownerRecordingBase+'/status?id='+r.id);if(!recordingMatches(r,rec)||rec.status!=='in-progress')throw Error('OWNER_RECORDING_START_UNKNOWN');
    const started=await trans(r,'started',{recordingSid:rec.sid,startedAt:new Date(String(rec.start_time)).toISOString()});if(started)Object.assign(r,started);else{const fresh=await get(r.id);if(!fresh||fresh.recording_sid!==rec.sid||fresh.end_requested_at||fresh.state!=='recording')throw Error('OWNER_START_SAVE_REQUIRED');r=fresh;}
    const remaining=60-Math.ceil((now()-Date.parse(String(c.start_time)))/1000);if(remaining<1||remaining>60)throw Error('OWNER_CALL_TIME_EXHAUSTED');
    await update(r,'claim_register');return xml(await provider.register(ownerProviderRow(r),remaining,tokenFor(r.id,env)));
   }catch(error){console.warn('owner_recording_diagnostic',{stage:'consent_error',runId:r?.id??null,reason:ownerRecoveryDiagnostic(error)});if(r)await end(r);return xml();}
  },
  async callback(request:Request,kind:'status'|'terminal'){
   try{const checked=await signed(request,kind);if(!checked)return new Response(null,{status:401});const {r,c,f}=checked;
    if(kind==='status'){const rs=f.get('RecordingSid');if(!sid(rs,'RE'))return new Response(null,{status:400});const rec=await provider.getRecording(rs);if(!recordingMatches(r,rec)||!r.start_claimed_at)return new Response(null,{status:409});if(!r.recording_sid)await update(r,'started',{recordingSid:rec.sid,startedAt:new Date(String(rec.start_time)).toISOString()});
     if(rec.status==='completed'){if(!await end(r))return new Response(null,{status:503});await update(r,'completed_audio',{recordingSid:rs,durationSeconds:Number(rec.duration),priceMicros:typeof rec.price==='string'&&rec.price_unit==='USD'?usdMicros(rec.price.replace('-','')):null});}
     else if(rec.status==='absent'){const ended=await end(r);await update(r,'absent_audio',{recordingSid:rec.sid});return new Response(null,{status:ended?204:503});}
    }else if(terminal(c.status)){if(!r.end_requested_at)await update(r,'end_request');if(!r.call_ended_at)await update(r,'ended',{callSid:c.sid,accountSid:c.account_sid,status:c.status});await settle(r,c);}
    return new Response(null,{status:204,headers:privateHeaders});
   }catch(error){console.warn('owner_recording_diagnostic',{stage:kind,reason:ownerRecoveryDiagnostic(error)});return new Response(null,{status:503,headers:privateHeaders});}
  },
  async stop(request:Request){const b=object(JSON.parse((await boundedBytes(request,2048)).toString())),token=request.headers.get('authorization')?.replace(/^Bearer /,'');if(Object.keys(b).length!==1||!uuid(b.recordingId))return null;const r=await get(b.recordingId);if(!r)return null;if(!token||!/^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(Buffer.from(token),Buffer.from(tokenFor(r.id,env)))||sha(token)!==r.stop_token_hash)return Response.json({callEnded:false},{status:401,headers:privateHeaders});const ended=await end(r);if(!ended&&r.recording_sid)await provider.stop(r.call_sid!,r.recording_sid).catch(()=>null);return Response.json({callEnded:ended,instruction:'Stop talking and end this call.'},{status:ended?200:503,headers:privateHeaders});},
  async maintain(){const summary={processed:0,held:0};for(const r of await db<OwnerRecordingRun[]>('rpc/icash_claim_owner_recording_work','POST',{})){try{
    if(r.configuration.review.providerAccountSid!==env.TWILIO_ACCOUNT_SID)throw Error('OWNER_ACCOUNT_REVIEW_REQUIRED');
    // Audio deletion is independent of call/AI price availability, feature flag and test allowance.
    if(r.recording_sid&&!r.deleted_at&&r.audio_expires_at&&Date.parse(r.audio_expires_at)<=now()){
     let before:Record<string,unknown>|null=null;try{before=await provider.getRecording(r.recording_sid,true);}catch(e){if(!(e instanceof RecordingProviderError)||e.status!==404)throw e;}
     if(before&&!recordingMatches(r,before))throw Error('OWNER_DELETE_BINDING_REQUIRED');if(before&&before.status!=='deleted')await provider.deleteRecording(r.recording_sid);
     let gone=before===null;try{const after=await provider.getRecording(r.recording_sid,true);gone=recordingMatches(r,after)&&after.status==='deleted';}catch(e){if(e instanceof RecordingProviderError&&e.status===404)gone=true;else throw e;}
     if(!gone)throw Error('OWNER_AUDIO_DELETE_PENDING');await update(r,'deleted');
    }
    if(!r.call_sid)throw Error('OWNER_CALL_REVIEW_REQUIRED');let c=await provider.getCall(r.call_sid);if(!callMatches(r,c))throw Error('OWNER_CALL_BINDING_REQUIRED');
    if(r.end_requested_at&&!r.call_ended_at||!terminal(c.status)&&now()-Date.parse(r.call_started_at??r.created_at)>=60000){if(!await end(r))throw Error('OWNER_END_UNCONFIRMED');c=await provider.getCall(r.call_sid);}
    if(terminal(c.status)&&!r.call_ended_at){if(!r.end_requested_at)await update(r,'end_request');await update(r,'ended',{callSid:c.sid,accountSid:c.account_sid,status:c.status});}
    if(r.start_claimed_at&&!r.recording_sid){const list=await provider.listRecordings(r.call_sid);if(list.next_page_uri||!Array.isArray(list.recordings)||list.recordings.length!==1)throw Error('OWNER_RECORDING_OUTCOME_REVIEW');const rec=object(list.recordings[0]);if(!recordingMatches(r,rec))throw Error('OWNER_RECORDING_BINDING_REQUIRED');await update(r,'started',{recordingSid:rec.sid,startedAt:new Date(String(rec.start_time)).toISOString()});}
    if(r.recording_sid&&!r.deleted_at){const rec=await provider.getRecording(r.recording_sid);if(!recordingMatches(r,rec))throw Error('OWNER_RECORDING_BINDING_REQUIRED');if(rec.status==='absent'){await end(r);await update(r,'absent_audio',{recordingSid:rec.sid});throw Error('OWNER_REQUIRED_AUDIO_ABSENT');}if(rec.status==='completed'&&r.duration_seconds===null){if(!await end(r))throw Error('OWNER_END_UNCONFIRMED');await update(r,'completed_audio',{recordingSid:rec.sid,durationSeconds:Number(rec.duration),priceMicros:typeof rec.price==='string'&&rec.price_unit==='USD'?usdMicros(rec.price.replace('-','')):null});}}
    await settle(r,c);summary.processed++;
   }catch(error){const reason=ownerRecoveryDiagnostic(error);console.warn('owner_recording_diagnostic',{stage:'maintenance',runId:r.id,reason});await trans(r,'retry',{reason:reason.toLowerCase()}).catch(()=>null);summary.held++;}}return summary;},
  async audio(owner:{accountId:string;userId:string},id:string){const r=await get(id,owner.accountId,owner.userId);if(!r||r.state!=='available'||r.deleted_at||!r.recording_sid||!r.audio_expires_at||Date.parse(r.audio_expires_at)<=now())return new Response(null,{status:404,headers:privateHeaders});const data=await provider.media(r.recording_sid);if(Date.parse(r.audio_expires_at)<=now())return new Response(null,{status:404,headers:privateHeaders});return new Response(data,{headers:{...privateHeaders,'Content-Type':'audio/mpeg'}});}
 };return api;
}
