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
 await pg.exec('create table if not exists icash_daytime_pacing_settings(id integer,enabled boolean);');
 await pg.exec('alter table icash_operation_rates add column if not exists flat_customer_price_cents bigint;');
 await pg.exec(read('config/flexible-voice-credits.sql'));
 await q("update icash_voice_jobs set state='issued' where id=$1",[job.id]);
 await q("update icash_wallets set balance_cents=543,reserved_cents=0 where account_id=$1",[account]);
 const reserve=()=>rpc('icash_reserve_flexible_voice',{p_account:account,p_job:job.id,p_rate:rate,p_permission_until:p.permission_until,p_financial_eligible:false});
 await isolated(async()=>{await q('update icash_wallets set balance_cents=0 where account_id=$1',[account]);assert.equal(await reserve(),null,'zero credits cannot call');assert.equal((await one("select count(*)::int n from icash_voice_credit_bounds")).n,0,'no unfunded bound');});
 await isolated(async()=>{await q("update icash_screening_jobs set result=jsonb_set(result,'{financialCheck,status}','\"eligible\"') where id=$1",[screening]);const normal=await rpc('icash_reserve_flexible_voice',{p_account:account,p_job:job.id,p_rate:rate,p_permission_until:p.permission_until,p_financial_checked_at:new Date(Date.now()-1000).toISOString(),p_financial_eligible:true});assert(normal.maxSeconds>=120&&normal.maxSeconds<600,'ordinary calls also adapt to available balance');assert(normal.reservedCents<=543);});
 const funded=await reserve();assert(funded,'short call starts below full quote');assert.equal(funded.maxSeconds,120,'limited contact stays brief');
 const spend=await one("select charge_cap_cents from icash_operation_spend where operation_key=$1",['voice:'+job.id]);assert(spend.charge_cap_cents<543,'does not require full 977');
 const before=(await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents;
 assert.equal((await reserve()).maxSeconds,120,'retry preserves time bound');assert.equal((await one('select reserved_cents from icash_wallets where account_id=$1',[account])).reserved_cents,before,'no duplicate reservation');
 assert.equal(await rpc('icash_claim_limited_seller_voice',{p_job:job.id,p_snapshot:(await one('select snapshot from icash_screening_jobs where id=$1',[screening])).snapshot}),true,'final claim accepts funded short call');
 const recordArgs={p_account:account,p_operation:'voice:'+job.id,p_provider_account_sid:'AC'+'a'.repeat(32),p_call_sid:null,p_nonce_hash:'b'.repeat(64),p_stop_token_hash:'c'.repeat(64),p_disclosure_version:'SIMULATION disclosure',p_pricing_policy:{version:'required-audio-30d-speech-v1',retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true},p_context:{fromPhone:f.sender,branchId:'agtbrch_fixture',versionId:'agtvrsn_fixture',maxTotalSeconds:600}};
 assert.equal(await rpc('icash_create_call_recording',recordArgs),null,'cannot dial longer than funded');
 recordArgs.p_context.maxTotalSeconds=120;const recording=await rpc('icash_create_call_recording',recordArgs);assert.equal(recording.max_total_seconds,120,'carrier receives persisted funded limit');assert.equal(recording.charge_cap_cents,spend.charge_cap_cents);
 console.log('PASS: flexible reservation fits 543 cents, 120-second limited contact, bound rate, idempotent wallet hold.');
 console.log('PASS: limited contact disabled by default, tenant and consent bound, 24-hour expiry, one initial call, no fabricated financial qualification.');
}catch(e){console.error(e.message,e.where??'',e.position,e.query?.slice(Math.max(0,Number(e.position)-200),Number(e.position)+200));process.exitCode=1;}finally{await pg.close();}
