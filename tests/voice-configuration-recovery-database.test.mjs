// Isolated Postgres fixture. Never dials, charges or connects to production.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/unstarted-voice-configuration-recovery.sql');
const accessSql=read('config/voice-configuration-recovery-schema-access.sql');
const boundedSql=read('config/bounded-voice-configuration-recovery.sql');
const lookupSql=read('config/voice-configuration-recovery-target-lookup.sql');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),account=uid(1),hash='a'.repeat(64);
try{
 await pg.exec(read('tests/fixtures/voice-configuration-recovery-foundation.sql'));
 await q('insert into icash_accounts(id) values($1)',[account]);await q('insert into icash_wallets(account_id) values($1)',[account]);
 await q('insert into icash_voice_configs(account_id,agent_config_hash) values($1,$2)',[account,hash]);await q('insert into icash_voice_production_template(id,agent_config_hash) values(1,$1)',[hash]);
 await pg.exec(sql);
 await pg.exec('grant select on all tables in schema public to service_role;grant update on icash_operating_budget,icash_voice_jobs to service_role;');
 const add=async(n,{contact='contact-'+n,legacy=false}={})=>{
  const id=uid(n);
  await q('insert into icash_screening_jobs(id,account_id) values($1,$2)',[id,account]);
  await q('insert into icash_voice_contact_targets(id,account_id,screening_id,contact_key,eligibility_source) values($1,$2,$1,$3,$4)',[id,account,contact,legacy?'operator_record':'operational_checks_only']);
  await q(`insert into icash_voice_jobs(id,account_id,${legacy?'permission_id':'operational_contact_id'}) values($1,$2,$1)`,[id,account]);
  await q('insert into icash_automation_tickets(id,account_id,voice_job_id) values($1,$2,$1)',[id,account]);return id;
 };
 const recover=()=>val("select icash_recover_voice_configuration('agent_fixture',$1,$1,$2,clock_timestamp())",[hash,'b'.repeat(40)]);
 const isolated=async fn=>{await q('begin');try{await fn();}finally{await q('rollback');}};
 await isolated(async()=>{
  await add(99);await q('set local role service_role');
  await assert.rejects(recover(),/permission denied for schema icash_recording_private/);
 });
 await pg.exec(accessSql);
 await pg.exec(boundedSql);
 await pg.exec(lookupSql);
 await isolated(async()=>{
  const id=await add(99);await q('set local role service_role');
  assert.equal(await recover(),1,'the actual backend role can recover and persist its audit');
  assert.equal(await val('select state from icash_voice_jobs where id=$1',[id]),'ready');
  assert.equal(await val('select count(*)::int from icash_recording_private.configuration_recoveries'),1);
  assert.equal(await recover(),0);
 });
 await isolated(async()=>{
  await q('set local role service_role');
  await assert.rejects(q('select * from icash_recording_private.original_receipts'),/permission denied/);
 });
 for(const legacy of [false,true])await isolated(async()=>{
  const id=await add(100,{legacy}),tickets=await val('select jsonb_agg(t) from icash_automation_tickets t');
  assert.equal(await recover(),1);assert.equal(await val('select state from icash_voice_jobs where id=$1',[id]),'ready');
  assert.deepEqual(await val('select jsonb_agg(t) from icash_automation_tickets t'),tickets,'the original consumed ticket remains closed');
  assert.equal(await val('select previous_outcome from icash_recording_private.configuration_recoveries'),'production_agent_review_required');
  assert.equal(await val('select count(*)::int from icash_operation_spend'),0);assert.equal(await val('select balance_cents::int from icash_wallets'),10000);
  assert.equal(await recover(),0,'repeat maintenance cannot rearm the job');
  await q("update icash_voice_jobs set state='held',outcome='production_agent_review_required' where id=$1",[id]);
  assert.equal(await recover(),0,'even a second configuration failure cannot loop');
 });
 for(const mutate of [
  "update icash_voice_jobs set state='dispatching'","update icash_voice_jobs set outcome='provider_outcome_unknown_no_retry'","update icash_voice_jobs set operation_key='previous'","update icash_voice_jobs set provider_call_sid='saved-call'","update icash_voice_jobs set conversation_id='saved-conversation'",
  "insert into icash_operation_spend select 'voice:'||id,'settled' from icash_voice_jobs","insert into icash_call_recordings select id,'voice:'||id from icash_voice_jobs","insert into icash_live_conversations select 'voice:'||id from icash_voice_jobs",
  "update icash_accounts set bot_paused=true","update icash_wallets set balance_cents=0","update icash_voice_configs set enabled=false","update icash_voice_configs set agent_config_hash=repeat('c',64)","update icash_voice_production_template set enabled=false","update icash_operating_budget set enabled=false",
  "update icash_voice_contact_targets set revoked_at=now()","update icash_voice_contact_targets set permission_until=now()-interval '1 second'","update icash_voice_contact_targets set account_id='00000000-0000-4000-8000-000000000002'","update icash_voice_contact_targets set party='buyer'","update icash_voice_contact_targets set eligibility_source='operator_record'",
  "update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"hold\"}}'","update icash_automation_tickets set completed_at=null","update icash_automation_tickets set state='consumed'","update icash_automation_tickets set expires_at=now()+interval '1 minute'",
  "update icash_screening_jobs set snapshot=jsonb_build_object('fetchedAt',now()-interval '25 hours')","update icash_screening_jobs set snapshot='{\"fetchedAt\":\"invalid\"}'","update icash_screening_jobs set snapshot=jsonb_build_object('fetchedAt',now()+interval '1 minute')",
  ...['callback_id','sms_source_message_id','cancellation_notice_id','meta_offer_lead_id','meta_retry_of','meta_followup_lead_id'].map(c=>`update icash_voice_jobs set ${c}=id`),
  ...['membership','channel','operational','hours','spacing','capacity','slot'].map(k=>`update fixture_policy set allowed=false where kind='${k}'`),
 ])await isolated(async()=>{await add(100);await pg.exec(mutate);const before=await val('select jsonb_agg(j) from icash_voice_jobs j');assert.equal(await recover(),0,mutate);assert.deepEqual(await val('select jsonb_agg(j) from icash_voice_jobs j'),before,mutate);});
 await isolated(async()=>{
  await add(100);await q('insert into icash_automation_tickets(id,account_id,voice_job_id) values($1,$2,$3)',[uid(999),account,uid(100)]);
  assert.equal(await recover(),0,'ambiguous/multiple handler history is not retried');
 });
 await isolated(async()=>{
  await add(100,{contact:'same-person'});await add(101,{contact:'same-person'});
  assert.equal(await recover(),1);assert.equal(await recover(),0,'another property/contact route cannot duplicate the queued recipient');
 });
 for(const state of ['ready','issued','dispatching'])await isolated(async()=>{
  await add(100,{contact:'same-person'});await add(101,{contact:'same-person',legacy:true});
  await q('update icash_voice_jobs set state=$1 where id=$2',[state,uid(101)]);
  assert.equal(await recover(),0,'existing queued/active recipients remain excluded across contact sources');
 });
 await isolated(async()=>{
  for(let n=100;n<145;n++){await add(n);if(n<120)await q("update icash_voice_contact_targets set permission_until=now()-interval '1 day' where id=$1",[uid(n)]);}
  assert.equal(await recover(),20,'ineligible older candidates do not consume the batch');assert.equal(await recover(),5);assert.equal(await recover(),0);
 });
 await isolated(async()=>{
  await add(100);
  for(const timestamp of ["now()-interval '3 minutes'","now()+interval '1 minute'","null"]){assert.equal(await val(`select icash_recover_voice_configuration('agent_fixture',$1,$1,$2,${timestamp})`,[hash,'b'.repeat(40)]),0);}
 });
 for(const role of ['anon','authenticated']){
  assert.equal(await val("select has_schema_privilege($1,'icash_recording_private','usage')",[role]),false);
  assert.equal(await val("select has_function_privilege($1,'icash_recover_voice_configuration(text,text,text,text,timestamptz)','execute')",[role]),false);
  assert.equal(await val("select has_table_privilege($1,'icash_recording_private.configuration_recoveries','select')",[role]),false);
 }
 assert.equal(await val("select prosecdef from pg_proc where proname='icash_recover_voice_configuration'"),false);
 assert.equal(sql,read('supabase/migrations/20261030183441_unstarted_voice_configuration_recovery.sql'));
 assert.equal(accessSql,read('supabase/migrations/20261030191436_voice_configuration_recovery_schema_access.sql'));
 assert.equal(boundedSql,read('supabase/migrations/20261030192149_bounded_voice_configuration_recovery.sql'));

 const original=JSON.parse(read('tests/fixtures/voice-configuration-target-lookup-before.json'));
 const signature='public.icash_recover_voice_configuration(text,text,text,text,timestamptz)';
 const optimized=await val('select pg_get_functiondef($1::regprocedure)',[signature]);
 const oldJoin=lookupSql.split('$old$')[1],newJoin=lookupSql.split('$new$')[1];
 assert.equal(createHash('md5').update(original.definition).digest('hex'),'c4787929d87e8562fb556bfb7e34e8f0');
 assert.equal(optimized,original.definition.replace(oldJoin,newJoin),'only the exact target join changes; locks/order/gates and function metadata remain');
 const versions=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(p=>p.endsWith('_voice_configuration_recovery_target_lookup.sql'));
 assert.equal(versions.length,1);assert.equal(lookupSql,read('supabase/migrations/'+versions[0]));
 await q('begin');
 await assert.rejects(pg.exec(lookupSql),/prerequisite changed/);await q('rollback');
 // The same real function now executes over the production UNION ALL view,
 // including overlapping source IDs, missing/changed targets and several accounts.
 await pg.exec(read('tests/fixtures/voice-configuration-target-lookup-union.sql'));
 await pg.exec('create view public.icash_voice_contact_targets as '+original.target_view);
 await q('select fixture_configuration_seed(a,n,n%2=0) from generate_series(11,14) a cross join generate_series(1,12) n');
 for(let a=11;a<=14;a++){
  await q('update icash_operational_contacts set account_id=fixture_configuration_id($1+1,0) where id=fixture_configuration_id($1,3)',[a]);
  await q('update icash_voice_jobs set operational_contact_id=permission_id,permission_id=null where id=fixture_configuration_id($1,4)',[a]);
  await q('delete from icash_operational_contacts where id=fixture_configuration_id($1,5)',[a]);
  await q("update icash_contact_permissions set permission_until=now()-interval '1 second' where id=fixture_configuration_id($1,6)",[a]);
  await q('update icash_operational_contacts set revoked_at=now() where id=fixture_configuration_id($1,7)',[a]);
  await q('update icash_contact_permissions set permission_until=null where id=fixture_configuration_id($1,8)',[a]);
  await q("insert into icash_contact_permissions(id,account_id,screening_id,contact_key) values(fixture_configuration_id($1,9),fixture_configuration_id($1,0),fixture_configuration_id($1,1),'wrong-source-contact')",[a]);
  await q("update icash_voice_jobs set state='ready' where id=fixture_configuration_id($1,10)",[a]);
  await q('insert into icash_automation_tickets(id,voice_job_id,account_id) values(fixture_configuration_id($1,111),fixture_configuration_id($1,11),fixture_configuration_id($1,0))',[a]);
  await q('update icash_voice_jobs set operational_contact_id=permission_id where id=fixture_configuration_id($1,12)',[a]);
 }
 const candidate=definition=>definition.slice(definition.indexOf('  with busy_contacts'),definition.indexOf('\n loop\n'))
  .replaceAll('p_config_hash',"repeat('a',64)").replaceAll('p_agent',"'agent_fixture'")
  .replaceAll('p_checked_at','now()').replaceAll(/\bchecked\b/g,'now()').replace(' for update of v skip locked','');
 const beforeRows=(await q(candidate(original.definition))).rows,afterRows=(await q(candidate(optimized))).rows;
 assert.deepEqual(afterRows,beforeRows,'complete ordered candidate rows preserve multiplicity and account/source binding');
 assert.equal(afterRows.length,12);
 const state=()=>val(`select jsonb_build_object(
  'jobs',(select jsonb_agg(case when state='ready' then to_jsonb(j)-'updated_at' else to_jsonb(j) end order by id) from icash_voice_jobs j),
  'audit',(select jsonb_agg(to_jsonb(r)-'recovered_at'-'provider_checked_at' order by job_id) from icash_recording_private.configuration_recoveries r),
  'tickets',(select jsonb_agg(to_jsonb(t) order by id) from icash_automation_tickets t),
  'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),
  'operations',(select jsonb_agg(to_jsonb(o)) from icash_operation_spend o))`);
 let baseline;
 await isolated(async()=>{await pg.exec(original.definition);assert.equal(await recover(),12);assert.equal(await recover(),0);baseline=await state();});
 await isolated(async()=>{assert.equal(await recover(),12);assert.equal(await recover(),0);assert.deepEqual(await state(),baseline,'actual updates/audit/original tickets, balances and operation holds match');});
 const beforeMetadata=await val(`select jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security_definer',prosecdef,'volatility',provolatile,'config',proconfig) from pg_proc where oid=$1::regprocedure`,[signature]);
 await pg.exec(original.definition);await pg.exec(lookupSql);
 assert.deepEqual(await val(`select jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security_definer',prosecdef,'volatility',provolatile,'config',proconfig) from pg_proc where oid=$1::regprocedure`,[signature]),beforeMetadata);
 console.log('Configuration target lookup: actual UNION ALL, 4 accounts, 48 jobs, 52 tickets, overlapping IDs/source and missing/expired/revoked targets; exact candidates and real recovery writes match. Offline only.');
 console.log('Unstarted voice recovery: provider rejection only; original tickets, unknown operations, wallet, recipient controls, duplicate protection and private audit verified. Offline only.');
}finally{await pg.close();}
