import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installHeadroomFixture,mixedDemand} from './helpers/acquisition-headroom-fixture.mjs';
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
const cap=(n,a=null)=>v('select public.icash_dealmachine_capacity_available($1,$2)',[n,a]);
const budget=()=>v('select to_jsonb(b) from public.icash_dealmachine_request_budget b');
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
try{
 await installHeadroomFixture(pg);
 const old=await v("select fixture_reserve_seed(7001,interval '3 days')");
 const fresh=await v("select fixture_reserve_seed(7002,interval '1 hour')");
 if(process.env.HEADROOM_BASELINE!=='1'){
  assert.deepEqual(await mixedDemand(pg,old),{contacts:0,discovery:30,spent:60},'Reproduce continuous two-request starvation before installation');
  await pg.exec("update public.icash_dealmachine_request_budget set day_start=now()-interval '12 hours',day_used=4669,minute_start=now(),minute_used=0");
  const original=await budget();
  await pg.exec(readFileSync(new URL('../config/acquisition-quota-headroom.sql',import.meta.url),'utf8'));
  assert.deepEqual(await budget(),original,'Installation cannot change any budget/window/counter');
  assert.equal(await cap(2,old),true,'Disabled installation retains the exact original behavior');
  assert.equal(await v("select icash_research_private.activate_acquisition_headroom('invalid')"),false);
  await isolated(async()=>{
   await pg.exec("update icash_research_private.acquisition_headroom_policy set capacity_hash=repeat('0',32)");
   assert.equal(await v("select icash_research_private.activate_acquisition_headroom(repeat('a',40))"),false);
  });
  for(const mutation of ["update icash_research_private.request_pacing_policy set enabled=false","update public.icash_dealmachine_request_budget set minute_limit=59","update public.icash_dealmachine_request_budget set day_start=now()-interval '25 hours'"])
   await isolated(async()=>{await pg.exec(mutation);assert.equal(await v("select icash_research_private.activate_acquisition_headroom(repeat('a',40))"),false);});
  assert.equal(await v("select icash_research_private.activate_acquisition_headroom(repeat('a',40))"),true);
  const receipt=await v('select to_jsonb(p) from icash_research_private.acquisition_headroom_policy p');
  assert.equal(await v("select icash_research_private.activate_acquisition_headroom(repeat('a',40))"),true);
  assert.equal(await v("select icash_research_private.activate_acquisition_headroom(repeat('b',40))"),false);
  assert.deepEqual(await v('select to_jsonb(p) from icash_research_private.acquisition_headroom_policy p'),receipt);
  assert.deepEqual(await budget(),original,'Activation is not a request admission or budget reset');
  assert.equal(await cap(2,old),false);assert.equal(await cap(2),false);assert.equal(await cap(1,old),true);assert.equal(await cap(3,old),false);
  assert.equal(await cap(2,fresh),true,'Existing starter allowance does not wait on ordinary headroom');
  for(const n of [null,0,-1,61])assert.equal(await cap(n,old),false);
  for(const [mutation,expected] of [
   ["update icash_research_private.acquisition_headroom_policy set enabled=false",true],
   ["update icash_research_private.request_pacing_policy set enabled=false",true],
   ["update public.icash_dealmachine_request_budget set day_used=4668",true],
   ["update public.icash_dealmachine_request_budget set day_start=now()-interval '23 hours',day_used=8622",true],
   ["update public.icash_dealmachine_request_budget set minute_used=59",false],
   ["update public.icash_dealmachine_request_budget set day_used=9799",false],
   ["update icash_research_private.quota_feedback set blocked_until=now()+interval '1 hour'",false],
  ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await cap(2,old),expected,mutation);});
  await isolated(async()=>{await q('update public.icash_accounts set bot_paused=true where id=$1',[fresh]);assert.equal(await cap(2,fresh),false,'A stopped account cannot borrow startup headroom');});
  await isolated(async()=>{
   const id='00000000-0000-4000-9000-000000007001';
   const take=()=>v("select public.icash_take_dealmachine_request('property_search',$1,'already-started-fixture',$2)",[old,id]);
   assert.equal(await take(),true,'A request in an existing admitted workflow still uses the original one-request limiter');
   const saved=await v('select to_jsonb(r) from icash_research_private.requests r where id=$1',[id]);
   assert.equal(await take(),false,'Unknown original requests remain one-use');
   assert.deepEqual(await v('select to_jsonb(r) from icash_research_private.requests r where id=$1',[id]),saved);
   assert.equal((await budget()).day_used,original.day_used+1);
  });
  for(const role of ['anon','authenticated','service_role']){
   assert.equal(await v("select has_table_privilege($1,'icash_research_private.acquisition_headroom_policy','select')",[role]),false);
   assert.equal(await v("select has_table_privilege($1,'icash_research_private.acquisition_headroom_policy','update')",[role]),false);
   assert.equal(await v("select has_function_privilege($1,'icash_research_private.activate_acquisition_headroom(text)','execute')",[role]),false);
  }
  assert.equal(await v("select has_function_privilege('service_role','public.icash_dealmachine_capacity_available(integer,uuid)','execute')"),true);
 }
 const result=await mixedDemand(pg,old);console.log('Mixed paced demand:',result);
 assert(result.contacts>0,'A continuously eligible contact batch must not starve behind smaller searches');
 assert(result.discovery>0,'Contact headroom must retain discovery progress');
 assert(result.spent<=60,'No extra released allowance is created');
 console.log('PASS paced acquisition headroom: both work classes progress; disabled/guarded activation, unchanged counters, starter allowance, hard limits, final admission and unknown-request replay protection');
}finally{await pg.close();}
