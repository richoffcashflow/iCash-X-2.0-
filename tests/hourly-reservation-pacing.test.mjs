// Isolated PostgreSQL accounting scenarios. No providers or live funds.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),account='10000000-0000-4000-8000-000000000001';
const q=(sql,args=[])=>pg.query(sql,args);
const value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const available=()=>value('select icash_prospecting_available($1)',[account]).then(Number);
const total=()=>value('select icash_prospecting_total_available($1)',[account]).then(Number);
const isolated=async fn=>{await q('begin');try{await fn();}finally{await q('rollback');}};
const insert=async({key='cold:fixture',state='dispatched',cap=800,age='2 hours',dispatchAge=age,charged=null,settledAge=null,budget=1}={})=>q(`
 insert into icash_operation_spend(operation_key,account_id,prospecting_budget_id,state,charge_cap_cents,charged_cents,created_at,dispatched_at,settled_at)
 values($1,$2,$3,$4,$5,$6,now()-$7::interval,case when $8::text is null then null else now()-$8::interval end,case when $9::text is null then null else now()-$9::interval end)`,[key,account,budget,state,cap,charged,age,dispatchAge,settledAge]);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_wallets(account_id uuid primary key,balance_cents bigint);
 create table icash_prospecting_budgets(id bigint primary key,account_id uuid,baseline_cents bigint,limit_cents bigint,created_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,prospecting_budget_id bigint,rate_id uuid,state text,charge_cap_cents bigint,charged_cents bigint,created_at timestamptz,dispatched_at timestamptz,settled_at timestamptz);
 create table icash_duplicate_discovery_coverage(operation_key text primary key,account_id uuid,covered_cents bigint);
 create function icash_new_prospect_operation(uuid,text,uuid) returns boolean language sql stable as $$select $2 like 'cold:%'$$;`);
 const baseline=JSON.parse(read('tests/fixtures/hourly-reservation-baseline.json'));
 for(const fn of baseline)await pg.exec(fn.definition);
 await pg.exec('revoke all on function icash_prospecting_available(uuid),icash_prospecting_total_available(uuid),icash_prospecting_released(bigint,timestamptz) from public,anon,authenticated;grant execute on function icash_prospecting_available(uuid),icash_prospecting_total_available(uuid),icash_prospecting_released(bigint,timestamptz) to service_role;');
 await q('insert into icash_wallets values($1,25000)',[account]);
 await q("insert into icash_prospecting_budgets values(1,$1,25000,12500,now()-interval '1 day')",[account]);
 assert.equal(await available(),1250);
 await insert({cap:1800});assert.equal(await available(),0,'old unknown cap currently consumes every new hourly batch');
 const oldTotal=await total(),beforeRows=(await q('select * from icash_operation_spend')).rows;
 const oldWallet=(await q('select * from icash_wallets')).rows;
 const definition=fn=>value('select pg_get_functiondef($1::regprocedure)',[fn]);
 const oldDefinition=await definition('icash_prospecting_available(uuid)');
 const totalDefinition=await definition('icash_prospecting_total_available(uuid)');
 const releaseDefinition=await definition('icash_prospecting_released(bigint,timestamptz)');
 const sql=read('config/hourly-reservation-pacing.sql');await pg.exec(sql);
 assert.equal(await available(),1250,'an old reservation no longer occupies a fresh hourly batch');
 assert.equal(await total(),oldTotal,'the unresolved 1800-cent hold remains in the total allowance');
 assert.deepEqual((await q('select * from icash_operation_spend')).rows,beforeRows,'no hold, state, charge or receipt is rewritten');
 assert.deepEqual((await q('select * from icash_wallets')).rows,oldWallet);
 const replacement=sql.split('$new$')[1],needle=sql.split('$old$')[1];
 const after=await definition('icash_prospecting_available(uuid)');
 assert.equal(after,oldDefinition.replace(needle,()=>replacement),'only hourly attribution changes');
 assert.equal(await definition('icash_prospecting_total_available(uuid)'),totalDefinition);
 assert.equal(await definition('icash_prospecting_released(bigint,timestamptz)'),releaseDefinition);
 await q('delete from icash_operation_spend');
 for(const [age,expected] of [['0 seconds',450],['59 minutes',450],['3599.999 seconds',450],['1 hour',1250],['61 minutes',1250],['25 hours',1250]])await isolated(async()=>{
  await insert({age});assert.equal(await available(),expected,'reservation age '+age);assert.equal(await total(),11700,'all ages retain total hold');
 });
 await isolated(async()=>{await insert({age:'2 hours',dispatchAge:'30 seconds',cap:1000});assert.equal(await available(),250,'a recent dispatch of an older reservation consumes the current hour');});
 await isolated(async()=>{await insert({state:'reserved',age:'30 minutes',dispatchAge:null});assert.equal(await available(),450,'unstarted reservations use their reservation time');});
 await isolated(async()=>{await insert({state:'reserved',age:'2 hours',dispatchAge:null});assert.equal(await available(),1250);assert.equal(await total(),11700,'old unstarted hold remains fully reserved');});
 await isolated(async()=>{await insert({age:'-1 minute'});assert.equal(await available(),450,'future-dated receipts fail conservatively');});
 await isolated(async()=>{await insert({cap:12500,age:'25 hours'});assert.equal(await available(),0,'total allowance remains binding for unknown outcomes');});
 await isolated(async()=>{await insert({cap:1500});await q('update icash_wallets set balance_cents=14000');assert.equal(await available(),0,'protected wallet funds and all pending caps remain binding');});
 await isolated(async()=>{await insert({state:'settled',cap:1000,charged:500,age:'25 hours',settledAge:'1 minute'});assert.equal(await available(),750,'late settlement enters current hourly actual usage');});
 await isolated(async()=>{await insert({state:'settled',charged:12300,cap:12300,settledAge:'2 hours'});assert.equal(await available(),200,'rolling daily and lifetime fifty-percent ceilings stay binding');});
 await isolated(async()=>{await insert({budget:null,cap:800});assert.equal(await total(),11700,'unassigned new-prospect hold still protects wallet capacity');assert.equal(await available(),1250);});
 await isolated(async()=>{await insert({key:'reply:fixture',budget:null,cap:800,age:'1 minute'});assert.equal(await total(),12500);assert.equal(await available(),1250,'non-prospect reservations keep their existing separate treatment');});
 await isolated(async()=>{await insert({state:'settled',charged:150,cap:500,settledAge:'1 minute'});await q("insert into icash_duplicate_discovery_coverage values('cold:fixture',$1,100)",[account]);assert.equal(await available(),1200,'coverage is subtracted once from actual usage');});
 await isolated(async()=>{await q("update icash_prospecting_budgets set created_at=now()");assert.equal(await available(),1250,'immediate starter and twelve-hour release remain unchanged');await insert({cap:1000});assert.equal(await available(),250,'old holds still consume cumulative released capacity');});
 await isolated(async()=>{await q('delete from icash_prospecting_budgets');assert.equal(await available(),0,'missing verified baseline cannot spend');});
 for(const role of ['anon','authenticated'])assert.equal(await value("select has_function_privilege($1,'icash_prospecting_available(uuid)','execute')",[role]),false);
 assert.equal(await value("select has_function_privilege('service_role','icash_prospecting_available(uuid)','execute')"),true);
 await assert.rejects(pg.exec(sql),/Hourly reservation pacing prerequisite changed/);await q('rollback');
 assert.equal(await definition('icash_prospecting_available(uuid)'),after,'unexpected prerequisite fails atomically');
 console.log('PASS hourly reservation attribution: six time boundaries, recent dispatch, reserved holds, late actual settlement, total/daily/cumulative/wallet limits, duplicate coverage, missing funding, unchanged financial rows and private ACL.');
}finally{await pg.close();}
