import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {fixtureSql,stepPrerequisites,stepSql,continuationSql as sql,read} from './helpers/owner-expired-ticket-fixture.mjs';
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const run=()=>v('select icash_continue_expired_owner_preflight_ticket()');
const seed=n=>v('select fixture_expired_ticket_seed($1)',[n]);
const rows=c=>v('select jsonb_build_object(\'ticket\',to_jsonb(t),\'preflight\',to_jsonb(p)) from icash_automation_tickets t,icash_research_private.owner_export_preflights p where t.id=$1 and p.id=$2',[c.ticket,c.preflight]);
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
const activate=()=>v("select icash_research_private.activate_expired_preflight_ticket_continuation(repeat('b',40))");
try{
 await pg.exec(fixtureSql+stepPrerequisites);
 assert.equal(sql,read('config/owner-expired-preflight-ticket-continuation.sql'));
 assert.equal(stepSql,read('config/owner-preflight-step-capacity.sql'));
 await pg.exec('begin;'+stepSql+'commit;');
 assert.equal(await v("select icash_work_private.activate_preflight_step_capacity(repeat('c',40))"),true);
 const originalConstraint=await v("select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.icash_owner_enrichment_recoveries'::regclass and conname='icash_owner_enrichment_recoveries_code_stage_check'");
 await pg.exec('begin');
 await pg.exec(sql);
 await assert.rejects(pg.exec("select 1/0 as simulated_migration_ledger_failure"),/division by zero/);
 await pg.exec('rollback');
 assert.equal(await v("select to_regclass('icash_research_private.expired_preflight_ticket_policy')"),null);
 assert.equal(await v("select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.icash_owner_enrichment_recoveries'::regclass and conname='icash_owner_enrichment_recoveries_code_stage_check'"),originalConstraint,'Late ledger failure rolls back the recovery constraint too');
 await pg.exec('begin;'+sql+'commit;');
 const c=await seed(7101),before=await rows(c);
 assert.equal(await v('select icash_enrichment_candidate($1)',[c.account]),null,'Reproduce a current original source hidden behind a generic held ticket');
 assert.equal(await v('select icash_research_private.owner_preflight_cleanup_current($1,$2)',[c.account,c.preflight]),true);
 assert.equal((await run()).status,'disabled');assert.deepEqual(await rows(c),before);
 for(const mutation of [
  "update icash_research_private.expired_preflight_ticket_policy set function_hashes=function_hashes-'public.icash_owner_enrichment_unstarted(uuid,uuid,text)'",
  "update icash_research_private.expired_preflight_ticket_policy set function_hashes=(function_hashes-'public.icash_owner_enrichment_unstarted(uuid,uuid,text)')||jsonb_build_object('public.icash_enrichment_candidate(uuid)',md5(pg_get_functiondef('public.icash_enrichment_candidate(uuid)'::regprocedure)))",
  "alter table public.icash_credit_reservations disable trigger icash_owner_recovery_credit_guard",
  "alter table public.icash_operation_spend disable trigger icash_owner_recovery_spend_guard",
  "alter table icash_research_private.owner_export_preflights disable trigger continued_owner_preflight_creation",
  "alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_generation_immutable",
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await activate(),false);});
 assert.equal(await v('select icash_research_private.activate_expired_preflight_ticket_continuation(null)'),false);
 assert.equal(await activate(),true);assert.equal(await activate(),false,'Activation is one-time');
 assert.equal((await run()).status,'continued');
 const after=await rows(c);
 assert.deepEqual(after.preflight,before.preflight,'No source timestamps, receipt, list, generation or cleanup state changes');
 for(const field of ['id','token','screening_id','account_id','state','created_at','completed_at','expires_at','owner_preview_deferrals','owner_preview_retry_until','owner_preview_screening_hash'])assert.deepEqual(after.ticket[field],before.ticket[field],field);
 assert.equal(after.ticket.outcome,'owner_preview_rate_limited');
 assert.equal(await v('select icash_enrichment_candidate($1)',[c.account]),c.screening);
 assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(c.items),JSON.stringify(c.request)])).status,'cleanup_required','Expired list remains unusable');
 assert.equal((await run()).status,'idle','Original ticket cannot be reopened twice');
 const source=items=>v('select icash_continued_owner_preflight($1,$2,$3,false)',[c.account,c.screening,JSON.stringify(items)]);
 assert.equal((await source(c.items)).status,'bound');
 assert.deepEqual((await source(c.items)).items,c.items,'Resume the exact original audience before a fresh property preview');
 assert.equal((await source([])).status,'held','A journal mismatch never falls through to a new audience');
 const changedItems=c.items.map(item=>({...item,ids:['per_999999']})),changedRequest={...c.request,people_ids:['per_999999']};
 for(const disable of [false,true])await isolated(async()=>{
  if(disable)await pg.exec('update icash_research_private.expired_preflight_ticket_policy set enabled=false');
  await assert.rejects(v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(changedItems),JSON.stringify(changedRequest)]),/Original continued preflight cleanup required/);
 });

 await isolated(async()=>{await pg.exec('update icash_research_private.expired_preflight_ticket_policy set enabled=false');assert.equal((await source(c.items)).status,'bound','Rollback stops new repairs, never releases existing source binding');});
 await isolated(async()=>{
  await pg.exec('update icash_research_private.expired_preflight_ticket_policy set enabled=false');
  const deletion=await v('select icash_claim_owner_preflight_cleanup($1)',[c.preflight]);
  assert.equal(await v('select icash_record_owner_preflight_cleanup($1,$2,$3)',[c.preflight,deletion.token,JSON.stringify({httpStatus:200,raw:{data:{deleted:true}},rawText:'{"data":{"deleted":true}}'})]),true);
  assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(changedItems),JSON.stringify(changedRequest)])).status,'create','After canonical cleanup, original normal fresh work is allowed even with policy disabled');
 });


 assert.equal(await v('select count(*)::int from icash_research_private.requests'),0,'Ticket continuation uses no provider quota or transport');
 assert.equal(await v('select count(*)::int from icash_operation_spend'),0,'No paid operation is introduced');
 const journal=await v('select to_jsonb(j) from icash_research_private.expired_preflight_ticket_continuations j where ticket_id=$1',[c.ticket]);
 assert.deepEqual(journal.before_ticket,before.ticket);assert.deepEqual(journal.preflight,before.preflight);assert.equal(journal.approved_max_charge_cents,105);
 const operation=`owners:${c.account}:${c.screening}`;
 await assert.rejects(q("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status) values($1,$2,106,'reserved')",[c.account,operation]),/approval exceeded/);
 await isolated(async()=>{
  const credit=await v("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status) values($1,$2,105,'reserved') returning id",[c.account,operation]);
  await pg.exec('savepoint overspend');
  await assert.rejects(q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until) values($1,$2,$3,$4,106,0,now()+interval '1 hour')",[operation,c.account,c.rate,credit]),/approval exceeded/);
  await pg.exec('rollback to overspend');
  await q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until) values($1,$2,$3,$4,105,0,now()+interval '1 hour')",[operation,c.account,c.rate,credit]);
 });
 await q('update icash_operation_rates set charge_cents=106 where id=$1',[c.rate]);
 assert.equal(await v('select icash_owner_enrichment_retry_current($1,$2)',[c.account,c.screening]),false,'Immutable current continuation cap blocks a later rate increase');
 const mutations=[
  c=>q('update icash_accounts set bot_paused=true where id=$1',[c.account]),
  ()=>q('update fixture_cleanup_policy set member=false'),
  c=>q('update icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account]),
  c=>q("update icash_automation_tickets set owner_preview_deferrals=8 where id=$1",[c.ticket]),
  c=>q("update icash_automation_tickets set owner_preview_retry_until=now() where id=$1",[c.ticket]),
  c=>q("update icash_automation_tickets set outcome='held_for_reconciliation' where id=$1",[c.ticket]),
  c=>q("update icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[c.screening]),
  c=>q("update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"prop_999\"') where id=$1",[c.screening]),
  c=>q("insert into icash_private.provider_costs values($1)",[`owners:${c.account}:${c.screening}`]),
  c=>q("insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine',$1,'SYNTHETIC uncertain paid receipt',0,'provider_credits')",[`owners:${c.account}:${c.screening}:people`]),
  c=>q('update icash_automation_tickets set prospecting_quote_cents=104 where id=$1',[c.ticket]),
 ];
 for(let i=0;i<mutations.length;i++)await isolated(async()=>{
  const c=await seed(7200+i),before=await rows(c);await mutations[i](c);
  assert.equal((await run()).status,'idle',`Guard ${i}`);
  assert.equal(await v('select count(*)::int from icash_research_private.expired_preflight_ticket_continuations where ticket_id=$1',[c.ticket]),0);
  assert.equal((await rows(c)).ticket.outcome,i===5?'held_for_reconciliation':before.ticket.outcome);
 });
 // Existing global cleanup may win before this maintenance lane. Original
 // terminal evidence permits ordinary renewal; an uncertain receipt never does.
 for(const success of [false,true])await isolated(async()=>{
  const c=await seed(success?7301:7302),original=(await rows(c)).preflight;
  const claim=await v('select icash_claim_owner_preflight_cleanup($1)',[c.preflight]);
  assert(claim);
  const receipt=success?{httpStatus:200,raw:{data:{deleted:true}},rawText:'{"data":{"deleted":true}}'}:{httpStatus:null,raw:{},rawText:'{}'};
  assert.equal(await v('select icash_record_owner_preflight_cleanup($1,$2,$3)',[c.preflight,claim.token,JSON.stringify(receipt)]),success);
  assert.equal((await run()).status,success?'continued':'idle');
  const p=(await rows(c)).preflight;assert.equal(p.created_at,original.created_at);assert.equal(p.generation,original.generation);
  if(success){assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(c.items),JSON.stringify(c.request)])).status,'create');
   assert.equal(await v('select count(*)::int from icash_research_private.owner_export_preflights where supersedes=$1',[c.preflight]),1);}
 });
 await isolated(async()=>{const c=await seed(7401);await pg.exec('update icash_research_private.expired_preflight_ticket_policy set enabled=false');assert.equal((await run()).status,'disabled');assert.equal((await rows(c)).ticket.outcome,'held');});
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'icash_continue_expired_owner_preflight_ticket()','execute')",[role]),false);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'icash_research_private.activate_expired_preflight_ticket_continuation(text)','execute')",[role]),false);
  assert.equal(await v("select has_table_privilege($1,'icash_research_private.expired_preflight_ticket_continuations','update')",[role]),false);
 }
 await assert.rejects(q('delete from icash_research_private.expired_preflight_ticket_continuations'),/immutable/);
 console.log('PASS expired ticket continuation: hidden-source reproduction, original identity/TTL, terminal deletion race, uncertain hold, unchanged limits, immutable journal/cap, no paid work, permissions and rollback.');
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{await pg.close();}
