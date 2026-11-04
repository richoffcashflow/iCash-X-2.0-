import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {costCategories} from '../lib/cost-guard.ts';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const definitions=JSON.parse(read('tests/fixtures/acquisition-settlement-isolation-before.json'));
const migration=read('config/acquisition-settlement-isolation.sql');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const costs=Object.fromEntries(costCategories.map(k=>[k,k==='dealmachine'?250000:k==='support_and_overhead'?40000:0]));
const isolated=async work=>{await pg.exec('begin');try{await work();}finally{await pg.exec('rollback');}};
async function seed(n,{receipt=true,malformed=false}={}){
 const account=id(n),rate=id(1000+n),op='discovery:'+account+':fixture';
 await q("insert into icash_accounts(id,owner_user_id,bot_paused,created_at,workspace_ack_version) values($1,$1,false,now()-interval '2 days','fixture')",[account]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)',[account]);
 await q("insert into icash_operation_rates(id,operation,version,costs_micros,charge_cents,enabled,verified_at,expires_at) values($1,'property_search',$2,$3,105,true,now()-interval '1 day',now()+interval '1 day')",[rate,'fixture-'+n,malformed?{...costs,support_and_overhead:'invalid'}:costs]);
 await q("insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents,reserved_micros,standard_cost_multiplier,elevenlabs_cost_multiplier,dealmachine_cost_multiplier,data_unit_cost_micros,data_cost_basis,created_at,dispatched_at) values($1,$2,$3,'dispatched',105,350000,2,2,3,10000,'fixture unit',now()-interval '2 hours',now()-make_interval(secs=>$4))",[op,account,rate,n]);
 if(receipt){
  await q('insert into icash_discovery_results(operation_key,account_id,result,created_at) values($1,$2,$3,now())',[op,account,{creditsUsed:24}]);
  await q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine',$1,$2,24,'provider_credits')",[op,'dealmachine:search:'+op]);
 }
 return {account,rate,op};
}
try{
 await pg.exec(read('tests/fixtures/account-work-repair.sql'));
 await pg.exec(read('tests/fixtures/acquisition-settlement-isolation-foundation.sql'));
 const parallel=read('config/parallel-work-throughput.sql');
 await pg.exec(parallel.slice(parallel.indexOf('create schema if not exists icash_work_private;'),parallel.indexOf('do $patch$')));
 for(const f of definitions){await pg.exec(f.definition);assert.equal(await one('select md5(pg_get_functiondef($1::regprocedure))',[f.signature]),f.hash);}
 await pg.exec(`create function icash_settle_estimated_operation(p_operation text) returns boolean language sql as $$select public.icash_settle_estimate_before_sms_tokens(p_operation)$$;`);
 const originalSweep=read('config/opportunity-queue.sql');
 await pg.exec(originalSweep.slice(originalSweep.indexOf('create function public.icash_settle_pending_dealmachine()'),originalSweep.indexOf('revoke all on function public.icash_pending_opportunity_count')));
 await pg.exec('revoke all on function public.icash_next_acquisition() from public;grant execute on function public.icash_next_acquisition() to service_role;update icash_work_private.dispatch_policy set enabled=true;');
 const bad=await seed(1,{malformed:true}),good=await seed(2),unknown=await seed(3,{receipt:false});
 await q("insert into icash_accounts(id,owner_user_id,bot_paused) values($1,$1,false)",[id(4)]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)',[id(4)]);
 await q("insert into icash_discovery_configs(account_id,enabled,auto_enabled,next_run_at,data_rights_until,contacts_enabled,rate_id,exhausted,max_open_prospects) values($1,true,true,now()-interval '1 minute',now()+interval '1 day',false,$2,false,10)",[id(4),good.rate]);
 const original=await one("select pg_get_functiondef('icash_next_acquisition()'::regprocedure)");
 const metadata=await one("select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'securityDefiner',prosecdef) from pg_proc where oid='icash_next_acquisition()'::regprocedure");
 await assert.rejects(one('select icash_next_acquisition()'),e=>e.code==='22P02','One malformed historical receipt aborts selection before any other account');
 assert.equal(await one('select count(*)::int from icash_automation_tickets'),0);
 const before=await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o');
 await pg.exec(migration);
 assert.deepEqual(await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o'),before);
 assert.deepEqual(await one("select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'securityDefiner',prosecdef) from pg_proc where oid='icash_next_acquisition()'::regprocedure"),metadata);
 const replacement=migration.match(/replacement text:=\$replacement\$([\s\S]*?)\$replacement\$/)[1];
 assert.equal(await one("select pg_get_functiondef('icash_next_acquisition()'::regprocedure)"),original.replace(' perform public.icash_settle_pending_dealmachine();',replacement),'Every selection, budget, ordering, eligibility and lock statement remains identical');
 await isolated(async()=>{
  const issued=await one('select icash_next_acquisition()');assert(issued?.token);
  assert.equal(await one('select account_id from icash_automation_tickets where token=$1',[issued.token]),id(4));
  assert.deepEqual(await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o'),before,'Issuing independent work never clears the bad or unknown hold');
 });
 for(const gate of ['update icash_accounts set bot_paused=true where id=\''+id(4)+"'",'update icash_operating_budget set enabled=false','update fixture_acquisition set quota=false','update fixture_acquisition set search_due=false','update icash_wallets set reserved_cents=balance_cents'])await isolated(async()=>{await pg.exec(gate);assert.equal(await one('select icash_next_acquisition()'),null,gate);});
 await isolated(async()=>{await pg.exec('update icash_work_private.dispatch_policy set enabled=false');await assert.rejects(one('select icash_next_acquisition()'),e=>e.code==='22P02','Legacy dispatcher retains its original settlement path');});
 // Prove the removed dependency is not called even if it would block or time out.
 await isolated(async()=>{await pg.exec(`create or replace function icash_settle_pending_dealmachine() returns integer language plpgsql as $$begin raise exception using errcode='57014',message='synthetic stuck settlement';end$$;`);assert((await one('select icash_next_acquisition()'))?.token);});
 // Original durable orphan discovery and the actual recovery service retain
 // the account-scoped collector and real DealMachine observed-credit adapter.
 const {db}=databaseAdapter(pg);
 const {processAutomationFollowup}=await loadService('lib/automation-followup-service.ts',{
  readVoiceUsagePolicies:()=>[],reconcileLiveConversation:async()=>assert.fail('No provider calls'),
  settlePendingVoiceUsage:async()=>({settled:0,held:0,reviewRequired:0}),
  dispatchCustomerUpdate:async()=>assert.fail('Receipt-only work sends no notice'),
  dispatchAttentionNotification:async()=>assert.fail('Receipt-only work sends no notice'),
 });
 for(const expected of [bad,good,unknown]){
  const token=await one("select icash_issue_account_followup()->>'token'");assert(token);
  const ticket=(await q("update icash_automation_tickets set state='consumed' where token=$1 returning id,account_id",[token])).rows[0];
  assert.equal(ticket.account_id,expected.account);
  await processAutomationFollowup(db,ticket.account_id,ticket.id);
 }
 assert.equal(await one('select state from icash_operation_spend where operation_key=$1',[bad.op]),'dispatched');
 assert.equal(await one('select state from icash_operation_spend where operation_key=$1',[unknown.op]),'dispatched');
 assert.equal(await one('select charged_cents from icash_operation_spend where operation_key=$1',[good.op]),80,'Recovery charges actual 24 observed credits using original 3x data and 2x overhead');
 assert.equal(await one('select count(*)::int from icash_credit_ledger'),1);
 assert.equal(await one('select balance_cents from icash_wallets where account_id=$1',[bad.account]),1000);
 assert.equal(await one('select balance_cents from icash_wallets where account_id=$1',[unknown.account]),1000);
 assert.equal(await one('select requested_version=completed_version from icash_work_private.account_followups where account_id=$1',[good.account]),true);
 for(const expected of [bad,unknown])assert.equal(await one('select count(*)::int from icash_work_private.account_followups where account_id=$1',[expected.account]),1,'Held operations retain independent recovery memory');
 await assert.rejects(pg.exec(migration),/prerequisite changed/);await pg.exec('rollback');
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'public.icash_next_acquisition()','execute')",[role]),false);
 const files=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(f=>f.endsWith('_acquisition_settlement_isolation.sql'));assert.equal(files.length,1);assert.equal(read('supabase/migrations/'+files[0]),migration);
 console.log('PASS acquisition settlement isolation: reproduce one bad receipt stopping all acquisition; independent selection continues; original locks/gates/ACL preserved; legacy fallback; durable account recovery settles verified original credits and retains unknown holds. Offline only.');
}finally{await pg.close();}
