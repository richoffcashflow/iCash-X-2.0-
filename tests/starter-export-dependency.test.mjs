import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {installReservePrerequisites} from '../scripts/test-new-user-request-reserve-pglite.mjs';
import {starterExportFixtureSql} from '../scripts/starter-export-test-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('config/starter-export-dependency.sql');
assert.equal(migration,read('supabase/migrations/20261112200046_starter_export_dependency.sql'));
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const batch='00000000-0000-4000-9000-000000000001';
const claim=()=>v("select icash_claim_automatic_export_capacity(repeat('a',40))");
const probe=(review,p)=>v('select icash_claim_export_capacity_probe($1,$2)',[review,p]);
const finish=review=>v('select icash_finish_automatic_export_capacity($1)',[review]);
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
const receipt=p=>{const data=p==='inventory'?[{export_id:'original-old-export',status:'completed',created_at:'2000-01-01T00:00:00Z'}]:[];
 const raw={data,pagination:{limit:100,offset:0,total:data.length,has_more:false}};
 return {httpStatus:200,raw,rawText:JSON.stringify(raw),headers:{minuteRemaining:49,dayRemaining:700,date:new Date().toUTCString(),age:null}};};
const save=(review,p)=>v('select icash_record_export_capacity_probe($1,$2,$3)',[review,p,receipt(p)]);
try{
 await installReservePrerequisites(pg);await pg.exec(read('config/new-user-request-reserve.sql'));
 await pg.exec(read('tests/fixtures/new-user-request-reserve-exclusions-foundation.sql'));
 await pg.exec(`alter table icash_research_private.settings add column exclusion_sync_enabled boolean default true;
  create table icash_research_private.financial_settings(id int primary key,enabled boolean);
  insert into icash_research_private.financial_settings values(1,true);
  create table icash_research_private.request_reserve_exclusion_claims(token uuid primary key,account_id uuid,list_id text,created_at timestamptz default clock_timestamp());`);
 for(const f of JSON.parse(read('tests/fixtures/request-budget-pacing-before.json')))await pg.exec(f.definition);
 await pg.exec(read('config/research-request-pacing.sql'));await pg.exec(starterExportFixtureSql());
 const a=await v('select fixture_reserve_seed(901)'),b=await v('select fixture_reserve_seed(902)'),old=await v("select fixture_reserve_seed(903,interval '25 hours')");
 await q('insert into icash_discovery_configs(account_id) values($1),($2),($3)',[a,b,old]);
 const raw={error:{code:'invalid_request',request_id:'req_fixture',message:'No records matched this export. Filters and scrub settings (like "Active phone numbers only") may have excluded every record — adjust them and try again.'}};
 const original={httpStatus:400,raw,rawText:JSON.stringify(raw)};
 await q("insert into icash_research_private.owner_batches(id,account_id,paid_receipt) values($1,$2,$3)",[batch,old,raw]);
 await q("insert into icash_research_private.owner_exports(id,request,receipt) values($1,'{\"people_ids\":[\"held-owner\"]}',$2)",[batch,original]);
 await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values($1,'owner_lookup',$2,$3,true,now()-interval '1 second',now(),'{\"outcome\":\"http_error\",\"httpStatus\":400}')",[batch,old,'owner-batch:'+batch]);
 await pg.exec(`insert into icash_operation_spend values('original','dispatched',100);
  update icash_research_private.export_capacity_automation set enabled=true,empty_enabled=true,unknown_enabled=true;
  update icash_research_private.request_reserve_policy set enabled=true;
  update icash_dealmachine_request_budget set day_used=8820,minute_used=0;
  update icash_research_private.request_pacing_policy set enabled=true,activate_after=now()+interval '1 hour';`);
 assert.equal(await claim(),null,'Original capacity recovery cannot reach the reserved startup pool');
 const budget=await v('select to_jsonb(b) from icash_dealmachine_request_budget b');
 const source=await v("select to_jsonb(e)-'capacity_review_id' from icash_research_private.owner_exports e");
 const paid=await v('select to_jsonb(b) from icash_research_private.owner_batches b');
 await pg.exec(migration);assert.deepEqual(await v('select to_jsonb(b) from icash_dealmachine_request_budget b'),budget);
 for(const mutation of [
  'update icash_discovery_configs set fixture_candidate=false','update icash_discovery_configs set contacts_enabled=false',
  'update icash_discovery_configs set auto_enabled=false','update icash_discovery_configs set enabled=false',
  "update icash_discovery_configs set data_rights_until=now()-interval '1 second'",
  'update icash_accounts set bot_paused=true','update icash_wallets set reserved_cents=balance_cents',
  'update icash_accounts set membership_allowed=false',"update icash_funding_orders set credited_at=now()-interval '25 hours'",
  'update icash_research_private.request_reserve_policy set enabled=false;update icash_dealmachine_request_budget set day_used=9800',
  'update icash_dealmachine_request_budget set minute_used=58','update icash_dealmachine_request_budget set day_used=9798',
  "update icash_research_private.quota_feedback set blocked_until=now()+interval '1 hour'",
  'update icash_research_private.export_capacity_automation set empty_enabled=false',
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await claim(),null,mutation);});
 await isolated(async()=>{await pg.exec('update icash_dealmachine_request_budget set day_used=0');const c=await claim();assert(c);
  assert.equal(await v('select account_id from icash_research_private.requests where id=$1',[c.requestId]),null,'Ordinary allowance remains first');});
 await isolated(async()=>{for(let i=1;i<=12;i++){const empty=await v('select fixture_reserve_seed($1)',[i]);
  await q("insert into icash_discovery_configs(account_id,next_run_at,fixture_candidate) values($1,now()-interval '1 hour',false)",[empty]);}
  const c=await claim();assert(c);assert.equal(await v('select account_id from icash_research_private.requests where id=$1',[c.requestId]),a,'Earlier empty accounts cannot starve an eligible starter');});
 const c=await claim();assert(c);assert.equal(await claim(),null,'One original shared export lease');
 assert.equal(await v('select account_id from icash_research_private.requests where id=$1',[c.requestId]),a,'Oldest current starter funds only its shared dependency');
 await save(c.reviewId,'inventory');
 for(const mutation of [
  `update icash_accounts set bot_paused=true where id='${a}'`,
  `update icash_wallets set reserved_cents=balance_cents where account_id='${a}'`,
  `update icash_discovery_configs set fixture_candidate=false where account_id='${a}'`,
  `update icash_discovery_configs set contacts_enabled=false where account_id='${a}'`,
  'update icash_dealmachine_request_budget set minute_used=60',
  'update icash_research_private.request_reserve_policy set account_requests=1',
  "update icash_research_private.quota_feedback set blocked_until=now()+interval '1 hour'",
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await probe(c.reviewId,'pending'),null,'Never switch to another beneficiary after '+mutation);});
 for(const p of ['pending','processing']){assert(await probe(c.reviewId,p));assert.equal(await probe(c.reviewId,p),null);await save(c.reviewId,p);}
 assert.equal(await v('select day_used from icash_dealmachine_request_budget'),8823);
 assert.equal(await v('select count(*)::int from icash_research_private.request_reserve_admissions'),3);
 assert.equal(await v('select count(distinct account_id)::int from icash_research_private.request_reserve_admissions'),1);
 assert.equal(await v('select count(*)::int from icash_research_private.maintenance_request_admissions'),0);
 await isolated(async()=>{await q("update icash_research_private.requests set account_id=$1 where id=(select request_id from icash_research_private.export_capacity_probes where review_id=$2 and probe='processing')",[b,c.reviewId]);
  assert.equal(await finish(c.reviewId),'capacity_review_held','Final verification rejects mismatched beneficiary attribution');});
 assert.equal(await finish(c.reviewId),'capacity_verified');assert.equal(await finish(c.reviewId),'capacity_verified');
 assert.deepEqual(await v("select to_jsonb(e)-'capacity_review_id' from icash_research_private.owner_exports e"),source);
 assert.deepEqual(await v('select to_jsonb(b) from icash_research_private.owner_batches b'),paid);
 assert.equal(await v('select state from icash_operation_spend'),'dispatched');
 assert.equal(await v("select icash_owner_export_people_available('[\"held-owner\"]')"),false);
 assert.equal(await claim(),null);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'icash_research_private.starter_export_dependency_current(uuid)','execute')",[role]),false);
 console.log('PASS startup export dependency: real reserve and original recovery, three bounded reads for one current account, late controls, no beneficiary switching, no ordinary/maintenance borrowing, no original export replay or money release.');
}finally{await pg.close();}
