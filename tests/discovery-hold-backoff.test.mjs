import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('config/discovery-hold-backoff.sql');
assert.equal(migration,read('supabase/migrations/20261110180000_discovery_hold_backoff.sql'));
const before=JSON.parse(read('tests/fixtures/discovery-hold-before.json'));
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),value=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
try{
 await db.exec(read('tests/fixtures/discovery-hold-foundation.sql'));
 for(const definition of Object.values(before))await db.exec(definition);
 const account=await value('select fixture_discovery_seed(1)'),other=await value('select fixture_discovery_seed(2)');
 await q('update icash_discovery_configs set enabled=false where account_id=$1',[other]);
 const held=await value("insert into icash_automation_tickets(account_id,kind,state,outcome,completed_at) values($1,'discovery','held','inventory_held',now()) returning id",[account]);
 assert(await value('select icash_next_acquisition()'),'Reproduce predecessor: a fresh held search immediately issues again');
 await q("delete from icash_automation_tickets where state='issued'");
 await db.exec(migration);await db.exec(migration);
 const due=()=>q("update icash_discovery_configs set next_run_at=now()-interval '1 second'");
 const issue=()=>value('select icash_next_acquisition()');
 await due();assert.equal(await issue(),null,'Known inventory holds suppress only fresh discovery for a minute');
 assert.equal(await value('select count(*)::int from icash_automation_tickets'),1);
 const original=await value('select to_jsonb(t) from icash_automation_tickets t where id=$1',[held]);
 const contact='00000000-0000-4000-8000-000000000001';
 await q('update fixture_acquisition set contact=$2 where account_id=$1',[account,contact]);
 await due();assert(await issue(),'Existing eligible contacts continue inside the discovery cooldown');
 assert.equal(await value("select kind from icash_automation_tickets where state='issued'"),'contacts');
 await q("delete from icash_automation_tickets where state='issued'");await q('update fixture_acquisition set contact=null');
 await q('update icash_discovery_configs set enabled=true where account_id=$1',[other]);
 await due();assert(await issue(),'Another funded account progresses while the first waits');
 assert.equal(await value("select account_id from icash_automation_tickets where state='issued'"),other);
 await q("delete from icash_automation_tickets where state='issued'");await q('update icash_discovery_configs set enabled=false where account_id=$1',[other]);
 assert.deepEqual(await value('select to_jsonb(t) from icash_automation_tickets t where id=$1',[held]),original,'No recovery rewrites the original evidence');
 // Non-hold outcomes, stale history, missing/future completion times cannot
 // manufacture an ongoing cooldown. A real active ticket still fences issuance.
 for(const change of ["completed_at=now()-interval '61 seconds'","outcome='held_for_reconciliation'","completed_at=null","completed_at=now()+interval '1 minute'","created_at=now()-interval '6 minutes'"]){
  await q("update icash_automation_tickets set outcome='inventory_held',created_at=now(),completed_at=now() where id=$1",[held]);
  await q(`update icash_automation_tickets set ${change} where id=$1`,[held]);
  await due();assert(await issue(),change);await due();assert.equal(await issue(),null,'Active one-use ticket is never duplicated');
  await q("delete from icash_automation_tickets where state='issued'");
 }
 await q('delete from icash_automation_tickets');
 for(const [set,restore] of [
  ["update icash_accounts set bot_paused=true","update icash_accounts set bot_paused=false"],
  ["update icash_wallets set reserved_cents=balance_cents","update icash_wallets set reserved_cents=0"],
  ["update fixture_acquisition set quota=false","update fixture_acquisition set quota=true"],
  ["update fixture_acquisition set allowance=0","update fixture_acquisition set allowance=1000"],
  ["update fixture_acquisition set search_due=false","update fixture_acquisition set search_due=true"],
  ["update icash_operating_budget set enabled=false","update icash_operating_budget set enabled=true"]
 ]){await db.exec(set);await due();assert.equal(await issue(),null,set);await db.exec(restore);}
 const scope={p_revision:'00000000-0000-4000-8000-000000000002',p_page:1},query={estimate_cost:true,contact_audience:'none',anchor:'properties'};
 const claim=a=>value('select icash_claim_discovery_estimate($1,$2,null,null,$3)',[a,scope,query]);
 assert.equal((await claim(account)).status,'request');
 assert(await value("select lease_until between now()+interval '89 seconds' and now()+interval '90 seconds' from icash_research_private.estimates"));
 assert.equal((await claim(other)).status,'held','The longer free lease still coalesces identical queries across accounts');
 await q("update icash_research_private.estimates set lease_until=now()+interval '40 seconds'");
 assert.equal((await claim(account)).status,'held','A 50-second-old estimate retains its original lease');
 await q("update icash_research_private.estimates set lease_until=now()-interval '1 second'");
 assert.equal((await claim(other)).status,'request','Expired free leases can be reclaimed without paid admission');
 // Detect drift in the second function and roll back the first replacement too.
 for(const definition of Object.values(before))await db.exec(definition);
 await db.exec(before.icash_claim_discovery_estimate.replace("'1 minute'","'2 minutes'"));
 await assert.rejects(db.exec(migration),/Unexpected icash_claim_discovery_estimate predecessor/);await db.exec('rollback');
 assert.equal(await value("select pg_get_functiondef('icash_next_acquisition()'::regprocedure)"),before.icash_next_acquisition);
 // A concurrent financial-prefilter release adds validation and persists exact
 // shared estimates. The timeout patch must preserve both additions verbatim.
 await db.exec(`alter table icash_research_private.estimates add shared_from_operation text;
 alter table fixture_acquisition add financial_valid boolean default false;
 create function icash_research_private.financial_query_valid(jsonb,jsonb,jsonb,jsonb) returns boolean language sql as $$select bool_and(financial_valid) from public.fixture_acquisition$$;
 truncate icash_research_private.estimates;`);
 await db.exec(JSON.parse(read('tests/fixtures/discovery-financial-estimate-before.json')).definition);
 await db.exec(migration);await db.exec(migration);
 const financial=a=>value('select icash_claim_discovery_estimate($1,$2,null,$3,$4)',[a,scope,{version:'financial-prefilter-v1'},query]);
 assert.equal((await financial(account)).status,'held','Existing financial query validation still blocks before the free lease');
 await db.exec('update fixture_acquisition set financial_valid=true');
 assert.equal((await financial(account)).status,'request');
 assert(await value("select lease_until>now()+interval '89 seconds' from icash_research_private.estimates"));
 const response={estimated_credits:{this_page:2,breakdown:{people:0}},totals:{properties:2},pagination:{total_results:2}};
 await q('update icash_research_private.estimates set lease_until=null,response=$1,saved_at=now()',[response]);
 assert.deepEqual((await financial(other)).response,response,'The financial policy keeps the full exact shared free estimate');
 assert(await value('select shared_from_operation is not null from icash_research_private.estimates where account_id=$1',[other]));
 console.log('Discovery backoff: reproduced hot loop; bounded independent progress, original controls, coalesced free lease and atomic drift rejection passed.');
}finally{await db.close();}
