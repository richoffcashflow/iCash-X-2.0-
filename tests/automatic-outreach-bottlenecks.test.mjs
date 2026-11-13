import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(p,'utf8'),before=JSON.parse(read('tests/fixtures/automatic-outreach-before.json'));
const patch=read('config/automatic-outreach-bottlenecks.sql');
const migration=readdirSync('supabase/migrations').filter(p=>p.endsWith('_automatic_outreach_bottlenecks.sql'));
assert.equal(migration.length,1);assert.equal(patch,read('supabase/migrations/'+migration[0]));
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),account=uid(1),screen=uid(2),deal=uid(3),recipient='+12025550101';
const textOnly='+15127791343',dual='+18623812530',voiceOnly='+16462494809',hash='a'.repeat(64);
const sms=()=>val('select icash_business_conversation_sender($1,$2,$3,false)',[account,screen,recipient]);
const voice=()=>val('select icash_property_call_sender($1,$2,$3)',[account,screen,recipient]);
const recover=()=>val("select icash_recover_voice_configuration('agent_fixture',$1,$1,$2,clock_timestamp())",[hash,'b'.repeat(40)]);
const isolated=async fn=>{await q('begin');try{await fn();}finally{await q('rollback');}};
const thread=phone=>q("insert into icash_text_threads(account_id,deal_id,sender,recipient,party) values($1,$2,$3,$4,'seller')",[account,deal,phone,recipient]);
const add=async(n,outcome='business_number_verification_required')=>{
 const id=uid(n);
 await q('insert into icash_voice_contact_targets(id,account_id,screening_id,contact_key) values($1,$2,$3,$4)',[id,account,screen,'person-'+n]);
 await q('insert into icash_voice_jobs(id,account_id,operational_contact_id,outcome) values($1,$2,$1,$3)',[id,account,outcome]);
 await q('insert into icash_automation_tickets(id,account_id,voice_job_id,outcome) values($1,$2,$1,$3)',[id,account,outcome]);return id;
};
try{
 await pg.exec(read('tests/fixtures/voice-configuration-recovery-foundation.sql'));
 await pg.exec(read('config/unstarted-voice-configuration-recovery.sql'));
 await pg.exec(read('config/voice-configuration-recovery-schema-access.sql'));
 // The SQL-language wrapper resolves its target at creation, so install the
 // actual production selector before the supplemental fixture.
 await pg.exec(before.selector);
 await pg.exec(read('tests/fixtures/automatic-outreach-foundation.sql'));
 await pg.exec(before.recovery);
 await pg.exec("revoke all on function icash_business_conversation_sender(uuid,uuid,text,boolean) from public,anon,authenticated;grant execute on function icash_business_conversation_sender(uuid,uuid,text,boolean) to service_role;");
 await q('insert into icash_accounts(id) values($1)',[account]);await q('insert into icash_wallets(account_id) values($1)',[account]);
 await q('insert into icash_voice_configs(account_id,agent_config_hash) values($1,$2)',[account,hash]);
 await q('insert into icash_voice_production_template(id,agent_config_hash) values(1,$1)',[hash]);
 await q('insert into icash_screening_jobs(id,account_id) values($1,$2)',[screen,account]);
 await q('insert into icash_deal_files values($1,$2,$3)',[deal,account,screen]);
 await q('insert into icash_voice_contact_targets(id,account_id,screening_id,contact_key) values($1,$2,$3,$4)',[uid(4),account,screen,'initial-person']);
 await q('insert into icash_text_senders values($1,true),($2,true)',[textOnly,dual]);
 await q("insert into icash_business_voice_numbers values($1,false,true,null),($2,false,true,'PN'||repeat('b',32))",[textOnly,dual]);
 await q('insert into icash_text_senders values($1,false)',[voiceOnly]);
 await q("insert into icash_business_voice_numbers values($1,false,true,'PN'||repeat('c',32))",[voiceOnly]);
 await q("insert into icash_operational_contacts values($1,$2,'sms',$3,now()+interval '1 day',null)",[account,screen,recipient]);
 assert.equal(await sms(),textOnly,'Reproduce SMS-only initial routing');await thread(textOnly);assert.equal(await voice(),null,'Its later call cannot route');await q('delete from icash_text_threads');
 await isolated(async()=>{await q('update icash_business_voice_numbers set outbound_enabled=true where phone=$1',[voiceOnly]);assert.equal(await voice(),voiceOnly,'Reproduce voice-only first allocation');await q('insert into icash_call_recordings(account_id,screening_id,from_phone,to_phone) values($1,$2,$3,$4)',[account,screen,voiceOnly,recipient]);assert.equal(await sms(),null,'Its later text cannot route');});
 await q('update icash_business_voice_numbers set outbound_enabled=true where phone=$1',[dual]);
 await isolated(async()=>{await add(10);assert.equal(await recover(),0,'Reproduce never-started number failure remaining stuck');});
 const metadata=()=>val("select jsonb_agg(jsonb_build_array(oid,proacl,provolatile,prosecdef,proconfig) order by oid) from pg_proc where oid in ('icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure,'icash_recover_voice_configuration(text,text,text,text,timestamptz)'::regprocedure)");
 const originalMetadata=await metadata(),originalSenders=await val('select jsonb_agg(s order by phone) from icash_business_voice_numbers s');
 await pg.exec(patch);
 assert.deepEqual(await metadata(),originalMetadata);assert.deepEqual(await val('select jsonb_agg(s order by phone) from icash_business_voice_numbers s'),originalSenders,'Never activates numbers');
 assert.equal(await sms(),dual);await isolated(async()=>{await thread(dual);assert.equal(await voice(),dual,'First text and later call retain the same usable number');});
 await isolated(async()=>{await q('update icash_business_voice_numbers set outbound_enabled=true where phone=$1',[voiceOnly]);assert.equal(await voice(),dual,'First call excludes a voice-only number when SMS is eligible');await q('insert into icash_call_recordings(account_id,screening_id,from_phone,to_phone) values($1,$2,$3,$4)',[account,screen,dual,recipient]);assert.equal(await sms(),dual,'Call-first and later SMS keep a usable identity');});
 await isolated(async()=>{await q('update icash_business_voice_numbers set outbound_enabled=(phone=$1)',[voiceOnly]);assert.equal(await voice(),null,'No shared number defers a new dual-channel conversation');await q("update fixture_policy set allowed=false where kind='sms_channel'");assert.equal(await voice(),voiceOnly,'Explicitly disabled SMS retains voice-only capacity');});
 for(const mutation of ["update icash_operational_contacts set eligibility_until=now()-interval '1 second'","update icash_operational_contacts set revoked_at=now()","update icash_operational_contacts set channel='voice'","update icash_operational_contacts set phone='+12025550102'","update icash_operational_contacts set account_id='00000000-0000-4000-8000-000000000099'","update icash_operational_contacts set screening_id='00000000-0000-4000-8000-000000000099'"]){await isolated(async()=>{await pg.exec(mutation);await q('update icash_business_voice_numbers set outbound_enabled=(phone=$1)',[voiceOnly]);assert.equal(await voice(),voiceOnly,'Unrelated or stale SMS evidence does not consume dual-channel capacity');});}
 await isolated(async()=>{await q('update icash_business_voice_numbers set outbound_enabled=true where phone=$1',[voiceOnly]);await q('insert into icash_call_recordings(account_id,screening_id,from_phone,to_phone) values($1,$2,$3,$4)',[account,screen,voiceOnly,recipient]);assert.equal(await voice(),voiceOnly);assert.equal(await sms(),null,'Existing voice-only identity never rotates');});
 await isolated(async()=>{await q('update icash_business_voice_numbers set outbound_enabled=false');assert.equal(await sms(),null,'No verified dual-channel number defers new allocation');});
 await isolated(async()=>{await thread(textOnly);assert.equal(await sms(),textOnly);assert.equal(await voice(),null,'Existing SMS-only route never rotates');});
 await isolated(async()=>{await q('insert into icash_call_recordings(account_id,screening_id,from_phone,to_phone) values($1,$2,$3,$4)',[account,screen,textOnly,recipient]);assert.equal(await sms(),textOnly);assert.equal(await voice(),null,'Unknown prior call identity stays binding');});
 for(const mutation of ["update fixture_policy set allowed=false where kind='channel'","update icash_voice_contact_targets set permission_until=now()-interval '1 second'","update icash_voice_contact_targets set revoked_at=now()","update icash_voice_contact_targets set party='buyer'","update icash_voice_contact_targets set phone='+12025550102'","update icash_voice_contact_targets set account_id='00000000-0000-4000-8000-000000000099'","update icash_voice_contact_targets set screening_id='00000000-0000-4000-8000-000000000099'"]){
  await isolated(async()=>{await pg.exec(mutation);await q('update icash_business_voice_numbers set outbound_enabled=false');assert.equal(await sms(),textOnly,'Unrelated or non-callable contact keeps SMS capacity: '+mutation);});
 }
 for(const mutation of ["insert into fixture_delayed_senders values('"+dual+"')","insert into icash_sms_routes values('"+dual+"','"+recipient+"','"+account+"',true)","insert into fixture_role_conflicts values('"+dual+"','"+recipient+"')"]){await isolated(async()=>{await pg.exec(mutation);assert.equal(await sms(),null,'Health and route guards remain: '+mutation);});}
 await isolated(async()=>{await q('insert into icash_text_suppressions values($1)',[recipient]);assert.equal(await sms(),null);assert.equal(await voice(),null);});
 await pg.exec('grant usage on schema public,icash_text_receipt_private to service_role;grant select on all tables in schema public to service_role;grant update on icash_operating_budget,icash_voice_jobs to service_role;');
 for(const outcome of ['business_number_mismatch','business_number_verification_required','production_agent_review_required'])await isolated(async()=>{
  const id=await add(10,outcome),tickets=await val('select jsonb_agg(t) from icash_automation_tickets t');
  await q('set local role service_role');assert.equal(await recover(),1);assert.equal(await recover(),0);await q('reset role');
  assert.equal(await val('select state from icash_voice_jobs where id=$1',[id]),'ready');
  assert.equal(await val('select previous_outcome from icash_recording_private.configuration_recoveries'),outcome);
  assert.deepEqual(await val('select jsonb_agg(t) from icash_automation_tickets t'),tickets,'Original consumed ticket remains closed');
  assert.equal(await val('select count(*)::int from icash_operation_spend'),0);assert.equal(await val('select balance_cents::int from icash_wallets'),10000);
  await q('update icash_voice_jobs set state=\'held\',outcome=$1 where id=$2',[outcome,id]);assert.equal(await recover(),0,'A second failure cannot loop');
 });
 const blockers=[
  "update icash_business_voice_numbers set outbound_enabled=false",
  "update icash_voice_jobs set operation_key='unknown'","update icash_voice_jobs set provider_call_sid='original'","update icash_voice_jobs set conversation_id='original'",
  "insert into icash_operation_spend select 'voice:'||id,'dispatched' from icash_voice_jobs","insert into icash_call_recordings(voice_job_id,operation_key) select id,'voice:'||id from icash_voice_jobs","insert into icash_live_conversations select 'voice:'||id from icash_voice_jobs",
  "update icash_accounts set bot_paused=true","update icash_wallets set balance_cents=0","update icash_voice_configs set enabled=false","update icash_voice_production_template set enabled=false",
  "update icash_voice_contact_targets set permission_until=now()-interval '1 second'","update icash_voice_contact_targets set revoked_at=now()","update icash_voice_contact_targets set party='buyer'",
  "update icash_screening_jobs set snapshot=jsonb_build_object('fetchedAt',now()-interval '25 hours')","update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"hold\"}}'",
  "update icash_automation_tickets set outcome='different'","update icash_automation_tickets set completed_at=null","update icash_automation_tickets set expires_at=now()+interval '1 hour'",
  ...['callback_id','sms_source_message_id','cancellation_notice_id','meta_offer_lead_id','meta_retry_of','meta_followup_lead_id'].map(k=>`update icash_voice_jobs set ${k}=id`),
  ...['membership','channel','operational','hours','spacing','capacity','slot'].map(k=>`update fixture_policy set allowed=false where kind='${k}'`)
 ];
 for(const mutation of blockers)await isolated(async()=>{await add(10);await pg.exec(mutation);const prior=await val('select jsonb_agg(j) from icash_voice_jobs j');assert.equal(await recover(),0,mutation);assert.deepEqual(await val('select jsonb_agg(j) from icash_voice_jobs j'),prior);});
 await isolated(async()=>{for(let n=10;n<35;n++)await add(n);assert.equal(await recover(),20);assert.equal(await recover(),5);assert.equal(await recover(),0,'Recovery stays bounded');});
 for(const role of ['anon','authenticated']){assert.equal(await val("select has_function_privilege($1,'icash_recover_voice_configuration(text,text,text,text,timestamptz)','execute')",[role]),false);assert.equal(await val("select has_table_privilege($1,'icash_recording_private.configuration_recoveries','select')",[role]),false);}
 await assert.rejects(pg.exec(patch),/routing prerequisite changed/);await q('rollback');
 console.log('Automatic outreach: reproduced and fixed SMS-only and voice-only first allocations and stranded unstarted calls; source/identity, health, STOP, expiry, money, unknown outcomes, original tickets, bounded recovery and backend ACLs verified. Offline only.');
}finally{await pg.close();}
