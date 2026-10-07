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
 assert.equal(p.dnc_checked_at,null);assert.equal(p.dnc_clear,false);assert.equal(p.review_request_id,null);
 assert.equal(t.dnc_checked_at,null);assert.equal(t.dnc_clear,false);assert.equal(t.sms_review_request_id,null);
 assert.equal(p.seller_intake_id,lead);assert.equal(t.seller_intake_id,lead);
 const voice=()=>rpc('icash_seller_voice_permission_current',{p_account:account,p_permission:p.id});
 const sms=()=>rpc('icash_sms_thread_review_current',{p_account:account,p_thread:t.id,p_check_hour:true});
 assert.equal(await voice(),true);assert.equal(await sms(),true);
 const mutations=[
 ["update icash_seller_intakes set ai_consented=false",[]],
 ["update icash_seller_intakes set consent_text='different statement'",[]],
 ["update icash_seller_intakes set contact_consent_scope='different scope'",[]],
 ["update icash_seller_intakes set attribution='{}'",[]],
 ["update icash_seller_intakes set data_rights_until=now()-interval '1 minute'",[]],
 ["insert into icash_text_suppressions(phone,reason) values($1,'SIMULATION STOP')",[phone]],
 
 ["update icash_customer_identities set company_name='Changed sender' where account_id=$1",[account]],
 ["delete from icash_seller_responses;delete from icash_seller_matches",[]]
 ];
 for(const [sql,args] of mutations)await isolated(async()=>{for(const statement of sql.split(';').filter(Boolean))await q(statement,args);assert.equal(await voice(),false,sql);assert.equal(await sms(),false,sql);});
 await isolated(async()=>{await q('update icash_contact_permissions set revoked_at=now()');await project();assert.equal(await voice(),false,'retry cannot revoke an opt-out');});
 await isolated(async()=>{await q('update icash_text_threads set paused=true');await project();assert.equal(await sms(),false,'retry cannot unpause');});
 await isolated(async()=>{await q('update icash_text_threads set seller_sms_price_micros=seller_sms_price_micros+1');assert.equal(await sms(),false,'price bound');});
 await isolated(async()=>{await q("update icash_contact_permissions set permission_evidence='changed reference'");assert.equal(await voice(),false,'evidence bound');});
 const costs=JSON.parse(read('config/required-recording-rate-candidate.json')).costsMicros;
 const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values('seller_call','required-audio-30d-speech-v1:fixture',977,$1,2000,'SIMULATION recorded quote',now()-interval '1 minute',now()+interval '1 day',true,600) returning id",[costs])).id;
 await q("insert into icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,max_duration_seconds,required_tool_ids) values($1,true,'agent_fixture','phnum_fixture',$2,now()+interval '1 day',$3,600,array['tool_callback','tool_handoff','tool_stop'])",[account,'a'.repeat(64),rate]);
 const response=await rpc('icash_prepare_seller_responses',{p_lead:lead});
 assert(response[0].smsMessageId,'form consent queues actual first SMS');
 assert(response[0].voiceJobId,'form consent queues actual first call');
 const job=response[0].voiceJobId;
 assert.equal(await rpc('icash_reserve_paced_voice',{p_account:account,p_job:job,p_rate:rate,p_permission_until:p.permission_until,p_financial_checked_at:new Date().toISOString(),p_financial_eligible:true}),true);
 assert.equal(await rpc('icash_claim_reviewed_voice_job',{p_job:job}),true,'normal final voice claim accepts real saved consent');
 const recording=await rpc('icash_create_call_recording',{p_account:account,p_operation:'voice:'+job,p_provider_account_sid:'AC'+'a'.repeat(32),p_call_sid:null,p_nonce_hash:'b'.repeat(64),p_stop_token_hash:'c'.repeat(64),p_disclosure_version:'SIMULATION disclosure',p_pricing_policy:{version:'required-audio-30d-speech-v1',retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true},p_context:{fromPhone:f.sender,branchId:'agtbrch_fixture',versionId:'agtvrsn_fixture',maxTotalSeconds:600}});
 assert(recording?.id,'recording adapter accepts same source binding');
 const dial=await rpc('icash_transition_call_recording',{p_id:recording.id,p_account:account,p_operation:'voice:'+job,p_expected_state:'consent_pending',p_action:'claim_dial',p_payload:{}});
 assert(dial?.dial_claimed_at,'real final dial claim accepts consent without invented DNC');
 assert.equal(await rpc('icash_transition_call_recording',{p_id:recording.id,p_account:account,p_operation:'voice:'+job,p_expected_state:'consent_pending',p_action:'claim_dial',p_payload:{}}),null,'single use dial');

 assert.equal((await one('select count(*)::int n from icash_text_messages where direction=\'outgoing\' and provider_id is distinct from \'SIMULATION old receipt\'')).n,1);
 await q('update icash_seller_responses set next_attempt_at=now()');await rpc('icash_prepare_seller_responses',{p_lead:lead});
 assert.equal((await one('select count(*)::int n from icash_text_messages where direction=\'outgoing\' and provider_id is distinct from \'SIMULATION old receipt\'')).n,1,'retry does not duplicate');
 assert.equal((await one("select count(*)::int n from information_schema.routine_privileges where specific_schema='public' and routine_name in ('icash_seller_contact_evidence','icash_prepare_seller_contacts','icash_seller_sms_permission_current','icash_seller_voice_permission_current') and grantee in ('PUBLIC','anon','authenticated')")).n,0,'server-only entry points');
 console.log('PASS: saved consent automatically projects SMS/voice; real first SMS queue; no fabricated DNC; account, consent, principal, expiry, price and suppression checks; revocation/pause preserved; duplicate-safe retries; private functions. SIMULATED ONLY.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await pg.close();}
