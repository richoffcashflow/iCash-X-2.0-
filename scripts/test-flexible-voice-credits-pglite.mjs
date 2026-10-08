// SIMULATION ONLY. Real consent projection and response SQL, isolated PostgreSQL.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createOperationalContactFixture} from '../tests/helpers/operational-contact-fixture.mjs';
import {sellerConsentText,sellerConsentVersion} from '../lib/seller-leads.ts';
const f=await createOperationalContactFixture(process.argv[2]);
const {pg,q,rpc,one,account,user,other,phone,screening,deal,timezone,isolated}=f;
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
try{
 await pg.exec(`create table icash_seller_intakes(id uuid primary key,phone text,property jsonb,ai_consented boolean,created_at timestamptz default now(),name text default 'SIMULATION Seller',state text default 'assigned',consent_version text,consent_text text,contact_consent_scope text,attribution jsonb,data_rights_until timestamptz);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid,assigned_at timestamptz default now(),primary key(lead_id,account_id));
 create table icash_seller_controls(id integer,enabled boolean,data_rights_until timestamptz,lookup_allowance_micros bigint,lookup_used_micros bigint,lookup_reserved_micros bigint);
 create table icash_seller_markets(enabled boolean,reviewed_until timestamptz);
 create table icash_daily_plans(account_id uuid,mode text,state text);
 create function icash_customer_update_sources(uuid) returns table(source_key text,kind text,screening_id uuid,event_at timestamptz,priority integer) language sql as $$select null::text,null::text,null::uuid,null::timestamptz,null::integer where false$$;
 alter table icash_text_threads add column manual_only boolean not null default false;
 create table icash_timezone_names(name text primary key);insert into icash_timezone_names select name from pg_timezone_names;`);
 await pg.exec(read('config/outbound-billing-queue.sql'));
 await pg.exec(read('config/required-call-recording.sql'));
 await pg.exec(read('config/recording-consent-evidence-v4.sql'));
 await pg.exec(read('config/required-call-recording-consent-v4.sql'));
 await pg.exec(read('config/self-service-outreach-campaigns.sql'));
 await rpc('icash_record_outreach_campaign',{p_account:account,p_user:user,p_mode:'outbound_voice_sms',p_version:'outreach-channels-2026-10-03.1',p_accepted:true});
 await pg.exec(read('supabase/migrations/20261005124045_seller_response_handoff_and_activity.sql'));
 await pg.exec(read('config/seller-intake-contacts.sql'));
 // Apply every exact production migration patch, including final claim and recording gates.
 const migration=read('supabase/migrations/20261006233159_seller_intake_contact_handoff.sql');
 for(const block of migration.match(/do \$patch\$[\s\S]*?end \$patch\$;/g)){
  await pg.exec(block);
 }
 const routing=read('supabase/migrations/20261006235709_seller_snapshot_and_retired_practice_threads.sql');
 await pg.exec(routing.slice(0,routing.indexOf('do $patch$'))+'commit;');
 for(const block of routing.match(/do \$patch\$[\s\S]*?end \$patch\$;/g)){
  if(/icash_assign_seller_lead_for|icash_prepare_manual_text/.test(block))continue;
  await pg.exec(block);
 }
 const natural=read('supabase/migrations/20261007001350_natural_seller_conversations.sql');
 // Fixture uses the pre-network opener; apply the same production prerequisite first.
 await pg.exec(read('config/homeoffer-buyer-introductions.sql'));
 await pg.exec(natural.match(/do \$patch\$[\s\S]*?end \$patch\$;/)[0]);
 await pg.exec(read('supabase/migrations/20261007001915_short_seller_interest_question.sql'));
 const oldScreen=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,'SIMULATION old practice','{\"propertyId\":\"practice_old\"}','complete','{}',now()) returning id",[account])).id;
 const oldDeal=(await one("insert into icash_deal_files(account_id,screening_id,stage,terms) values($1,$2,'draft','{\"practice\":true,\"address\":\"SIMULATION old practice\"}') returning id",[account,oldScreen])).id;
 const oldThread=(await one("insert into icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused) values($1,$2,$3,$4,now()-interval '1 day','SIMULATION old practice consent',$5,now()-interval '2 days',true,$6,true) returning id",[account,oldDeal,f.sender,phone,timezone,f.sms])).id;
 await q("insert into icash_text_messages(thread_id,account_id,direction,body,state,provider_id,created_at) values($1,$2,'outgoing','SIMULATION old practice text','delivered','SIMULATION old receipt',now()-interval '2 days')",[oldThread,account]);
 const lead=randomUUID();
 await q('insert into icash_seller_intakes(id,phone,property,ai_consented,consent_version,consent_text,contact_consent_scope,attribution,data_rights_until) values($1,$2,$3,true,$4,$5,$6,$7,now()+interval \'2 days\')',[lead,phone,{address:'123 Main Street',state:'TX'},sellerConsentVersion,sellerConsentText,'homeoffer_network_and_matched_buyers',{contactTimezone:timezone,contactTimezoneSource:'seller_browser'}]);
 await q('insert into icash_seller_matches(lead_id,account_id,screening_id) values($1,$2,$3)',[lead,account,screening]);
 const project=()=>rpc('icash_prepare_seller_contacts',{p_account:account,p_lead:lead,p_screening:screening,p_deal:deal});
 const evidence=(acc=account)=>rpc('icash_seller_contact_evidence',{p_account:acc,p_screening:screening,p_lead:lead,p_phone:phone});
 assert.equal(await evidence(other),null,'match is tenant bound');
 await project();await project();
 assert((await one('select retired_at,deal_id from icash_text_threads where id=$1',[oldThread])).retired_at,'expired practice retired');
 assert.equal((await one('select deal_id from icash_text_threads where id=$1',[oldThread])).deal_id,oldDeal,'practice history stays bound to its original property');
 const p=await one('select * from icash_contact_permissions where account_id=$1',[account]);
 const t=await one('select * from icash_text_threads where account_id=$1 and retired_at is null',[account]);

 await pg.exec(read('config/seller-limited-contact.sql'));
 await q("insert into icash_seller_controls(id,enabled,limited_contact_enabled) values(1,true,false)");
 await q("update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{sellerRequest}',jsonb_build_object('id',$2::text)),result=$3,completed_at=now() where id=$1",[screening,lead,{financialCheck:{status:"hold"},property:{financialScreening:{status:"payoff_may_exceed_budget"}},offerAuthorized:false}]);
 const limited=()=>rpc('icash_seller_limited_contact',{p_account:account,p_screening:screening});
 assert.equal(await limited(),false,'disabled until deployment');
 await q('update icash_seller_controls set limited_contact_enabled=true');
 assert.equal(await limited(),true);
 assert.equal(await rpc('icash_seller_limited_contact',{p_account:other,p_screening:screening}),false,'tenant isolated');
 await isolated(async()=>{await q("update icash_seller_matches set assigned_at=now()-interval '25 hours'");assert.equal(await limited(),false,'window expires');});
 await isolated(async()=>{await q("update icash_seller_intakes set ai_consented=false");assert.equal(await limited(),false,'consent required');});
 const costs=JSON.parse(read('config/required-recording-rate-candidate.json')).costsMicros;
 const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values('seller_call','required-audio-30d-speech-v1:fixture',977,$1,2000,'SIMULATION recorded quote',now()-interval '1 minute',now()+interval '1 day',true,600) returning id",[costs])).id;
 await q("insert into icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,max_duration_seconds,required_tool_ids) values($1,true,'agent_fixture','phnum_fixture',$2,now()+interval '1 day',$3,600,array['tool_callback','tool_handoff','tool_stop'])",[account,'a'.repeat(64),rate]);
 await rpc('icash_queue_voice_jobs_before_operational');
 const job=await one('select * from icash_voice_jobs where permission_id=$1',[p.id]);
 assert.equal(await rpc('icash_limited_seller_voice',{p_account:account,p_operation:'voice:'+job.id}),true);
 await isolated(async()=>{await q('update icash_contact_permissions set revoked_at=now() where id=$1',[p.id]);assert.equal(await rpc('icash_limited_seller_voice',{p_account:account,p_operation:'voice:'+job.id}),false,'revocation enforced');});
 await rpc('icash_queue_voice_jobs_before_operational');
 assert.equal((await one('select count(*)::int n from icash_voice_jobs where permission_id=$1',[p.id])).n,1,'one initial call only');
 assert.equal((await one('select result from icash_screening_jobs where id=$1',[screening])).result.financialCheck.status,'hold','never fake financial qualification');
 await pg.exec(read('supabase/migrations/20261003223200_membership_and_prepaid_credits.sql'));
 await pg.exec(`create function icash_general_reception_pause_exempt(uuid,text,bigint) returns boolean language sql as $$select false$$;
 create function icash_customer_text_operation(uuid,text) returns boolean language sql as $$select false$$;
 create table icash_question_usage(account_id uuid,question_id uuid,state text);`);
 await pg.exec('alter table icash_operation_rates add column if not exists flat_customer_price_cents bigint;');
 const vip=read('config/vip-and-daily-allowance.sql');
 await pg.exec(vip.slice(0,vip.indexOf('CREATE OR REPLACE FUNCTION public.icash_assign_seller_lead_for'))+'commit;');
 await q('update icash_operating_budget set standard_cost_multiplier=3,elevenlabs_cost_multiplier=3');
 await pg.exec('alter table icash_operation_rates add column if not exists flat_customer_price_cents bigint;');
 await pg.exec(read('config/flexible-voice-credits.sql'));
 await q("update icash_voice_jobs set state='issued' where id=$1",[job.id]);
 await q("update icash_wallets set balance_cents=452,reserved_cents=0 where account_id=$1",[account]);
 const reserve=()=>rpc('icash_reserve_flexible_voice',{p_account:account,p_job:job.id,p_rate:rate,p_permission_until:p.permission_until,p_financial_eligible:false});
 await isolated(async()=>{await q('update icash_wallets set balance_cents=0 where account_id=$1',[account]);assert.equal(await reserve(),null,'zero credits cannot call');assert.equal((await one("select count(*)::int n from icash_voice_credit_bounds")).n,0,'no unfunded bound');});
 await isolated(async()=>{await q("update icash_screening_jobs set result=jsonb_set(result,'{financialCheck,status}','\"eligible\"') where id=$1",[screening]);const normal=await rpc('icash_reserve_flexible_voice',{p_account:account,p_job:job.id,p_rate:rate,p_permission_until:p.permission_until,p_financial_checked_at:new Date(Date.now()-1000).toISOString(),p_financial_eligible:true});assert(normal.maxSeconds>=120&&normal.maxSeconds<600,'ordinary calls also adapt to available balance');assert(normal.reservedCents<=226);});
 // VIP reduction is retained by the dynamic patch and immutable operation snapshot.
 await isolated(async()=>{
  await q("insert into icash_memberships(account_id,mode,state,guest_hash,price_cents,offer_revision,paid_through,consent_version,consent_text,vip_until) values($1,'live','active',repeat('a',64),10000,1,now()+interval '1 day','SIMULATION','SIMULATION consent',now()+interval '1 day')",[account]);
  const vip=await reserve();assert(vip&&vip.maxSeconds===120);
  const vipSpend=await one('select charge_cap_cents,standard_cost_multiplier from icash_operation_spend where operation_key=$1',['voice:'+job.id]);
  assert.equal(Number(vipSpend.standard_cost_multiplier),2.4);assert.equal(vip.reservedCents,165,'20% off the reviewed bounded cost');
 });
 await isolated(async()=>{const stale=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) select operation,'required-audio-30d-speech-v1:stale',charge_cents,costs_micros,buffer_bps,evidence_ref,now()-interval '2 days',now()-interval '1 day',true,voice_max_duration_seconds from icash_operation_rates where id=$1 returning id",[rate])).id;assert.equal(await rpc('icash_reserve_flexible_voice',{p_account:account,p_job:job.id,p_rate:stale,p_permission_until:p.permission_until}),null,'stale quote cannot fund call');});
 await isolated(async()=>{await q("update icash_operating_budget set require_company_reserve=false");await q('insert into icash_spend_activations(account_id,enabled,customer_cap_cents) values($1,true,101)',[account]);assert.equal(await reserve(),null,'does not increase activation cap to fund a call');});
 const funded=await reserve();assert(funded,'short call starts below full quote');assert.equal(funded.maxSeconds,120,'limited contact stays brief');
 const spend=await one("select charge_cap_cents from icash_operation_spend where operation_key=$1",['voice:'+job.id]);assert(spend.charge_cap_cents<=226,'fits current 50% daily allowance');
 const before=(await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents;
 assert.equal((await reserve()).maxSeconds,120,'retry preserves time bound');assert.equal((await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents,before,'no duplicate reservation');
 assert.equal(await rpc('icash_claim_limited_seller_voice',{p_job:job.id,p_snapshot:(await one('select snapshot from icash_screening_jobs where id=$1',[screening])).snapshot}),true,'final claim accepts funded short call');
 const recordArgs={p_account:account,p_operation:'voice:'+job.id,p_provider_account_sid:'AC'+'a'.repeat(32),p_call_sid:null,p_nonce_hash:'b'.repeat(64),p_stop_token_hash:'c'.repeat(64),p_disclosure_version:'SIMULATION disclosure',p_pricing_policy:{version:'required-audio-30d-speech-v1',retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true},p_context:{fromPhone:f.sender,branchId:'agtbrch_fixture',versionId:'agtvrsn_fixture',maxTotalSeconds:600}};
 assert.equal(await rpc('icash_create_call_recording',recordArgs),null,'cannot dial longer than funded');
 recordArgs.p_context.maxTotalSeconds=120;const recording=await rpc('icash_create_call_recording',recordArgs);assert.equal(recording.max_total_seconds,120,'carrier receives persisted funded limit');assert.equal(recording.charge_cap_cents,spend.charge_cap_cents);
 // After-hours form inquiries use real consent projection and the final text claim.
 await pg.exec(`alter table icash_text_messages add column route_revision bigint;
 create table icash_sms_routes(sender text,recipient text,account_id uuid,revision bigint,needs_review boolean);`);
 const night=(await one("select name from pg_timezone_names where extract(hour from now() at time zone name)=21 limit 1")).name;
 await q("update icash_seller_intakes set attribution=jsonb_set(attribution,'{contactTimezone}',to_jsonb($1::text)) where id=$2",[night,lead]);
 await q('update icash_text_threads set timezone=$1,permission_evidence=$2 where id=$3',[night,(await evidence()).evidence,t.id]);
 await q("update icash_text_threads t set seller_sms_rate_hash=encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') from icash_operation_rates r where t.id=$1 and r.id=t.sms_rate_id",[t.id]);
 const smsCurrent=()=>rpc('icash_seller_sms_permission_current',{p_account:account,p_thread:t.id,p_check_hour:true});
 assert.equal(await smsCurrent(),false,'previous final hours gate stops fresh form inquiries');
 await pg.exec(read('config/seller-inquiry-sms-hours.sql'));
 assert.equal(await smsCurrent(),true,'own consented inquiry can receive an immediate text');
 await isolated(async()=>{await q('update icash_text_threads set paused=true where id=$1',[t.id]);assert.equal(await smsCurrent(),false,'pause enforced');});
 await isolated(async()=>{await q('update icash_text_threads set manual_only=true where id=$1',[t.id]);assert.equal(await smsCurrent(),false,'manual handoff enforced');});
 await isolated(async()=>{await q("update icash_seller_intakes set created_at=now()-interval '25 hours' where id=$1",[lead]);await q('update icash_text_threads set permission_evidence=$1 where id=$2',[(await evidence()).evidence,t.id]);assert.equal(await smsCurrent(),false,'older form does not open night outreach');
  await q('insert into icash_sms_routes values($1,$2,$3,1,false)',[f.sender,phone,account]);
  await q("insert into icash_text_messages(thread_id,account_id,direction,body,state,route_revision) values($1,$2,'incoming','SIMULATION property reply','received',1)",[t.id,account]);
  assert.equal(await smsCurrent(),true,'recent property-bound reply opens a short response window');
  await q('update icash_sms_routes set needs_review=true');assert.equal(await smsCurrent(),false,'ambiguous reply does not open the window');
 });
 await isolated(async()=>{
  await q('update icash_wallets set balance_cents=100000 where account_id=$1',[account]);await q('update icash_daily_allowances set base_cents=100000 where account_id=$1',[account]);
  const message=(await one("insert into icash_text_messages(thread_id,account_id,direction,body,state,customer_price_micros) values($1,$2,'outgoing','SIMULATION ownership opener','ready',1000000) returning id",[t.id,account])).id;
  const claim=()=>rpc('icash_claim_text_before_ai',{p_account:account,p_message:message,p_sender:f.sender});
  await q("insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]);assert.equal(await claim(),null,'global STOP wins over inquiry window');
  await q('delete from icash_text_suppressions where phone=$1',[phone]);
  assert.ok(await claim(),'real final claim admits fresh consented inquiry after hours');
 });
 console.log('PASS: short call fits actual daily allowance; VIP discount, stale quotes, activation cap, consent, idempotency and recording hard limit enforced.');
 console.log('PASS: after-hours inquiry SMS, final claim, stale inquiry, ambiguous response, pause/manual and STOP checks. No live provider traffic.');
}catch(e){console.error(e.message,e.where??'',e.position,e.query?.slice(Math.max(0,Number(e.position)-200),Number(e.position)+200));process.exitCode=1;}finally{await pg.close();}
