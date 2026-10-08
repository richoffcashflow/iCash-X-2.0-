import assert from 'node:assert/strict';
import {receptionSettlementAttestation} from '../../lib/recorded-reception-settlement.ts';
import {receptionAudioAvailable} from '../../lib/recorded-reception.ts';
export async function testDirectRecordedInbound(f){
 const {db,q,val,rpc,read,scenario,config,account,trans,boundPayload,startPayload,serviceGet}=f;
 await db.exec(read('config/buyer-inbound-context.sql'));
 await db.exec(`alter table public.icash_text_threads add retired_at timestamptz,add sender text,add manual_only boolean default false;
 alter table public.icash_text_messages add provider_id text;
 create table public.icash_sms_conversation_focus(sender text,recipient text,account_id uuid,thread_id uuid,route_revision bigint,expires_at timestamptz);
 create table public.icash_sms_routes(sender text,recipient text,account_id uuid,revision bigint,needs_review boolean);`);
 await db.exec(read('config/direct-recorded-inbound.sql'));
 await db.exec(read('config/recorded-reception-final-clock.sql'));
 await db.exec(read('config/direct-reception-staging.sql'));
 async function reserve(context={}){
  const c=await val(`insert into icash_recorded_reception_private.configs select (jsonb_populate_record(null::icash_recorded_reception_private.configs,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'version',2,'enabled',false,'entry_policy','direct_recorded_v1')||$2::jsonb)).* from icash_recorded_reception_private.configs c where id=$1 returning id`,[config,context]);
  await q('update icash_recorded_reception_private.configs set enabled=false where id=$1',[config]);await q('update icash_recorded_reception_private.configs set enabled=true where id=$1',[c]);
  return f.reserve({p_config_id:c},'icash_reserve_direct_reception');
 }
 await scenario('direct recorded inbound retains affordable hold, verifies audio, bills no skipped speech',async()=>{
  const admission=await reserve();assert(admission.allowed,JSON.stringify(admission));let r=admission.session;
  assert.equal(r.entry_policy,'direct_recorded_v1');assert.equal(r.max_total_seconds,240);assert.equal(r.charge_cap_cents,196);
  assert.equal(await trans('authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'}),null);
  await trans('claim_setup');await trans('bounded',boundPayload(r));await trans('bind_call_start',startPayload(r));
  assert.equal(await trans('claim_start'),null);
  assert.equal(await trans('authorize_recording',{nonceHash:'f'.repeat(64),policy:'direct_recorded_v1'}),null);
  r=await trans('authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'});assert(r.recording_authorized_at);assert.equal(r.consent_at,null);assert.equal(r.consent_evidence,null);
  assert.equal(await trans('authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'}),null);
  await trans('claim_start');assert.equal(await trans('claim_start'),null);
  const start=r.recording_authorized_at,rec='RE'+'c'.repeat(32),end=new Date(Date.parse(start)+60000).toISOString();
  await db.exec(`create or replace function icash_recorded_reception_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$ select '${end}'::timestamptz $$;`);
  r=await trans('started',{recordingSid:rec,providerStartedAt:start});assert(r);
  await trans('claim_register');assert.equal(await trans('claim_register'),null);
  await trans('bind_conversation',{conversationId:'conv_direct',agentId:r.agent_id,branchId:r.branch_id,versionId:r.version_id});
  const {timeLimitSeconds,...binding}=boundPayload(r);await trans('call_ended',{...binding,status:'completed'});
  r=await trans('available',{recordingSid:rec,providerStartedAt:start,endedAt:end,durationSeconds:60,providerRecordingPriceMicros:2500});assert(r);assert(receptionAudioAvailable(r,Date.parse(end)));
  const call={sid:r.call_sid,account_sid:r.provider_account_sid,from:r.from_phone,to:r.to_phone,direction:'inbound',status:'completed',start_time:r.call_started_at,price:'-0.0085',price_unit:'USD',duration:'60'};
  const convo={conversation_id:r.conversation_id,agent_id:r.agent_id,branch_id:r.branch_id,version_id:r.version_id,status:'done',user_id:'icash-recorded-reception:'+r.id,conversation_initiation_client_data:{branch_id:r.branch_id,user_id:'icash-recorded-reception:'+r.id,dynamic_variables:{icash_reception_recording_id:r.id}},metadata:{call_duration_secs:60,cost_fiat:0.09,phone_call:{call_sid:r.call_sid,direction:'inbound',external_number:r.from_phone,agent_number:r.to_phone}}};
  const a=receptionSettlementAttestation(r,call,convo,null);assert(a);assert.equal(a.recording.speechGatherMicros,0);
  const categories=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];
  const components=Object.fromEntries(categories.map(k=>[k,{amountMicros:k==='twilio'?8500:k==='elevenlabs'?90000:k==='other'?a.recording.recordingMicros+a.recording.storageMicros+a.recording.streamMicros:0,basis:k==='other'?'estimated':'verified',evidenceRef:'Synthetic receipt for direct-entry regression'}]));
  await q('insert into icash_recorded_reception_private.cost_reviews(session_id,operation_key,attestation,components,evidence_ref,reviewed_by) values($1,$2,$3,$4,$5,$6)',[r.id,r.operation_key,a,components,'Synthetic test only exact cost evidence','fixture']);
  const paid=await rpc('icash_settle_recorded_reception',{p_id:r.id,p_account:account,p_operation:r.operation_key,p_attestation:a});assert(paid.settled,JSON.stringify(paid));assert(paid.chargedCents<196);
  assert.equal((await rpc('icash_settle_recorded_reception',{p_id:r.id,p_account:account,p_operation:r.operation_key,p_attestation:a})).chargedCents,paid.chargedCents);
  assert.equal(await val('select count(*) from public.icash_credit_ledger'),1);assert.equal(await val('select reserved_cents from public.icash_wallets'),0);
 });
 await scenario('final recording clock preserves initial evidence and rejects changes beyond one second',async()=>{
  const a=await reserve();assert(a.allowed);let r=a.session;
  await trans('claim_setup');await trans('bounded',boundPayload(r));await trans('bind_call_start',startPayload(r));
  r=await trans('authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'});await trans('claim_start');
  const start=new Date(Math.floor(Date.parse(r.recording_authorized_at)/1000)*1000).toISOString(),rec='RE'+'c'.repeat(32);
  r=await trans('started',{recordingSid:rec,providerStartedAt:start});assert(r);const initial=structuredClone(r);
  const payload=delta=>({recordingSid:rec,providerStartedAt:new Date(Date.parse(start)+delta).toISOString(),endedAt:new Date(Date.parse(start)+delta+32000).toISOString(),durationSeconds:32,providerRecordingPriceMicros:2500});
  assert.equal(await trans('available',payload(-1000)),null);
  assert.equal(await trans('available',payload(2000)),null);
  assert.equal(await trans('available',{...payload(1000),recordingSid:'RE'+'d'.repeat(32)}),null);
  r=await trans('available',payload(1000));assert(r);assert.equal(r.state,'available');
  assert.equal(Date.parse(r.final_provider_started_at),Date.parse(start)+1000);
  assert.equal(r.provider_started_at,initial.provider_started_at);assert.equal(r.audio_expires_at,initial.audio_expires_at);
  assert.equal(r.next_delete_at,initial.next_delete_at);assert.equal(r.recording_authorized_at,initial.recording_authorized_at);
  assert.equal(r.consent_at,null);assert.equal(r.duration_seconds,32);
  assert.equal(await trans('available',payload(0)),null);
  assert.equal(await trans('available',payload(1000),initial),null);
  assert(await trans('available',payload(1000)));
 });
 await scenario('inbound remembers only the matching unexpired SMS property focus',async()=>{
  const a=await reserve({context_policy:'buyer_seller_v1',context_policy_hash:'06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57',context_approval_reference:'Synthetic same-account continuity'});assert(a.allowed);
  let r=a.session;await trans('claim_setup');await trans('bounded',boundPayload(r));await trans('bind_call_start',startPayload(r));
  r=await trans('authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'});await trans('claim_start');await trans('started',{recordingSid:'RE'+'c'.repeat(32),providerStartedAt:r.recording_authorized_at});
  for(const [id,address] of [['11111111-1111-4111-8111-111111111111','45 Oak Road'],['22222222-2222-4222-8222-222222222222','67 Pine Road']]){
   await q("insert into public.icash_screening_jobs(id,account_id,snapshot) values($1::uuid,$2,jsonb_build_object('propertyId',($1::uuid)::text))",[id,account]);
   await q("insert into public.icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,'new',jsonb_build_object('address',$3::text))",[id,account,address]);
   await q("insert into public.icash_text_threads(id,account_id,deal_id,party,recipient,sender,paused) values($1,$2,$1,'seller',$3,'+14243948384',false)",[id,account,r.from_phone]);
   await q("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,created_at,body,provider_id) values(gen_random_uuid(),$1,$2,'outgoing','delivered',now()-interval '1 minute',$3,'synthetic')",[account,id,'Is this the owner of '+address+'?']);
  }
  const focus='11111111-1111-4111-8111-111111111111';
  await q("insert into public.icash_sms_routes values('+14243948384',$1,$2,6,false)",[r.from_phone,account]);
  await q("insert into public.icash_sms_conversation_focus values('+14243948384',$1,$2,$3,6,now()+interval '1 hour')",[r.from_phone,account,focus]);
  const lookup=()=>rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash});
  assert.equal((await lookup()).address,'45 Oak Road');
  await q('update public.icash_sms_routes set revision=7');assert.equal((await lookup()).status,'ambiguous');
  await q('update public.icash_sms_routes set revision=6');await q("update public.icash_sms_conversation_focus set expires_at=now()-interval '1 second'");assert.equal((await lookup()).status,'ambiguous');
 });
 await scenario('deployment preparation only stages a disabled clone with unchanged financial limits',async()=>{
  assert.equal(await rpc('icash_claim_direct_reception_branch',{p_source:config}),true);
  assert.equal(await rpc('icash_claim_direct_reception_branch',{p_source:config}),false);
  const candidate=await rpc('icash_stage_direct_reception',{p_source:config,p_branch:'agtbrch_directfixture',p_version:'agtvrsn_directfixture',p_hash:'f'.repeat(64)});
  assert(candidate);assert.equal(candidate.enabled,false);assert.equal(candidate.entry_policy,'direct_recorded_v1');
  const source=await val('select to_jsonb(c) from icash_recorded_reception_private.configs c where id=$1',[config]);
  assert.equal(source.enabled,true);assert.equal(candidate.charge_cap_cents,source.charge_cap_cents);assert.equal(candidate.rate_id,source.rate_id);
  assert.equal(await val('select count(*) from public.icash_operation_spend'),0);
 });
 for(const role of ['anon','authenticated'])assert.equal(await val("select has_function_privilege($1,'public.icash_reserve_direct_reception(uuid,text,text,text,text,text,text,text,text,text,text)','execute')",[role]),false);
 await (await import('./reception-return-call-limit-fixture.mjs')).testReceptionReturnCallLimit(f);
 if(process.env.RECEPTION_SELLER_OFFER_ONLY==='1')await (await import('./seller-offer-inbound-fixture.mjs')).testSellerOfferInbound({...f,reserve});
 if(process.env.RECEPTION_AVAILABLE_CREDITS==='1')await (await import('./available-inbound-credits-fixture.mjs')).testAvailableInboundCredits({...f,reserve});
}
