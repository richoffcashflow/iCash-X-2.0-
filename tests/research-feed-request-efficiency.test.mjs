import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installReservePrerequisites} from '../scripts/test-new-user-request-reserve-pglite.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('config/research-feed-request-efficiency.sql');
assert.equal(migration,read('supabase/migrations/20261112194430_research_feed_request_efficiency.sql'));

// Reproduce production: ordinary allowance exhausted, the legacy query switch
// off, financial queries on, and no legacy list on a new account's config.
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const claim=a=>v('select icash_claim_starter_research_exclusions($1)',[a]);
const take=(a,token)=>v("select icash_take_dealmachine_request('exclusion_sync',$1,$2,gen_random_uuid())",[a,'starter-exclusion:'+token]);
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
try{
 await installReservePrerequisites(pg);
 await pg.exec(read('config/new-user-request-reserve.sql'));
 await pg.exec(read('tests/fixtures/new-user-request-reserve-exclusions-foundation.sql'));
 await pg.exec(`alter table icash_research_private.settings add column exclusion_sync_enabled boolean default true;
  create table icash_research_private.financial_settings(id int primary key,enabled boolean);
  insert into icash_research_private.financial_settings values(1,true);
  create table icash_research_private.targeting_query_settings(id int primary key,enabled boolean,list_id text);
  insert into icash_research_private.targeting_query_settings values(1,true,'fixture-list');
  create table icash_research_private.request_reserve_exclusion_claims(token uuid primary key,account_id uuid,list_id text,created_at timestamptz default clock_timestamp());`);
 for(const f of JSON.parse(read('tests/fixtures/request-budget-pacing-before.json')))await pg.exec(f.definition);
 await pg.exec(read('config/research-request-pacing.sql'));
 const a=await v("select fixture_reserve_seed(1,interval '1 hour')"),b=await v("select fixture_reserve_seed(2,interval '1 hour')"),old=await v("select fixture_reserve_seed(3,interval '25 hours')");
 await q('insert into icash_discovery_configs(account_id,research_list_id) values($1,null),($2,null),($3,null)',[a,b,old]);
 await pg.exec(`update icash_research_private.settings set exclusions_enabled=false;
  update icash_research_private.request_reserve_policy set enabled=true;
  update icash_dealmachine_request_budget set day_used=8820,minute_used=0;
  update icash_research_private.request_pacing_policy set enabled=true,activate_after=now()+interval '1 hour';
  insert into icash_research_private.targeting_acquired_properties values('prop_2',null);`);
 assert.equal(await claim(a),null,'Original startup dependency rejects the real financial-query configuration');
 const budget=await v('select to_jsonb(b) from icash_dealmachine_request_budget b');
 await pg.exec(migration);
 assert.deepEqual(await v('select to_jsonb(b) from icash_dealmachine_request_budget b'),budget,'Install never alters request counters or limits');
 assert.equal(await v('select icash_claim_research_exclusions()'),null,'Accountless maintenance still cannot borrow starter capacity');
 assert.equal(await claim(old),null,'Older accounts do not become starter accounts');
 for(const mutation of [
  'update icash_research_private.settings set exclusion_sync_enabled=false',
  'update icash_research_private.financial_settings set enabled=false',
  'update icash_research_private.targeting_query_settings set enabled=false',
  "update icash_research_private.targeting_query_settings set list_id='wrong-list'",
  "update icash_research_private.exclusions set state='unknown'",
  "update icash_research_private.exclusions set list_id=null,state='new'",
  'update icash_discovery_configs set enabled=false',
  'update icash_discovery_configs set auto_enabled=false',
  'update icash_discovery_configs set exhausted=true',
  "update icash_discovery_configs set data_rights_until=now()-interval '1 second'",
  'update icash_accounts set bot_paused=true',
  'update icash_wallets set reserved_cents=balance_cents'
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await claim(a),null,mutation);});
 const c=await claim(a);assert.equal(c.action,'sync');assert.equal(c.accountId,a);assert.deepEqual(c.ids,['prop_1','prop_2'],'Include financial acquisitions even when legacy experiments are disabled');
 assert.equal(await claim(b),null,'One original shared list lease');
 assert.equal(await take(b,c.token),false,'One account cannot reuse another starter token');
 for(const mutation of [
  'update icash_research_private.settings set exclusion_sync_enabled=false',
  'update icash_research_private.financial_settings set enabled=false',
  'update icash_research_private.targeting_query_settings set enabled=false',
  "update icash_research_private.targeting_query_settings set list_id='changed-list'",
  'update icash_accounts set bot_paused=true',
  "update icash_research_private.exclusions set lease_until=now()-interval '1 second'",
  "update icash_research_private.quota_feedback set blocked_until=now()+interval '1 hour'",
  'update icash_dealmachine_request_budget set minute_used=60'
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await take(a,c.token),false,'Final admission rechecks '+mutation);});
 assert.equal(await take(a,c.token),true);assert.equal(await take(a,c.token),false,'Original lease remains one-use');
 assert.equal(await v('select day_used from icash_dealmachine_request_budget'),8821);
 assert.equal(await v('select count(*)::int from icash_research_private.request_reserve_admissions'),1);
 assert.equal(await v('select icash_finish_research_exclusions($1,$2)',[c.token,{ok:true,listId:'wrong',ids:c.ids,added:2}]),false);
 assert.equal(await v('select count(*)::int from icash_research_private.exclusion_items where synced_at is null'),1);
 assert.equal(await v('select icash_finish_research_exclusions($1,$2)',[c.token,{ok:true,listId:c.listId,ids:c.ids,added:2}]),true);
 assert.equal(await v('select count(*)::int from icash_research_private.exclusion_items where synced_at is null'),0);
 assert.equal(await v('select count(*)::int from icash_research_private.targeting_acquired_properties where synced_at is null'),0);
 assert.equal(await v('select exclusions_enabled from icash_research_private.settings'),false,'No legacy search activation');
 assert.equal(await v('select count(*)::int from icash_discovery_configs where research_list_id is not null'),0,'No account configuration rewrite');
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'icash_research_private.starter_exclusion_list_current(uuid,text)','execute')",[role]),false);
  assert.equal(await v("select has_function_privilege($1,'public.icash_pending_owner_preflight(uuid,uuid,jsonb,boolean)','execute')",[role]),role==='service_role');
 }
}finally{await pg.close();}

// The pending read uses the actual cohort predicates, not a synthetic cache.
const owners=await PGlite.create(),oq=(s,a=[])=>owners.query(s,a),ov=async(s,a=[])=>Object.values((await oq(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=id(1),other=id(2);
const items=[3,4].map(n=>({screeningId:id(n),snapshot:{propertyId:'prop_'+n,propertyType:'house',raw:{data:{state:'TX'}}},ids:['per_'+n]}));
const candidates=items.map(({ids,...c})=>c),request={people_ids:['per_3','per_4']};
const pending=(a=account,c=candidates,mobile=false)=>ov('select icash_pending_owner_preflight($1,$2,$3,$4)',[a,id(3),c,mobile]);
try{
 await owners.exec(read('tests/fixtures/owner-preflight-foundation.sql'));
 await owners.exec(read('tests/fixtures/owner-preflight-cohorts.sql'));
 await owners.exec(read('config/owner-export-preflight.sql'));
 const source=read('config/owner-export-preflight-cohorts.sql');
 await owners.exec(source.slice(source.indexOf('create function icash_research_private.owner_preflight_cohort'),source.indexOf('create function public.icash_owner_preflight_sibling_waiting')));
 await owners.exec(migration.slice(migration.indexOf('create function public.icash_pending_owner_preflight'),migration.indexOf('-- Independent financial queries')));
 await oq('insert into icash_accounts(id) values($1),($2)',[account,other]);
 await oq('insert into icash_wallets(account_id) values($1),($2)',[account,other]);
 for(const item of items)await oq("insert into icash_screening_jobs(id,account_id,state,snapshot) values($1,$2,'complete',$3)",[item.screeningId,account,item.snapshot]);
 await owners.exec('update icash_research_private.owner_export_settings set preflight_enabled=true');
 await oq("insert into icash_research_private.owner_export_preflights(account_id,fingerprint,items,request,state,list_name) values($1,'fixture',$2,$3,'waiting','fixture')",[account,items,request]);
 assert.deepEqual(await pending(),{items,request});
 assert.equal(await pending(other),null);assert.equal(await pending(account,candidates.slice(0,1)),null);assert.equal(await pending(account,candidates,true),null);
 assert.equal(await pending(account,[...candidates].reverse()),null,'Original cohort order is preserved');
 for(const mutation of [
  'update icash_accounts set bot_paused=true',
  'update icash_wallets set balance_cents=0',
  'update fixture_settings set unstarted=false',
  'update fixture_settings set people_available=false',
  'update fixture_settings set mobile=true',
  "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"prop_changed\"')",
  "update icash_research_private.owner_export_preflights set state='held'",
  "update icash_research_private.owner_export_preflights set state='ready'",
  'update icash_research_private.owner_export_preflights set cleanup_attempts=1',
  "insert into icash_property_controls values('"+account+"','prop_3',true)"
 ]){await owners.exec('begin');try{await owners.exec(mutation);assert.equal(await pending(),null,mutation);}finally{await owners.exec('rollback');}}
 assert.equal(await ov('select count(*)::int from fixture_purchases'),0,'Read never purchases or mutates a preflight');
}finally{await owners.close();}
console.log('PASS request efficiency: exact pending owner checks, financial-query starter exclusions, original quota/account/token gates, late controls, preserved receipts and no paid tests.');
