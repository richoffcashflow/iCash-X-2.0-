import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {recordingService} from '../../lib/required-call-recording-service.ts';
import {canonical,sha,recordingPolicy,recordingBaseUrl,audioAvailable} from '../../lib/required-call-recording.ts';
import {recordingAddonCosts,completedRecordingReceipt} from '../../lib/required-call-recording-cost.ts';
export async function testDirectRecordedOutbound(f){
 const {pg,q,rpc,read,scenario,trans,get,context,account,permission,operation,ac,call,rec,admin}=f;
 await pg.exec(`create function public.icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function public.icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select false$$;
 alter table public.icash_live_conversations drop constraint icash_live_conversations_strategy_key_check;
 alter table public.icash_live_conversations add constraint icash_live_conversations_strategy_key_check check(strategy_key in ('cash_interest','flexible_timing','buyer_followup'));
 `);
 await pg.exec(read('config/direct-recorded-outbound.sql'));
 for(const party of ['seller','buyer'])await scenario('direct '+party+' outbound records before AI; replay cannot record twice',async()=>{
  if(party==='buyer')await admin(async()=>{await q("update public.icash_contact_permissions set party='buyer'");await q("update public.icash_operation_rates set operation='buyer_call'");await q('update public.icash_voice_configs set buyer_rate_id=$1',[permission]);});
  const when=new Date().toISOString(),network=[];
  const config={agent_id:'agent_fixture',branch_id:context.branchId,main_branch_id:'agtbrch_main',version_id:context.versionId,conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{agent_output_audio_format:'ulaw_8000'},conversation:{max_duration_seconds:600},agent:{prompt:{tool_ids:['tool_callback','tool_handoff','tool_stop']}}},platform_settings:{privacy:{record_voice:false},auth:{enable_auth:true},call_limits:{bursting_enabled:false},queueing_config:{enabled:false},overrides:{conversation_config_override:{conversation:{max_duration_seconds:true},agent:{first_message:true,prompt:{prompt:true}},tts:{voice_id:true}}}}};
  const review={enabled:true,reviewedAt:new Date(Date.now()-60000).toISOString(),reviewedUntil:new Date(Date.now()+3600000).toISOString(),agentId:config.agent_id,branchId:config.branch_id,versionId:config.version_id,configHash:sha(JSON.stringify(canonical({conversation_config:config.conversation_config,platform_settings:config.platform_settings,workflow:null,procedures:null}))),fromPhone:context.fromPhone,providerAccountSid:ac,stopToolId:'tool_stop',toolIds:['tool_callback','tool_handoff','tool_stop'],approvedHoldCents:977,retentionDays:30,maxTotalSeconds:600,policyVersion:recordingPolicy.version};
  const env={ICASH_RECORDED_OUTBOUND_READY:'true',RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(review),TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-local-only-twilio-token'};
  const tool={id:'tool_stop',tool_config:{type:'webhook',name:'icash_stop_recording',api_schema:{url:recordingBaseUrl+'/stop',method:'POST',request_headers:{Authorization:{variable_name:'secret__icash_recording_stop_token'}},request_body_schema:{type:'object',required:['recordingId'],properties:{recordingId:{type:'string',dynamic_variable:'icash_recording_id'}}}}}};
  const db=async(path,method,b)=>path.startsWith('rpc/')?rpc(path.slice(4),Object.values(b)):path.startsWith('icash_call_recordings?')?[await get()]:Promise.reject(Error(path));
  const provider={agent:async()=>config,tool:async()=>tool,dial:async(from,to,twiml)=>{network.push({action:'dial',twiml});return {sid:call,account_sid:ac,from,to,direction:'outbound-api',date_created:when};},getCall:async()=>({sid:call,account_sid:ac,from:context.fromPhone,to:'+12125550102',direction:'outbound-api',date_created:when,start_time:when,status:'in-progress'}),start:async()=>{network.push({action:'start'});return {sid:rec,account_sid:ac,call_sid:call,status:'in-progress',start_time:new Date().toISOString()};},register:async(r,seconds)=>{network.push({action:'register'});assert(r.recording_sid&&r.recording_authorized_at);assert.equal(r.consent_at,null);assert(seconds>0&&seconds<=600);return '<Response><Connect><Stream url="wss://fixture.invalid"/></Connect></Response>';},end:async()=>{network.push({action:'end'});return {sid:call,account_sid:ac,status:'completed'};}};
  const service=recordingService(env,{db,provider});
  const result=await service.dispatch({accountId:account,operationKey:operation,principal:'Fixture',assistantName:'Alex',firstMessage:party==='seller'?'Is this the owner of 45 Oak Road?':'Are you buying near 45 Oak Road?',prompt:'Exact bound property conversation',strategyKey:'cash_interest'});
  assert.equal(result.status,'recording_consent_pending');const twiml=network[0].twiml;
  assert(!/<Say|<Gather|notice|question/.test(twiml));
  const url=twiml.match(/<Redirect method="POST">([^<]+)/)[1].replaceAll('&amp;','&');
  const fields=new URLSearchParams({AccountSid:ac,CallSid:call,CallStatus:'in-progress'});
  const signature=createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(url+[...fields.keys()].sort().map(k=>k+fields.get(k)).join('')).digest('base64');
  const request=()=>new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature},body:fields});
  assert.match(await(await service.consent(request(),false,true)).text(),/<Connect/);
  let row=await get();assert.equal(row.consent_at,null);assert.equal(row.consent_evidence,null);assert(row.recording_authorized_at&&row.recording_sid);assert.deepEqual(network.map(x=>x.action),['dial','start','register']);
  const originalAuthority=row.recording_authorized_at;
  // Existing exact-conversation tool binding and audio presentation must accept real recording evidence.
  row=await trans('bind_conversation',{conversationId:'conv_direct',toolTokenHash:'f'.repeat(64)});assert(row);
  await service.consent(request(),false,true);assert.equal(network.filter(x=>x.action==='start').length,1);assert.equal((await get()).recording_authorized_at,originalAuthority);

  const end=new Date(Date.parse(row.provider_started_at)+1000).toISOString();
  row=await trans('available',{recordingSid:rec,providerStartedAt:row.provider_started_at,endedAt:end,durationSeconds:1,providerRecordingPriceMicros:2500});assert(row);
  assert(audioAvailable(row));assert(completedRecordingReceipt(row));assert.equal(recordingAddonCosts(row).speech,0);
  assert.equal((await q('select count(*) n from public.icash_live_conversations')).rows[0].n,1);
 });
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb)','execute') allowed",[role])).rows[0].allowed,false);
}
