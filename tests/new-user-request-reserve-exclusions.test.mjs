import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installReservePrerequisites} from '../scripts/test-new-user-request-reserve-pglite.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const seed=(n,age='1 hour')=>v('select fixture_reserve_seed($1,$2::interval)',[n,age]);
const claim=a=>v('select icash_claim_starter_research_exclusions($1)',[a]);
const request=(a,token)=>v("select icash_take_dealmachine_request('exclusion_sync',$1,$2,gen_random_uuid())",[a,'starter-exclusion:'+token]);
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
try{
 await installReservePrerequisites(pg);
 await pg.exec(read('config/new-user-request-reserve.sql'));
 await pg.exec(read('tests/fixtures/new-user-request-reserve-exclusions-foundation.sql'));
 const before=JSON.parse(read('tests/fixtures/new-user-request-reserve-exclusions-before.json'))[0];
 await pg.exec(before.definition);
 assert.equal(await v("select md5(pg_get_functiondef('icash_claim_research_exclusions()'::regprocedure))"),before.hash);
 const original=read('config/research-request-efficiency.sql');
 await pg.exec(original.slice(original.indexOf('create function public.icash_finish_research_exclusions'),original.indexOf('alter table icash_research_private.exclusions enable')));
 await pg.exec(read('config/new-user-request-reserve-exclusions.sql'));
 const a=await seed(1),b=await seed(2),old=await seed(3,'25 hours');
 await q('insert into icash_discovery_configs(account_id) values($1),($2),($3)',[a,b,old]);
 await pg.exec('update icash_research_private.request_reserve_policy set enabled=true;update icash_dealmachine_request_budget set day_used=8820,minute_used=0');
 assert.equal(await v('select icash_claim_research_exclusions()'),null,'Global maintenance cannot spend protected capacity');
 assert.equal(await claim(old),null,'Old account cannot borrow starter capacity');
 assert.equal(await request(a,'invented'),false,'An account and operation string alone cannot authorize reserved sync');
 for(const mutation of [
  'update icash_research_private.exclusions set list_id=null',
  "update icash_research_private.exclusions set state='unknown'",
  'update icash_research_private.settings set exclusions_enabled=false',
  'update icash_discovery_configs set research_list_id=null',
  "update icash_discovery_configs set research_list_id='different-list'",
  'update icash_discovery_configs set enabled=false',
  'update icash_discovery_configs set auto_enabled=false',
  "update icash_discovery_configs set data_rights_until=now()-interval '1 second'",
  'update icash_accounts set bot_paused=true'
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await claim(a),null,mutation);});
 const c=await claim(a);
 assert.equal(c.action,'sync');assert.equal(c.accountId,a);assert.deepEqual(c.ids,['prop_1']);
 assert.equal(await claim(b),null,'Existing shared lease prevents another starter claim');
 assert.equal(await request(b,c.token),false,'Shared list identity does not transfer claim account authority');
 for(const mutation of [
  "update icash_research_private.exclusions set lease_until=now()-interval '1 second'",
  "update icash_discovery_configs set research_list_id='changed-list'",
  'update icash_accounts set bot_paused=true',
  'update icash_research_private.settings set exclusions_enabled=false'
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await request(a,c.token),false,'Final limiter rechecks '+mutation);});
 assert.equal(await request(a,c.token),true,'Exact attached-list lease may use one account reserve request');
 assert.equal(await v('select day_used from icash_dealmachine_request_budget'),8821);
 assert.equal(await v('select count(*)::int from icash_research_private.request_reserve_admissions'),1);
 assert.equal(await request(a,c.token),false,'Different request IDs cannot replay the same protected sync lease');
 assert.equal(await v('select icash_finish_research_exclusions($1,$2)',[c.token,{ok:true,listId:c.listId,ids:c.ids,added:1}]),true);
 assert.equal(await v('select count(*)::int from icash_research_private.exclusion_items where synced_at is null'),0,'Original list receipt resolves the actual prerequisite');
 assert.equal(await request(a,c.token),false,'Finished lease cannot spend reserve again');
 assert.equal(await v("select md5(pg_get_functiondef('icash_claim_research_exclusions()'::regprocedure))"),before.hash,'Accountless behavior is unchanged');
 await isolated(async()=>{
  await pg.exec("update icash_dealmachine_request_budget set day_used=0;update icash_research_private.exclusions set list_id=null,state='new',next_at=now()-interval '1 second'");
  const ordinary=await claim(old);assert.equal(ordinary.action,'create');assert.equal(ordinary.accountId,undefined,'Ordinary capacity retains original global creation/recovery');
 });
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'public.icash_claim_starter_research_exclusions(uuid)','execute')",[role]),role==='service_role');
  assert.equal(await v("select has_function_privilege($1,'icash_research_private.starter_exclusion_request_allowed(uuid,text,timestamptz)','execute')",[role]),false);
 }
 console.log('PASS starter exclusion dependency: actual shared claim and limiter, attached-list-only lease/account binding, one protected request, late controls, original receipt completion and unchanged ordinary maintenance.');
}finally{await pg.close();}
