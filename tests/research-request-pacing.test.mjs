import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installReservePrerequisites} from '../scripts/test-new-user-request-reserve-pglite.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const state=()=>v('select icash_research_private.request_reserve_state()');
const take=(kind='owner_preview',account=null,op='fixture')=>v('select icash_take_dealmachine_request($1,$2,$3,gen_random_uuid())',[kind,account,op]);
const claim=()=>v('select icash_claim_research_exclusions()');
const seed=n=>v('select fixture_reserve_seed($1,interval \'1 hour\')',[n]);
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
try{
 await installReservePrerequisites(pg);
 await pg.exec(read('config/new-user-request-reserve.sql'));
 await pg.exec(read('tests/fixtures/new-user-request-reserve-exclusions-foundation.sql'));
 await pg.exec(`alter table icash_research_private.settings add column exclusion_sync_enabled boolean default false;
 create table icash_research_private.financial_settings(id int primary key,enabled boolean);
 insert into icash_research_private.financial_settings values(1,true);
 create table icash_research_private.request_reserve_exclusion_claims(token uuid primary key,account_id uuid,list_id text,created_at timestamptz default clock_timestamp());`);
 for(const f of JSON.parse(read('tests/fixtures/request-budget-pacing-before.json')))await pg.exec(f.definition);
 const before=await v('select to_jsonb(b) from icash_dealmachine_request_budget b');
 await pg.exec('begin;'+read('config/research-request-pacing.sql')+'commit;');
 assert.deepEqual(await v('select to_jsonb(b) from icash_dealmachine_request_budget b'),before);
 await isolated(async()=>{
  await pg.exec(read('config/activate-research-request-pacing.sql').replace('begin;','').replace('commit;',''));
  assert.equal((await state()).pacingActive,false,'activation never changes current window');
  assert.equal(await v("select activate_after=b.day_start+interval '24 hours' from icash_research_private.request_pacing_policy p cross join icash_dealmachine_request_budget b"),true);
  assert.deepEqual(await v('select to_jsonb(b) from icash_dealmachine_request_budget b'),before);
 });
 const a=await seed(1);
 await pg.exec(`update icash_research_private.request_reserve_policy set enabled=true;
 update icash_dealmachine_request_budget set day_used=8820,minute_used=0;
 update icash_research_private.request_pacing_policy set enabled=true,activate_after=clock_timestamp()+interval '1 hour';`);
 assert.equal((await state()).pacingActive,false);
 assert.equal((await state()).maintenanceRemaining,0,'no retroactive capacity');
 assert.equal(await claim(),null);
 assert.equal(await take('owner_preview',a),true,'original starter preserved');
 // Activate only the next window, never reset by installation.
 await pg.exec(`update icash_research_private.request_pacing_policy set activate_after=clock_timestamp()-interval '1 hour';
 update icash_dealmachine_request_budget set day_start=clock_timestamp()-interval '25 hours',minute_start=now()-interval '2 minutes';`);
 const projected=await state();assert.equal(projected.pacingActive,true);assert.equal(projected.maintenanceRemaining,196);
 assert.equal(projected.ordinaryRemaining,359,'one-hour bounded burst over 8624 ordinary/day');
 assert.equal(await take(),true);
 assert.equal(await v('select day_used from icash_dealmachine_request_budget'),1);
 await pg.exec('update icash_dealmachine_request_budget set day_used=359,minute_used=0');
 assert.equal(await take(),false,'ordinary burst cannot drain the day');
 const monitoring=await v('select icash_research_quota_status()');assert.equal(monitoring.status,'paced_wait');assert.ok(Date.parse(monitoring.nextAvailableAt)<Date.parse(monitoring.dayResetsAt));
 assert.equal(await v('select icash_take_dealmachine_request()'),false,'legacy cannot bypass');
 assert.equal(await v('select icash_dealmachine_capacity_available(1)'),false);
 assert.equal(await take('owner_preview',a),true,'starter is independent of pacing');
 assert.equal(await take('exclusion_sync',null,'invented'),false);
 const c=await claim();assert.equal(c.action,'sync');
 await q('insert into icash_research_private.targeting_acquired_properties(property_id) values($1)',[c.ids[0]]);
 const op='maintenance-exclusion:'+c.token;
 for(const mutation of [
  `update icash_research_private.exclusions set lease_until=now()-interval '1 second'`,
  `update icash_research_private.exclusions set state='unknown'`,
  `update icash_research_private.exclusions set batch='{}'`,
  `update icash_research_private.settings set enabled=false`,
  `update icash_research_private.quota_feedback set blocked_until=now()+interval '1 hour'`,
  `update icash_dealmachine_request_budget set minute_used=60`
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await take('exclusion_sync',null,op),false,mutation);});
 assert.equal(await take('owner_preview',null,op),false,'wrong kind');
 assert.equal(await take('exclusion_sync',a,op),false,'account cannot borrow maintenance');
 assert.equal(await take('exclusion_sync',null,op),true);
 assert.equal((await state()).maintenanceUsed,1);
 assert.equal((await state()).maintenanceRemaining,195);
 assert.equal(await take('exclusion_sync',null,op),false,'one use token');
 await isolated(async()=>{await pg.exec('update icash_dealmachine_request_budget set day_used=0');assert.equal(await take('exclusion_sync',null,op),false,'ordinary capacity cannot replay token');});
 assert.equal(await v('select icash_finish_research_exclusions($1,$2)',[c.token,{ok:true,listId:'wrong',ids:c.ids}]),false);
 assert.equal(await v('select count(*)::int from icash_research_private.targeting_acquired_properties where synced_at is null'),1);
 assert.equal(await v('select icash_finish_research_exclusions($1,$2)',[c.token,{ok:true,listId:c.listId,ids:c.ids,added:1}]),true);
 assert.equal(await v('select count(*)::int from icash_research_private.exclusion_items where synced_at is null'),0);
 assert.equal(await v('select count(*)::int from icash_research_private.targeting_acquired_properties where synced_at is null'),0);
 await assert.rejects(pg.exec('delete from icash_research_private.maintenance_request_admissions'),/immutable/);
 await pg.exec("delete from icash_research_private.requests where operation_key like 'maintenance-exclusion:%'");
 assert.equal(await take('exclusion_sync',null,op),false,'pruning cannot erase one-use token');
 await isolated(async()=>{
  await pg.exec(`update icash_research_private.settings set exclusions_enabled=false,exclusion_sync_enabled=true;
   update icash_research_private.exclusions set next_at=now()-interval '1 minute';
   insert into icash_research_private.exclusion_items values('prop_2',null);`);
  const c=await claim();assert.equal(c.action,'sync','existing-list sync-only works');
  assert.equal(await take('exclusion_sync',null,'maintenance-exclusion:'+c.token),true);
 });
 for(const mutation of ["update icash_research_private.exclusions set list_id=null,state='new'", "update icash_research_private.exclusions set list_id=null,state='unknown'"])
  await isolated(async()=>{await pg.exec(mutation+";update icash_research_private.exclusions set next_at=now()-interval '1 minute'");assert.equal(await claim(),null,'reserve cannot create or recover');});
 await isolated(async()=>{
  await pg.exec(`update icash_dealmachine_request_budget set day_start=now()-interval '12 hours',day_used=4671,minute_used=0;
   update icash_research_private.request_pacing_policy set activate_after=now()-interval '13 hours';`);
  assert.equal((await state()).ordinaryRemaining,0);
  await pg.exec('update icash_dealmachine_request_budget set day_used=4670');
  assert.equal(await take(),true,'allowance grows with time without a manual reset');
 });
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'icash_research_private.maintenance_exclusion_allowed(text,timestamptz)','execute')",[role]),false);
  assert.equal(await v("select has_table_privilege($1,'icash_research_private.request_pacing_policy','select')",[role]),false);
 }
 if(process.env.PACING_PRINT_HASHES)console.log(JSON.stringify((await q("select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='icash_research_private' and p.proname in ('request_reserve_state','take_reserved_request','maintenance_exclusion_allowed','maintenance_capacity_available')) or (n.nspname='public' and p.proname in ('icash_claim_research_exclusions','icash_research_quota_status'))")).rows));
 console.log('PASS request pacing and maintenance: next-window activation, hard limits, starter independence, bound sync, receipt completion, immutable one-use and ACLs');
}finally{await pg.close();}
