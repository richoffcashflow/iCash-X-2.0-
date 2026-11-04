import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const seed=(n,contacts=true,overdue='12 minutes')=>one('select fixture_export_wait_seed($1,$2,$3::interval)',[n,contacts,overdue]);
const claim=()=>one('select icash_next_acquisition()');
const isolated=async f=>{await pg.exec('begin');try{await f();}finally{await pg.exec('rollback');}};
const evidence=()=>one(`select jsonb_build_object('spend',(select jsonb_agg(to_jsonb(o)) from icash_operation_spend o),
 'reservations',(select jsonb_agg(to_jsonb(r)) from icash_credit_reservations r),'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w))`);
try{
 await pg.exec(read('tests/fixtures/export-capacity-wait-foundation.sql'));
 await pg.exec(JSON.parse(read('tests/fixtures/export-capacity-wait-before.json'))['public.icash_next_acquisition()']);
 await pg.exec('revoke all on function icash_next_acquisition() from public;grant execute on function icash_next_acquisition() to service_role;');
 const blocked=[];for(let n=1;n<=8;n++)blocked.push(await seed(n));
 const discovery=await seed(9,false,'10 minutes');
 await pg.exec("update fixture_export_wait_policy set export_capacity='export_busy'");
 const initialDue=(await q('select account_id,next_run_at::text due from icash_discovery_configs')).rows;
 const metadata=await one("select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig) from pg_proc where oid='icash_next_acquisition()'::regprocedure");
 await isolated(async()=>{
  assert.equal(await claim(),null);
  assert.equal(await one("select count(*)::int from icash_discovery_configs where contacts_enabled and next_run_at>now()"),5,'Reproduce the existing busy scan erasing aging without issuing work');
 });
 const migration=read('config/export-capacity-wait-fairness.sql');
 await pg.exec(migration);
 assert.deepEqual(await one("select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig) from pg_proc where oid='icash_next_acquisition()'::regprocedure"),metadata);
 const before=await evidence();
 assert.equal(await claim(),null);
 assert.equal(await one('select count(*)::int from fixture_scan_reads'),5);
 assert.equal(await one('select count(*)::int from fixture_candidate_reads'),5,'No full-candidate calls before LIMIT 5');
 assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits'),5);
 const firstDiscovery=await claim();assert(firstDiscovery?.token);
 assert.equal(await one('select account_id from icash_automation_tickets where token=$1',[firstDiscovery.token]),discovery.account,'Discovery beyond five busy contact accounts keeps progressing');
 assert.equal(await one('select count(*)::int from fixture_candidate_reads'),8);
 const saved=await one('select jsonb_object_agg(account_id,waiting_since::text) from icash_work_private.acquisition_export_waits');
 assert.deepEqual(saved,Object.fromEntries(initialDue.filter(x=>x.account_id!==discovery.account).map(x=>[x.account_id,x.due])),'Only the original saved due time is preserved; no historical age is fabricated');
 for(let tick=0;tick<4;tick++){
  // Advance only the synthetic polling clock; original due age must survive.
  await pg.exec("update icash_discovery_configs set next_run_at=now()-interval '1 second' where contacts_enabled;truncate fixture_candidate_reads,fixture_scan_reads;");
  assert.equal(await claim(),null);
  assert.equal(await one('select count(*)::int from fixture_scan_reads'),5);
  assert.equal(await one('select count(*)::int from fixture_candidate_reads'),5);
  assert.equal(await one("select count(*)::int from icash_discovery_configs where contacts_enabled and next_run_at between now()+interval '59 seconds' and now()+interval '60 seconds'"),5);
  assert.deepEqual(await one('select jsonb_object_agg(account_id,waiting_since::text) from icash_work_private.acquisition_export_waits'),saved);
 }
 assert.deepEqual(await evidence(),before,'Waiting cannot settle unknown operations, release reservations or charge wallets');
 const priority=await seed(10,true,'2 minutes');
 await q("update fixture_export_wait_accounts set preflight_due=now()-interval '7 minutes' where account_id=$1",[priority.account]);
 await pg.exec("update fixture_export_wait_policy set export_capacity='ready';update icash_discovery_configs set next_run_at=now()-interval '1 second' where contacts_enabled;");
 const served=[];
 for(let n=0;n<8;n++){
  const ticket=await claim();assert(ticket?.token);
  const account=await one('select account_id from icash_automation_tickets where token=$1',[ticket.token]);
  assert.notEqual(account,priority.account,'Preserved ordinary-account aging wins before a newer due preflight');
  assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits where account_id=$1',[account]),0,'Actual issue clears only its own wait marker');served.push(account);
 }
 assert.deepEqual(new Set(served),new Set(blocked.map(x=>x.account)));
 const next=await claim();assert.equal(await one('select account_id from icash_automation_tickets where token=$1',[next.token]),priority.account);
 assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits'),0);
 await isolated(async()=>{
  const c=await seed(20);await pg.exec("update fixture_export_wait_policy set export_capacity='export_busy'");
  await claim();assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits where account_id=$1',[c.account]),1);
  await q("update icash_discovery_configs set next_run_at=now()-interval '1 second' where account_id=$1",[c.account]);
  await q('update fixture_export_wait_accounts set eligible=false where account_id=$1',[c.account]);
  await claim();assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits where account_id=$1',[c.account]),0,'Confirmed unrelated ineligibility clears the wait');
 });
 for(const change of ["update icash_accounts set bot_paused=true",'update icash_operating_budget set enabled=false','update fixture_export_wait_policy set quota=false',
  'update icash_wallets set reserved_cents=balance_cents','update icash_discovery_configs set auto_enabled=false',"update icash_discovery_configs set data_rights_until=now()-interval '1 second'"]){
  await isolated(async()=>{await seed(30);await pg.exec("update fixture_export_wait_policy set export_capacity='export_busy'");await pg.exec(change);assert.equal(await claim(),null,change);assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits'),0,change);});
 }
 await isolated(async()=>{
  const c=await seed(31);await pg.exec("update fixture_export_wait_policy set export_capacity='export_busy';alter table fixture_export_wait_policy alter column export_capacity drop not null;update fixture_export_wait_policy set export_capacity=null;");
  assert.equal(await one('select icash_work_private.record_export_wait($1,now()-interval \'1 minute\')',[c.account]),false,'Unknown capacity is not exact busy');
  assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits'),0);
 });
 await isolated(async()=>{
  const c=await seed(32);await pg.exec("update fixture_export_wait_policy set export_capacity='export_busy'");
  for(const stamp of ["now()-interval '1 day'","now()+interval '1 day'"]){
   assert.equal(await one(`select icash_work_private.record_export_wait($1,${stamp})`,[c.account]),false,'Only the exact saved due time may initialize waiting age');
  }
  assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits'),0);
 });
 await isolated(async()=>{
  const c=await seed(40);
  await pg.exec(`create or replace function public.icash_enrichment_candidate(uuid) returns uuid language plpgsql as $$begin update public.fixture_export_wait_policy set export_capacity='export_busy';return null;end$$;`);
  assert.equal(await claim(),null);
  assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits where account_id=$1',[c.account]),1,'Capacity won by a concurrent account after selection still preserves age');
 });
 await isolated(async()=>{
  await seed(50);await pg.exec("update fixture_export_wait_policy set export_capacity='export_busy'");
  await pg.exec(`create or replace function public.icash_enrichment_before_provider_quota(uuid) returns uuid language plpgsql as $$begin raise exception 'synthetic transient candidate failure';end$$;`);
  await pg.exec('savepoint candidate_error');await assert.rejects(claim(),/synthetic transient candidate failure/);await pg.exec('rollback to candidate_error');
  assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits'),0,'Errors do not create or clear durable scheduling evidence');
 });
 for(const role of ['anon','authenticated']){
  assert.equal(await one("select has_function_privilege($1,'icash_work_private.record_export_wait(uuid,timestamptz)','execute')",[role]),false);
  assert.equal(await one("select has_table_privilege($1,'icash_work_private.acquisition_export_waits','select')",[role]),false);
 }
 assert.equal(await one("select relrowsecurity from pg_class where oid='icash_work_private.acquisition_export_waits'::regclass"),true);
 await isolated(async()=>{await seed(60);await pg.exec("update fixture_export_wait_policy set export_capacity='export_busy';set role service_role");assert.equal(await claim(),null);await pg.exec('reset role');assert.equal(await one('select count(*)::int from icash_work_private.acquisition_export_waits'),1);});
 const files=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(x=>x.endsWith('_export_capacity_wait_fairness.sql'));assert.equal(files.length,1);assert.equal(read('supabase/migrations/'+files[0]),migration);
 await assert.rejects(pg.exec(migration),/prerequisite changed/);await pg.exec('rollback');
 console.log('PASS export wait fairness: repeated busy ticks retain original age and 60s cooldown; five-row candidate bound; discovery progress; ready-account aging; capacity race; original gates, finance evidence, metadata and private ACLs. Offline synthetic dependencies, exact production issuer.');
}finally{await pg.close();}
