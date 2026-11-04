import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installReservePrerequisites} from '../scripts/test-new-user-request-reserve-pglite.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const hash=signature=>v('select md5(pg_get_functiondef($1::regprocedure))',[signature]);
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
try{
 await installReservePrerequisites(pg);
 await pg.exec(read('config/new-user-request-reserve.sql'));
 await pg.exec(read('tests/fixtures/new-user-request-reserve-exclusions-foundation.sql'));
 await pg.exec(JSON.parse(read('tests/fixtures/new-user-request-reserve-exclusions-before.json'))[0].definition);
 const original=read('config/research-request-efficiency.sql');
 await pg.exec(original.slice(original.indexOf('create function public.icash_finish_research_exclusions'),original.indexOf('alter table icash_research_private.exclusions enable')));
 // Install the existing targeting receipt extension, then assert it is unchanged.
 const target=read('config/dealmachine-targeting-experiments.sql');
 const finishPatch=target.slice(target.indexOf(" d:=pg_get_functiondef('public.icash_finish_research_exclusions"),target.indexOf('end $patch$;',target.indexOf(" d:=pg_get_functiondef('public.icash_finish_research_exclusions")));
 await pg.exec(`do $patch$ declare d text;needle text;begin ${finishPatch} end $patch$;`);
 await pg.exec(read('config/new-user-request-reserve-exclusions.sql'));
 const immutable=['public.icash_finish_research_exclusions(uuid,jsonb)','public.icash_claim_starter_research_exclusions(uuid)','icash_research_private.starter_exclusion_request_allowed(uuid,text,timestamptz)','icash_research_private.take_reserved_request(text,uuid,text,uuid)'];
 const before=await Promise.all(immutable.map(hash));
 const config=read('config/research-exclusion-sync-control.sql');
 assert.equal(read('supabase/migrations/20261104053431_research_exclusion_sync_control.sql'),config);
 await pg.exec(config);
 assert.deepEqual(await Promise.all(immutable.map(hash)),before,'Original completion, starter proof and limiter remain byte-identical');
 assert.equal(await v('select exclusion_sync_enabled from icash_research_private.settings'),false);
 const a=await v("select fixture_reserve_seed(1,'1 hour'::interval)");
 await q('insert into icash_discovery_configs(account_id) values($1)',[a]);
 const configs=await v('select jsonb_agg(to_jsonb(c)) from icash_discovery_configs c');
 await pg.exec('update icash_research_private.settings set exclusions_enabled=false;update icash_research_private.request_reserve_policy set enabled=true');
 const claim=()=>v('select icash_claim_research_exclusions()');
 assert.equal(await claim(),null,'Independent syncing is opt-in');
 await pg.exec('update icash_research_private.settings set exclusion_sync_enabled=true');
 for(const mutation of [
  'update icash_research_private.settings set enabled=false',
  "update icash_research_private.exclusions set list_id=null,state='new'",
  "update icash_research_private.exclusions set list_id=null,state='unknown'",
  "update icash_research_private.exclusions set state='unknown'",
  "update icash_research_private.exclusions set next_at=now()+interval '1 hour'",
  "update icash_research_private.exclusions set lease_until=now()+interval '1 minute'",
  'update icash_research_private.exclusion_items set synced_at=now()',
  'update icash_dealmachine_request_budget set day_used=9800',
  'update icash_dealmachine_request_budget set minute_used=60'
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await claim(),null,mutation);});
 await isolated(async()=>{
  await pg.exec('update icash_dealmachine_request_budget set day_used=8820,minute_used=0');
  assert.equal(await claim(),null,'Maintenance cannot consume protected reserve');
  assert.equal(await v('select icash_claim_starter_research_exclusions($1)',[a]),null,'Independent sync switch cannot widen the starter reserve proof');
  assert.equal(await v('select count(*)::int from icash_research_private.request_reserve_exclusion_claims'),0);
 });
 await pg.exec("insert into icash_research_private.targeting_acquired_properties values('prop_2',null);update icash_research_private.targeting_settings set enabled=true");
 const c=await claim();assert.equal(c.action,'sync');assert.equal(c.listId,'fixture-list');assert.deepEqual(c.ids,['prop_1','prop_2']);assert.equal(c.accountId,undefined);
 assert.equal(await claim(),null,'Existing lease makes repeat maintenance idempotent');
 assert.equal(await v("select icash_take_dealmachine_request('exclusion_sync',null,null,gen_random_uuid())"),true,'Normal shared limiter admits the free list request');
 assert.equal(await v('select count(*)::int from icash_research_private.request_reserve_admissions'),0);
 for(const result of [{ok:true,listId:'different',ids:c.ids},{ok:true,listId:c.listId,ids:['prop_1']}])assert.equal(await v('select icash_finish_research_exclusions($1,$2)',[c.token,result]),false,'Mismatched receipts cannot complete the original batch');
 assert.equal(await v('select icash_finish_research_exclusions($1,$2)',[c.token,{ok:true,listId:c.listId,ids:c.ids,added:2}]),true);
 assert.equal(await v('select count(*)::int from icash_research_private.exclusion_items where synced_at is null'),0);
 assert.equal(await v('select count(*)::int from icash_research_private.targeting_acquired_properties where synced_at is null'),0);
 assert.deepEqual(await v('select jsonb_agg(to_jsonb(c)) from icash_discovery_configs c'),configs,'Sync neither attaches lists nor revises configuration');
 assert.equal(await v('select exclusions_enabled from icash_research_private.settings'),false,'Ordinary exclusion query policy remains disabled');
 await isolated(async()=>{
  await pg.exec("update icash_research_private.settings set exclusions_enabled=true,exclusion_sync_enabled=false;update icash_research_private.exclusions set list_id=null,state='new',next_at=now()-interval '1 second'");
  assert.equal((await claim()).action,'create','Explicit old authorization preserves original creation semantics');
 });
 const activation=read('config/activate-research-exclusion-sync.sql').match(/do \$activate\$[\s\S]*?\$activate\$;/)[0];
 await isolated(async()=>{
  await pg.exec('update icash_research_private.settings set exclusion_sync_enabled=false');
  await assert.rejects(()=>pg.exec(activation),/Reviewed release and exact existing list are required/);
 });
 for(const mutation of ["update icash_research_private.exclusions set list_id='changed-list'","update icash_research_private.exclusions set state='unknown'","update icash_research_private.exclusions set token=gen_random_uuid()",'update icash_research_private.settings set exclusions_enabled=true'])await isolated(async()=>{
  await pg.exec('update icash_research_private.settings set exclusion_sync_enabled=false');
  await q("select set_config('icash.reviewed_release_sha',$1,true),set_config('icash.reviewed_exclusion_list_id','fixture-list',true)",['a'.repeat(40)]);
  await pg.exec(mutation);await assert.rejects(()=>pg.exec(activation),/Exact ready idle provider list required|Expected inactive independent sync/);
 });
 await isolated(async()=>{
  await pg.exec('update icash_research_private.settings set exclusion_sync_enabled=false');
  await q("select set_config('icash.reviewed_release_sha',$1,true),set_config('icash.reviewed_exclusion_list_id','fixture-list',true)",['a'.repeat(40)]);
  await pg.exec(activation);
  assert.equal(await v('select exclusion_sync_enabled and not exclusions_enabled from icash_research_private.settings'),true);
  assert.deepEqual(await v('select jsonb_agg(to_jsonb(c)) from icash_discovery_configs c'),configs);
 });
 console.log('PASS independent exclusion sync: default-off, ready saved list only, immutable receipts/configs, unchanged reserve proof and limiter, no protected allowance, exact batch completion.');
 console.log('Claim hash for guarded activation:',await hash('public.icash_claim_research_exclusions()'));
}finally{await pg.close();}
