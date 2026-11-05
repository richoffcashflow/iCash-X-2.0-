// Actual saved recovery and capacity helpers; disposable local DB, no providers.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const definitions=JSON.parse(read('tests/fixtures/voice-recovery-capacity-before.json'));
const original=definitions.find(d=>d.proname==='icash_recover_voice_configuration').definition;
const patch=read('config/voice-recovery-capacity-snapshot.sql');
const signature='public.icash_recover_voice_configuration(text,text,text,text,timestamptz)';
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const recover=()=>v("select public.icash_recover_voice_configuration('agent_fixture',repeat('a',64),repeat('a',64),repeat('b',40),clock_timestamp())");
let isolationDepth=0;
const isolated=async fn=>{
 const depth=isolationDepth++,name='fixture_savepoint_'+depth;
 await pg.exec(depth?'savepoint '+name:'begin');
 try{return await fn();}finally{await pg.exec(depth?'rollback to '+name+';release '+name:'rollback');isolationDepth--;}
};
const evidence=()=>v(`select jsonb_build_object(
 'jobs',(select jsonb_agg(case when state='ready' then to_jsonb(j)-'updated_at' else to_jsonb(j) end order by id) from icash_voice_jobs j),
 'audit',(select jsonb_agg(to_jsonb(r)-'recovered_at'-'provider_checked_at' order by job_id) from icash_recording_private.configuration_recoveries r),
 'tickets',(select jsonb_agg(to_jsonb(t) order by id) from icash_automation_tickets t),
 'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),
 'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o))`);
const metadata=()=>v(`select jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security_definer',prosecdef,'volatility',provolatile,'config',proconfig) from pg_proc where oid=$1::regprocedure`,[signature]);
try{
 await pg.exec(read('tests/fixtures/voice-configuration-recovery-foundation.sql'));
 await pg.exec(read('tests/fixtures/voice-configuration-target-lookup-union.sql'));
 await pg.exec('create view public.icash_voice_contact_targets as '+JSON.parse(read('tests/fixtures/voice-configuration-target-lookup-before.json')).target_view);
 await pg.exec(read('config/unstarted-voice-configuration-recovery.sql'));
 await pg.exec(read('config/voice-configuration-recovery-schema-access.sql'));
 await pg.exec(read('tests/fixtures/voice-recovery-capacity-setup.sql'));
 for(const name of ['voice_capacity_from_snapshot','voice_capacity_snapshot','icash_voice_capacity_available','voice_queue_slot_from_snapshot','icash_voice_queue_slot_open','icash_recover_voice_configuration']){
  const d=definitions.find(d=>d.proname===name);await pg.exec(d.definition);
  assert.equal(await v('select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[d.nspname,name]),d.hash);
 }
 await pg.exec(`insert into icash_voice_production_template(id,agent_config_hash) values(1,repeat('a',64));
  grant usage on schema public,icash_recording_private to service_role;
  grant select on all tables in schema public,icash_recording_private to service_role;
  grant update on icash_operating_budget,icash_voice_jobs to service_role;
  grant usage,select on all sequences in schema public to service_role;
  revoke all on all functions in schema icash_recording_private from public,anon,authenticated;
  grant execute on all functions in schema icash_recording_private to service_role;
  select fixture_configuration_seed(a,n,n%2=0) from generate_series(1,3) a cross join generate_series(1,15) n;`);
 const before=await evidence(),beforeMetadata=await metadata();
 const run=async()=>isolated(async()=>{
  await q("select setval('fixture_capacity_scans',1,false)");await q('set local role service_role');
  const counts=[await recover(),await recover(),await recover(),await recover()];
  return {counts,scans:await v('select last_value::int from fixture_capacity_scans'),state:await evidence()};
 });
 const baseline=await run();assert.deepEqual(baseline.counts,[20,20,5,0]);
 await pg.exec(patch);
 assert.deepEqual(await metadata(),beforeMetadata);assert.deepEqual(await evidence(),before);
 const optimized=await v('select pg_get_functiondef($1::regprocedure)',[signature]);
 const pairs=[...patch.matchAll(/\(\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$\)/g)];
 assert.equal(pairs.length,4);assert.equal(optimized,pairs.reduce((d,[,a,b])=>d.replace(a,b),original));
 const after=await run();assert.deepEqual(after.counts,baseline.counts);assert.deepEqual(after.state,baseline.state);
 assert(baseline.scans>=90);assert.equal(after.scans,4,'one snapshot for each whole recovery invocation, including no-candidate scans');
 const mutations=[
  "update icash_accounts set bot_paused=true", "update icash_wallets set reserved_cents=balance_cents",
  "update icash_voice_configs set enabled=false", "update icash_voice_configs set agent_config_hash=repeat('c',64)",
  "update icash_voice_production_template set enabled=false", "update icash_operating_budget set enabled=false",
  "update icash_screening_jobs set snapshot=jsonb_build_object('fetchedAt',now()-interval '25 hours')",
  "update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"hold\"}}'",
  "update icash_voice_jobs set operation_key='old'", "update icash_voice_jobs set provider_call_sid='CA-original'",
  "update icash_voice_jobs set conversation_id='original'", "update icash_voice_jobs set outcome='provider_outcome_unknown_no_retry'",
  "insert into icash_operation_spend select 'voice:'||id,'dispatched' from icash_voice_jobs",
  "insert into icash_call_recordings(voice_job_id,operation_key) select id,'voice:'||id from icash_voice_jobs",
  "insert into icash_live_conversations(operation_key) select 'voice:'||id from icash_voice_jobs",
  "update icash_automation_tickets set completed_at=null", "update icash_automation_tickets set expires_at=now()+interval '1 minute'",
  "update icash_operational_contacts set revoked_at=now();update icash_contact_permissions set revoked_at=now()",
  "update icash_operational_contacts set eligibility_until=now();update icash_contact_permissions set permission_until=now()",
  ...['membership','channel','operational','permission','hours','spacing','capacity'].map(k=>`update fixture_policy set allowed=false where kind='${k}'`),
  "update icash_voice_capacity_policy set credit_state='exhausted'",
  "insert into fixture_holds select 'busy-'||n,fixture_configuration_id(99,0),'agent_fixture','busy-'||n from generate_series(1,18) n",
  "insert into fixture_holds select 'busy-'||a||'-'||n,fixture_configuration_id(a,0),'agent_other','busy-'||a||'-'||n from generate_series(1,3) a cross join generate_series(1,3) n",
  "insert into fixture_holds select 'busy-'||contact_key,account_id,'agent_other',contact_key from icash_voice_contact_targets",
  "insert into icash_live_conversations(operation_key,state,contact_key) select 'live-'||id,'waiting',contact_key from icash_voice_contact_targets",
  "update icash_voice_jobs set callback_id=id", "update icash_voice_jobs set sms_source_message_id=id",
  "update icash_voice_jobs set meta_offer_lead_id=id",
 ];
 for(const mutation of mutations)await isolated(async()=>{
  await pg.exec(mutation);const unchanged=await evidence();
  let old;await isolated(async()=>{await pg.exec(original);old={count:await recover(),state:await evidence()};});
  assert.equal(await recover(),old.count,mutation);assert.deepEqual(await evidence(),old.state,mutation);
  if(old.count===0)assert.deepEqual(await evidence(),unchanged,mutation+' preserves original evidence');
 });
 await isolated(async()=>{
  await pg.exec("update icash_operational_contacts set contact_key='same-person';update icash_contact_permissions set contact_key='same-person'");
  assert.equal(await recover(),1);assert.equal(await recover(),0);
 });
 // Same-call queue selection may use a snapshot; final paid admission may not.
 await isolated(async()=>{
  const a=await v('select fixture_configuration_id(1,0)'),snapshot=await v('select icash_recording_private.voice_capacity_snapshot()');
  await q("insert into fixture_holds values('late-incoming',$1,'agent_fixture','late-person')",[a]);
  assert.equal(await v("select icash_recording_private.voice_capacity_from_snapshot($1,'agent_fixture','new','late-person',false,$2)",[a,snapshot]),true);
  assert.equal(await v("select icash_voice_capacity_available($1,'agent_fixture','new','late-person',false)",[a]),false);
 });
 await isolated(async()=>{
  const id=await v('select fixture_configuration_id(1,1)'),a=await v('select fixture_configuration_id(1,0)');
  await q("insert into fixture_holds values('unknown',$1,'agent_fixture',$2)",[a,id]);
  await q("insert into icash_recording_private.capacity_quarantines values('unknown',$1,$2::uuid,$2::uuid::text)",[a,id]);
  const snapshot=await v('select icash_recording_private.voice_capacity_snapshot()');
  assert.equal(snapshot.slots.length,0);assert.equal(snapshot.holds.length,1);
  assert.equal(await v("select icash_voice_capacity_available($1,'agent_fixture','new',$2,false)",[a,id]),false,'quarantine frees capacity, never recipient authority');
  await q("insert into icash_call_recordings(operation_key,call_sid) values('unknown','CA-late')");
  assert.equal((await v('select icash_recording_private.voice_capacity_snapshot()')).slots.length,1,'late provider identity restores occupied capacity');
 });
 for(const d of definitions.filter(d=>d.proname!=='icash_recover_voice_configuration')){
  assert.equal(await v('select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2',[d.nspname,d.proname]),d.hash,'fresh helpers never changed');
 }
 for(const role of ['anon','authenticated'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 await q('begin');await assert.rejects(pg.exec(patch),/prerequisite changed/);await q('rollback');
 await q('begin');await pg.exec(original);
 await pg.exec('alter function icash_recording_private.voice_capacity_snapshot() immutable');
 await assert.rejects(pg.exec(patch),/prerequisite changed/);await q('rollback');
 const migrations=readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(p=>p.endsWith('_voice_recovery_capacity_snapshot.sql'));
 assert.equal(migrations.length,1);assert.equal(read('supabase/migrations/'+migrations[0]),patch);
 console.log(`Voice recovery capacity: ${baseline.scans} -> ${after.scans} snapshots for 45 jobs/3 accounts; exact updates, original money/tickets, ${mutations.length} eligibility/hold cases, fresh final capacity and private ACL passed. No providers.`);
}finally{await pg.close();}
