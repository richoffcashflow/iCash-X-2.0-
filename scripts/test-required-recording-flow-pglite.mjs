import {sellerContinuedSpeech} from '../lib/seller-call-notice.ts';
// FULL LOCAL SIMULATION: real contact admission/claim/recording/ledger SQL; synthetic providers only.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {createOperationalContactFixture} from '../tests/helpers/operational-contact-fixture.mjs';
import {databaseAdapter,loadService} from '../tests/helpers/simulated-journey-services.mjs';
import {sameBusinessNumber,consistentTextSenders} from '../lib/number-continuity.ts';
import {boundedVoiceSmsContext} from '../lib/voice-sms-context.ts';
import {buyerCallInstructions} from '../lib/buyer-call-policy.ts';
import {contactEligibility,callEligibility,verifiedOfferCeiling} from '../lib/live-dispatch-policy.ts';
import {sellerFirstMessage,sellerCallPrompt} from '../lib/seller-call-context.ts';
import {recordingPolicy,canonical,sha,readRecordingReview,recordingAgentMatches,object,recordingBaseUrl} from '../lib/required-call-recording.ts';
import {recordingService,recordingStopToken} from '../lib/required-call-recording-service.ts';
import {ensureRecordedConversationBinding} from '../lib/required-call-recording-binding.ts';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
import {recordingPresentation} from '../lib/required-call-recording-receipt.ts';
import {settleBoundVoiceUsage} from '../lib/voice-usage-service.ts';
import {settleRecordingGateOnly} from '../lib/required-call-recording-billing.ts';
import {runOutboundBilling} from '../lib/outbound-billing-service.ts';
import {costCategories} from '../lib/cost-guard.ts';
const realDateNow=Date.now;
const f=await createOperationalContactFixture(process.argv[2]),{pg,q,rpc,one,account,phone,screening,other,prepare}=f;
const ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),re='RE'+'c'.repeat(32),conv='conv_recordingfixture',now=Date.now(),when=new Date(now).toISOString(),future=new Date(now+86400000).toISOString(),past=new Date(now-60000).toISOString();
try{
 await pg.exec(readFileSync(new URL('../config/outbound-billing-queue.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../config/dealmachine-dnc-observations.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync(new URL('../config/required-call-recording.sql',import.meta.url),'utf8'));await pg.exec(readFileSync(new URL('../config/recording-consent-evidence-v4.sql',import.meta.url),'utf8'));await pg.exec(readFileSync(new URL('../config/required-call-recording-consent-v4.sql',import.meta.url),'utf8'));
 await pg.exec("create or replace function public.icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select false$$");
 await pg.exec(readFileSync(new URL('../config/seller-call-brief-notice.sql',import.meta.url),'utf8'));
 await pg.exec(readFileSync('supabase/migrations/20261007020025_terminal_call_status_and_credit_readiness.sql','utf8').split('-- Match the actual')[0]+'commit;');await pg.exec(readFileSync('supabase/migrations/20261007020639_terminal_receipt_read_only_recording_access.sql','utf8'));
 for(const [utterance,allowed] of [['Yes, I wanted a cash offer',true],['Who is this?',true],['No, thanks.',false],['Stop recording',false],['I do not consent',false],['Call later',false],['',false],['Don’t ever call me again',false]]){
  assert.equal(!!sellerContinuedSpeech(new URLSearchParams({SpeechResult:utterance})),allowed);
  assert.equal((await one('select icash_recording_private.valid_seller_notice_continuation($1) ok',[utterance])).ok,allowed);
 }
 for(const form of [new URLSearchParams({SpeechResult:'Yes',UnstableSpeechResult:'Yes'}),new URLSearchParams('SpeechResult=Yes&SpeechResult=No'),new URLSearchParams({SpeechResult:'Yes',Confidence:'NaN'})])assert.equal(sellerContinuedSpeech(form),null);
 await q('delete from icash_outreach_campaigns where account_id=$1',[account]);
 const snapshot={propertyId:'prop_1001',propertyType:'house',fetchedAt:when,sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_1001',full_address:'Synthetic property only',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
 await q('update icash_screening_jobs set snapshot=$2 where id=$1',[screening,snapshot]);
 const rateCosts=JSON.parse(readFileSync(new URL('../config/required-recording-rate-candidate.json',import.meta.url),'utf8')).costsMicros;
 const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values('seller_call','required-audio-30d-speech-v1:fixture',977,$1,2000,'SIMULATION recorded quote',now()-interval '1 minute',now()+interval '1 day',true,600) returning id",[rateCosts])).id;
 const main={asr:{user_input_audio_format:'ulaw_8000'},tts:{voice_id:'fixture_voice',agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_callback','tool_handoff']}}};
 const branch={agent_id:'agent_fixture',branch_id:'agtbrch_fixture',version_id:'agtvrsn_fixture',main_branch_id:'agtbrch_main',conversation_config:{...main,agent:{prompt:{tool_ids:['tool_callback','tool_handoff','tool_stop']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
 await q("insert into icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,max_duration_seconds,required_tool_ids) values($1,true,'agent_fixture','phnum_fixture',$2,now()+interval '1 day',$3,600,array['tool_callback','tool_handoff'])",[account,sha(JSON.stringify(main)),rate]);
 const review={enabled:true,reviewedAt:past,reviewedUntil:future,agentId:branch.agent_id,branchId:branch.branch_id,versionId:branch.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:branch.conversation_config,platform_settings:branch.platform_settings,workflow:null,procedures:null}))),fromPhone:f.sender,providerAccountSid:ac,stopToolId:'tool_stop',toolIds:['tool_callback','tool_handoff','tool_stop'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
 Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',ICASH_RECORDED_OUTBOUND_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),ELEVENLABS_API_KEY:'synthetic-only',TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-twilio-secret-only',CONTIGUITY_FROM:f.sender});
 await q('begin');const transactionTime=Math.floor(Number((await one('select extract(epoch from now())*1000 as ms')).ms));Date.now=()=>transactionTime;await prepare();await rpc('icash_queue_voice_jobs',{});let job=await one('select * from icash_voice_jobs where account_id=$1',[account]);
 assert.equal(job.permission_id,null);assert(job.operational_contact_id);assert.equal((await one('select consent_verification from icash_operational_contacts where id=$1',[job.operational_contact_id])).consent_verification,'not_performed');
 await q("update icash_voice_jobs set state='issued' where id=$1",[job.id]);
 const {db}=databaseAdapter(pg);let loseDialResponse=true;let events=[],capturedTwiml,session,recordingStatus='in-progress',callStatus='in-progress';
 const call=()=>({sid:ca,account_sid:ac,from:f.sender,to:phone,direction:'outbound-api',date_created:when,start_time:when,status:callStatus,duration:'30',end_time:when,price:'-0.014000',price_unit:'USD'});
 const tool={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_recording',api_schema:{url:recordingBaseUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_recording_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_recording_id'}}}}}};
 const conversation=()=>({conversation_id:conv,agent_id:branch.agent_id,branch_id:branch.branch_id,version_id:branch.version_id,user_id:'icash-recorded:'+session.id,conversation_initiation_client_data:{user_id:'icash-recorded:'+session.id},metadata:{phone_call:{call_sid:ca,direction:'outbound',external_number:phone,agent_number:f.sender}}});
 let recordStart;
 const provider={agent:async()=>branch,tool:async()=>tool,dial:async(from,to,twiml)=>{events.push('dial');assert.equal(from,f.sender);assert.equal(to,phone);capturedTwiml=twiml;if(loseDialResponse)throw Error('SIMULATION accepted call with lost response');return call();},getCall:async()=>call(),start:async()=>{events.push('start');recordStart=new Date().toISOString();return {sid:re,account_sid:ac,call_sid:ca,status:'in-progress',start_time:recordStart};},register:async(row,remaining)=>{events.push('register');assert(row.consent_at&&row.recording_sid);assert(remaining<=600);assert(row.call_context.prompt.includes('PRIVATE SERVER NEGOTIATION AUTHORITY'));return '<Response><Connect><Stream url="wss://api.elevenlabs.io/fixture"/></Connect></Response>';},end:async()=>{events.push('end');callStatus='completed';return call();},getRecording:async()=>({sid:re,account_sid:ac,call_sid:ca,status:recordingStatus,start_time:recordStart,duration:'30',price:'-0.002500',price_unit:'USD'}),conversation:async()=>conversation(),deleteRecording:async()=>{events.push('delete');recordingStatus='deleted';},media:async()=>Buffer.from('SYNTHETIC AUDIO FIXTURE')};
 const service=recordingService(process.env,{db,provider});
 const elevenRequest=async(path,body)=>{assert.equal(body,undefined,'Legacy direct dial must never run for recorded lane');return path.includes('/phone-numbers/')?{phone_number:f.sender}:branch;};
 const dispatcher=await loadService('lib/live-dispatch-service.ts',{recordingServer:()=>service,readRecordingReview,recordingAgentMatches,object,recordingPolicy,createHash,randomBytes,sameBusinessNumber,consistentTextSenders,boundedVoiceSmsContext,db,elevenRequest,buyerCallInstructions,contactEligibility,callEligibility,verifiedOfferCeiling,sellerFirstMessage,sellerCallPrompt});
 // An enabled legacy rate/config with capture OFF must not reserve, claim, or dial.
 await q('savepoint legacy_recording_hold');
 const legacyRate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values('seller_call','staged-seller-20260930-us-600s-v1:synthetic',946,$1,2000,'SIMULATION legacy quote',now()-interval '1 minute',now()+interval '1 day',true,600) returning id",[{...rateCosts,elevenlabs:100000}])).id;
 await q('update icash_voice_configs set seller_rate_id=$2 where account_id=$1',[account,legacyRate]);
 process.env.ICASH_RECORDED_OUTBOUND_READY='false';
 assert.equal((await dispatcher.dispatchLiveVoice(account,job.id)).status,'recorded_call_release_required');assert.deepEqual(events,[]);
 assert.equal((await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents,0);
 assert.equal((await one('select count(*)::int n from icash_operation_spend where operation_key=$1',['voice:'+job.id])).n,0);
 assert.equal((await one('select state from icash_voice_jobs where id=$1',[job.id])).state,'held');
 process.env.ICASH_RECORDED_OUTBOUND_READY='true';await q('rollback to savepoint legacy_recording_hold');await q('release savepoint legacy_recording_hold');
 console.log('PASS REAL SQL legacy enabled946/config + capture OFF: job held, no spend row, reserve, claim, or provider mutation');
 await q('update icash_voice_configs set agent_config_hash=$2,required_tool_ids=array(select jsonb_array_elements_text($3::jsonb)) where account_id=$1',[account,review.configHash,review.toolIds]);
 for(const mismatch of [{agentId:'agent_other'},{fromPhone:'+12125550999'}]){await q('savepoint mismatched_review');process.env.RECORDED_OUTBOUND_REVIEW_JSON=JSON.stringify({...review,...mismatch});assert.equal((await dispatcher.dispatchLiveVoice(account,job.id)).status,'recorded_call_review_required');assert.deepEqual(events,[]);assert.equal((await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents,0);process.env.RECORDED_OUTBOUND_REVIEW_JSON=JSON.stringify(review);await q('rollback to savepoint mismatched_review');await q('release savepoint mismatched_review');}
 assert.equal((await dispatcher.dispatchLiveVoice(account,job.id)).status,'provider_outcome_unknown_no_retry');
 assert.equal((await one('select state from icash_voice_jobs where id=$1',[job.id])).state,'dispatching');
 assert.equal((await dispatcher.dispatchLiveVoice(account,job.id)).status,'held');assert.deepEqual(events,['dial']);
 session=await one('select * from icash_call_recordings where operation_key=$1',['voice:'+job.id]);assert.equal(session.permission_id,null);assert.equal(session.operational_contact_id,job.operational_contact_id);assert.equal(session.consent_at,null);assert.deepEqual(events,['dial']);
 assert.equal((await one('select state from icash_operation_spend where operation_key=$1',[session.operation_key])).state,'dispatched');assert.equal((await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents,977);
 const consentUrl=capturedTwiml.match(/action="([^"]+)"/)[1].replaceAll('&amp;','&');
 const signed=(url,entries)=>{const body=new URLSearchParams(entries),signature=createHmac('sha1',process.env.TWILIO_AUTH_TOKEN).update(url+[...body.keys()].sort().map(k=>k+body.get(k)).join('')).digest('base64');return new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature},body});};
 assert((await(await service.consent(signed(consentUrl,{AccountSid:ac,CallSid:ca,SpeechResult:"Yes, I wanted a cash offer"}),true)).text()).includes('<Connect>'));assert.deepEqual(events,['dial','start','register']);
 session=await one('select * from icash_call_recordings where id=$1',[session.id]);assert.equal(session.consent_evidence.method,'continued_speech_after_notice');assert.equal(session.consent_evidence.utterance,'Yes, I wanted a cash offer');assert.equal(session.consent_evidence.confidenceReported,null);const capability=recordingStopToken(session.operation_key,process.env);
 // Real SQL withdrawal: failed call-end is visible and remains recoverable with capture OFF.
 await q('savepoint withdrawal_case');const beforeWithdrawal=[...events],normalEnd=provider.end;
 provider.end=async()=>{events.push('end-failed');throw Error('SIMULATION termination outage');};
 provider.stop=async()=>{events.push('stop');return {sid:re,account_sid:ac,call_sid:ca,status:'stopped'};};
 const stopped=await service.stop(new Request(recordingBaseUrl+'/stop',{method:'POST',headers:{authorization:capability},body:JSON.stringify({recordingId:session.id})}));assert.equal(stopped.status,503);assert.equal((await stopped.json()).callEnded,false);
 const waiting=await one('select * from icash_call_recordings where id=$1',[session.id]);assert(waiting.end_requested_at&&!waiting.call_ended_at&&waiting.next_reconcile_at);
 provider.end=normalEnd;recordingStatus='completed';
 assert.equal((await maintainRecordings(db,provider,{...process.env,ICASH_RECORDED_OUTBOUND_READY:'false'})).reconciled,1);
 assert((await one('select call_ended_at from icash_call_recordings where id=$1',[session.id])).call_ended_at);
 assert.equal(events.filter(x=>x==='start').length,1);assert.equal(events.filter(x=>x==='register').length,1);
 await q('rollback to savepoint withdrawal_case');await q('release savepoint withdrawal_case');events=beforeWithdrawal;callStatus='in-progress';recordingStatus='in-progress';
 console.log('PASS FULL WITHDRAWAL RECOVERY: actual claimed/consented/recorded session → failed END plus stopped audio reports503 → durable SQL end request → independent off-flag worker confirms whole-call termination, no new registration.');
 const binding=(token,c,db,env)=>ensureRecordedConversationBinding(token,c,db,env,provider);

 const callback=await loadService('app/api/internal/voice/callback/route.ts',{ensureRecordedConversationBinding:binding,NextResponse:{json:Response.json},z,createHash,db});
 const response=await callback.POST(new Request('https://www.geticashx.com/api/internal/voice/callback',{method:'POST',headers:{authorization:capability},body:JSON.stringify({conversationId:conv,dueAt:new Date(now+86400000).toISOString(),timezone:'UTC',readback:'Tomorrow at the same time UTC',confirmation:'Yes, please call then'})}));assert.equal(response.status,200);
 const live=await one('select * from icash_live_conversations where operation_key=$1',[session.operation_key]);assert.equal(live.conversation_id,conv);assert.equal(live.account_id,account);
 const handoff=await loadService('app/api/internal/voice/handoff/route.ts',{ensureRecordedConversationBinding:binding,NextResponse:{json:Response.json},z,createHash,db});assert.equal((await handoff.POST(new Request('https://www.geticashx.com/api/internal/voice/handoff',{method:'POST',headers:{authorization:capability},body:JSON.stringify({conversationId:conv,reason:'Synthetic fixture requests a person'})}))).status,200);
 recordingStatus='completed';callStatus='completed';assert.equal((await service.status(signed(recordingBaseUrl+'/status?id='+session.id,{AccountSid:ac,CallSid:ca,RecordingSid:re,RecordingStatus:'completed'}))).status,204);
 await rpc('icash_record_cost_observation',{p_provider:'elevenlabs',p_event:conv,p_source:session.operation_key,p_amount:0.1,p_units:'USD'});
 await rpc('icash_save_live_result',{p_call:live.id,p_result:{party:'seller',transcript:[{role:'user',message:'Synthetic seller conversation'}],summary:'Synthetic provider result',durationSeconds:30,optedOut:false,humanRequested:true,nextAction:'Review synthetic request and follow up personally.'}});
 const carrier={kind:'outbound_carrier_estimate',evidenceRef:'SIMULATION reviewed carrier evidence',snapshotId:'SIMULATION snapshot',accountScope:'operation_owner',agentId:branch.agent_id,twilioAccountSid:ac,from:f.sender,reviewedAt:past,validFrom:past,validUntil:future,voice:{microsPerMinute:14000,rounding:'up',minimumMinutes:0},stream:{microsPerMinute:4400,rounding:'exact',minimumMinutes:0,assumption:'SIMULATION actual carrier seconds proxy'},source:{kind:'twilio_pricing_api',allowedCountries:['US'],maxMicrosPerMinute:94500,policyVersion:'SIMULATION rate policy',maxPricingLagSeconds:86400}};
 const policy={enabled:true,version:'required-audio-30d-speech-v1:fixture',rateId:rate,operation:'seller_call',reviewedAt:past,validFrom:past,validUntil:future,evidenceRef:'SIMULATION complete recording policy',components:Object.fromEntries(costCategories.filter(k=>k!=='elevenlabs').map(k=>[k,k==='twilio'?carrier:k==='other'?{kind:'recording_addon_estimate',policyVersion:recordingPolicy.version,evidenceRef:'SIMULATION recording policy'}:{kind:'fixed_estimate',amountMicros:rateCosts[k],evidenceRef:'SIMULATION overhead allowance'}]))};
 const fetcher=async(url)=>url.startsWith('https://api.elevenlabs.io/')?Response.json({...conversation(),status:'done'}):url.startsWith('https://pricing.twilio.com/')?Response.json({destination_number:phone,origination_number:f.sender,price_unit:'USD',iso_country:'US',outbound_call_prices:[{current_price:'0.014000',origination_prefixes:['ALL']}]}):Response.json(call());
 const legacyPolicy={...policy,version:'legacy-fixture',components:{...policy.components,other:{kind:'fixed_estimate',amountMicros:0,evidenceRef:'SIMULATION legacy zero addon'}}};assert.equal((await settleBoundVoiceUsage(db,account,live.id,[legacyPolicy],{env:process.env,fetcher})).reason,'recording_cost_policy_required');
 const billing=await runOutboundBilling(true,db,async(a,c)=>({billing:await settleBoundVoiceUsage(db,a,c,[policy],{env:process.env,fetcher})}));assert.equal(billing.status,'completed');assert.equal(billing.ledgerConfirmed,true);
 const receipt=await recordingPresentation(db,account,live.id);assert.equal(receipt.status,'available');assert.equal(receipt.costs.holdCents,977);assert(receipt.costs.customerChargeCents>0&&receipt.costs.customerChargeCents<977);assert(receipt.costs.items.some(x=>x.label==='Twilio audio recording'&&x.basis==='observed'));assert(receipt.costs.items.some(x=>x.label==='30-day audio storage allocation'&&x.basis==='estimated'));
 assert.equal((await service.audio(other,session.id,null)).status,404);assert.equal(await(await service.audio(account,session.id,null)).text(),'SYNTHETIC AUDIO FIXTURE');
 const afterExpiry=recordingService(process.env,{db,provider,now:()=>Date.parse(receipt.audioExpiresAt)});assert.equal((await afterExpiry.audio(account,session.id,null)).status,404);
 assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0,'Operational gate is never fabricated into recording/contact consent');
 assert.equal((await one('select count(*)::int n from icash_credit_ledger where event_key=$1',['usage:'+session.operation_key])).n,1);

 // Advance only the private SQL clock in this isolated database; no production clock/data edit.
 await pg.exec("create or replace function icash_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()+interval '31 days'$$;");
 const cleanup=await maintainRecordings(db,provider,{...process.env,ICASH_RECORDED_OUTBOUND_READY:'false'});assert.equal(cleanup.deleted,1);assert(events.includes('delete'));
 assert.equal((await one('select state from icash_call_recordings where id=$1',[session.id])).state,'deleted');assert.equal((await service.audio(account,session.id,null)).status,404);
 assert.equal((await settleBoundVoiceUsage(db,account,live.id,[policy],{env:process.env,fetcher})).status,'settled');assert.equal((await one('select count(*)::int n from icash_credit_ledger where event_key=$1',['usage:'+session.operation_key])).n,1,'Deleted audio receipt still supports idempotent delayed settlement');
 console.log('PASS FULL LOCAL CHAIN: operational contact/no fabricated consent → actual977 reserve/claim → accepted dial/lost response/no-redial → signed notice continuation → recording → ELregister → lazy bind → actual callback/handoff RPCs → real billing queue/ledger → private playback/expiry → independent verified provider deletion with capture flag OFF. Synthetic providers and isolated clock advance only.');
 await q('rollback');Date.now=realDateNow;
 // A second actual reserve/claim reaches only the consent gate, then settles carrier/ASR costs.
 await q('begin');const secondTransactionTime=Math.floor(Number((await one('select extract(epoch from now())*1000 as ms')).ms));Date.now=()=>secondTransactionTime;await prepare();await rpc('icash_queue_voice_jobs',{});job=await one('select * from icash_voice_jobs where account_id=$1',[account]);await q("update icash_voice_jobs set state='issued' where id=$1",[job.id]);
 events=[];callStatus='in-progress';recordingStatus='in-progress';loseDialResponse=false;
 await q('update icash_voice_configs set agent_config_hash=$2,required_tool_ids=array(select jsonb_array_elements_text($3::jsonb)) where account_id=$1',[account,review.configHash,review.toolIds]);
 assert.equal((await dispatcher.dispatchLiveVoice(account,job.id)).status,'call_started');
 session=await one('select * from icash_call_recordings where operation_key=$1',['voice:'+job.id]);
 const declineUrl=capturedTwiml.match(/action="([^"]+)"/)[1].replaceAll('&amp;','&');
 await q('savepoint durable_contact_stop');const originalEnd=provider.end;provider.end=async()=>{events.push('end-failed');throw Error('Synthetic carrier END outage');};
 await service.consent(signed(declineUrl,{AccountSid:ac,CallSid:ca,SpeechResult:'Don’t ever call me again'}),true);let stoppedContact=await one('select * from icash_call_recordings where id=$1',[session.id]);assert.equal(stoppedContact.state,'declined');assert(stoppedContact.end_requested_at&&!stoppedContact.call_ended_at);assert.equal(stoppedContact.consent_at,null);assert.equal((await one('select phone from icash_text_suppressions where phone=$1',[phone])).phone,phone);assert((await one('select revoked_at from icash_operational_contacts where id=$1',[job.operational_contact_id])).revoked_at);assert(!events.includes('start'));
 provider.end=originalEnd;await maintainRecordings(db,provider,{...process.env,ICASH_RECORDED_OUTBOUND_READY:'false'});stoppedContact=await one('select * from icash_call_recordings where id=$1',[session.id]);assert(stoppedContact.call_ended_at);assert.equal(stoppedContact.start_claimed_at,null);await q('rollback to savepoint durable_contact_stop');await q('release savepoint durable_contact_stop');events=['dial'];callStatus='in-progress';
 console.log('PASS signed explicit contact stop revokes the actual operational recipient and durable END retries with capture OFF; recording refusal remains separate.');
 await q('savepoint failed_asr_lost_terminal');await service.consent(signed(declineUrl,{AccountSid:ac,CallSid:ca,SpeechResult:'Yes!',Confidence:'NaN'}),true);const technicalFailure=await one('select * from icash_call_recordings where id=$1',[session.id]);assert.equal(technicalFailure.state,'failed');assert.equal(technicalFailure.consent_at,null);assert.equal(technicalFailure.start_claimed_at,null);assert.equal(technicalFailure.recording_sid,null);
 // No terminal callback is delivered. Maintenance must settle without discovering nonexistent AI.
 provider.conversations=async()=>{throw Error('Unstarted technical failure must not query ElevenLabs');};assert.equal((await maintainRecordings(db,provider,{...process.env,ICASH_RECORDED_OUTBOUND_READY:'false'})).reconciled,1);assert.equal((await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents,0);assert.equal((await one('select charged_cents from icash_operation_spend where operation_key=$1',[session.operation_key])).charged_cents,37);assert.equal((await one('select count(*)::int n from icash_live_conversations')).n,0);await q('rollback to savepoint failed_asr_lost_terminal');await q('release savepoint failed_asr_lost_terminal');events=['dial'];callStatus='in-progress';delete provider.conversations;
 console.log('PASS technical ASR failure plus lost terminal callback settles carrier/ASR once via off-flag worker, without querying nonexistent AI.');
 await service.consent(signed(declineUrl,{AccountSid:ac,CallSid:ca,SpeechResult:'No, thanks.',Confidence:'0.99'}),true);
 session=await one('select * from icash_call_recordings where id=$1',[session.id]);assert.equal(session.state,'declined');assert.equal(session.consent_at,null);assert.equal(session.recording_sid,null);assert.deepEqual(events,['dial','end']);
 const gate=await settleRecordingGateOnly(db,provider,session,Date.now()+2*3600000);assert.equal(gate.settled,true);assert.equal(gate.chargedCents,37);
 assert.equal((await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents,0);
 assert.equal((await one('select state from icash_voice_jobs where id=$1',[job.id])).state,'held');
 assert.equal((await one('select count(*)::int n from icash_live_conversations')).n,0);assert.equal((await one('select count(*)::int n from icash_contact_permissions')).n,0);
 assert.equal((await settleRecordingGateOnly(db,provider,session)).chargedCents,37);assert.equal((await one('select count(*)::int n from icash_credit_ledger where event_key=$1',['usage:'+session.operation_key])).n,1);
 console.log('PASS FULL REFUSAL CHAIN: actual977 reserve/claim → one signed refusal → no recording/AI session → verified carrier plus estimated one-use ASR/overhead →37-cent settlement, unused reservation released, no repeated dial/charge.');

}finally{Date.now=realDateNow;await pg.close();}
