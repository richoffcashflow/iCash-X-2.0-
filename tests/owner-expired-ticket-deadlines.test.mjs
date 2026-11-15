import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {baseSql,stepSql,continuationSql,checkingSql,read} from './helpers/owner-expired-checking-fixture.mjs';
const pg=new PGlite(),q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const migration=read('supabase/migrations/20261115131828_owner_expired_ticket_deadlines.sql');
const signature='public.icash_continue_expired_owner_preflight_ticket()';
const definition=()=>v('select pg_get_functiondef($1::regprocedure)',[signature]);
const policies=()=>v("select jsonb_build_object('base',to_jsonb(b),'checking',to_jsonb(c),'step',to_jsonb(s)) from icash_research_private.expired_preflight_ticket_policy b,icash_research_private.expired_checking_policy c,icash_work_private.preflight_step_policy s");
const run=()=>v('select public.icash_continue_expired_owner_preflight_ticket()');
const isolate=async fn=>{await pg.exec('begin');try{return await fn();}finally{await pg.exec('rollback');}};
const originals=()=>v("select jsonb_build_object('tickets',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_automation_tickets t),'preflights',(select jsonb_agg(to_jsonb(p) order by id) from icash_research_private.owner_export_preflights p),'requests',(select jsonb_agg(to_jsonb(r) order by id) from icash_research_private.requests r),'recoveries',(select jsonb_agg(to_jsonb(r) order by ticket_id) from public.icash_owner_enrichment_recoveries r),'journals',(select jsonb_agg(to_jsonb(j) order by ticket_id) from icash_research_private.expired_preflight_ticket_continuations j))");
// Relative synthetic deadlines only. No production identities or cohort data.
const seed=async(n,{checking=false,ageMinutes=120,deadlineSeconds=600}={})=>{
 const c=await v(`select public.${checking?'fixture_expired_checking_seed':'fixture_expired_ticket_seed'}($1)`,[n]);
 await pg.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
 await q("update icash_research_private.owner_export_preflights set created_at=now()-make_interval(mins=>$2) where id=$1",[c.preflight,ageMinutes]);
 await pg.exec('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable');
 await q('update public.icash_automation_tickets set owner_preview_retry_until=now()+make_interval(secs=>$2) where id=$1',[c.ticket,deadlineSeconds]);
 assert.equal(await v('select icash_research_private.expired_preflight_ticket_current($1,$2)',[c.ticket,c.preflight]),true,'Synthetic original is eligible');
 return c;
};
const cohort=async()=>{
 const sources=[];
 for(let i=0;i<12;i++)sources.push(await seed(16000+i,{checking:i%2===1,ageMinutes:120+i,deadlineSeconds:30+i*60}));
 return sources;
};
const collect=async(sources)=>{
 const order=[];
 for(let i=0;i<sources.length;i++){
  const result=await run();assert.equal(result.status,'continued');order.push(result.ticketId);
  assert.equal(await v('select count(*)::int from icash_research_private.expired_preflight_ticket_continuations'),i+1,'Exactly one success per invocation');
 }
 assert.equal((await run()).status,'idle');return order;
};
try{
 await pg.exec(baseSql);await pg.exec('begin;'+stepSql+continuationSql+checkingSql+'commit;');
 assert.equal(migration,read('config/owner-expired-ticket-deadlines.sql'));
 // Disabled installation preserves all three policy states, and still allows
 // their original one-time activation with the updated exact manifests.
 await isolate(async()=>{
  const before=await policies();await pg.exec(migration);const after=await policies();
  for(const name of ['base','checking'])assert.deepEqual({...after[name],function_hashes:before[name].function_hashes},before[name]);
  assert.deepEqual(after.step,before.step);assert.equal((await run()).status,'disabled');
  for(const sql of ["select icash_work_private.activate_preflight_step_capacity(repeat('b',40))","select icash_research_private.activate_expired_preflight_ticket_continuation(repeat('b',40))","select icash_research_private.activate_expired_checking_continuation(repeat('b',40))"])assert.equal(await v(sql),true);
 });
 for(const sql of ["select icash_work_private.activate_preflight_step_capacity(repeat('b',40))","select icash_research_private.activate_expired_preflight_ticket_continuation(repeat('b',40))","select icash_research_private.activate_expired_checking_continuation(repeat('b',40))"])assert.equal(await v(sql),true);
 const originalDefinition=await definition(),originalPolicies=await policies();
 assert.equal(await v('select md5($1)',[originalDefinition]),'dc82846a6166fefbd3fbe782035f0875');
 await isolate(async()=>{
  const sources=await cohort(),order=await collect(sources);
  assert.deepEqual(order,sources.toReversed().map(c=>c.ticket),'Reproduce original source-age FIFO');
  const missed=order.filter((id,turn)=>turn*60>=30+sources.findIndex(c=>c.ticket===id)*60);
  assert.equal(missed.length,6,'At unchanged one-minute cadence FIFO loses feasible original deadlines even without contention');
 });
 // A late migration-ledger error must roll both exact manifests and definition back.
 await pg.exec('begin');await pg.exec(migration);
 await assert.rejects(pg.exec('select 1/0 as migration_ledger_failure'),/division by zero/);await pg.exec('rollback');
 assert.equal(await definition(),originalDefinition);assert.deepEqual(await policies(),originalPolicies);
 for(const mutation of [
  "update icash_research_private.expired_preflight_ticket_policy set function_hashes=function_hashes-'public.icash_membership_work_allowed(uuid)'",
  "update icash_research_private.expired_checking_policy set function_hashes=function_hashes||jsonb_build_object('public.icash_defer_owner_enrichment(uuid,uuid,uuid,text,text)','wrong')",
  "alter table public.icash_credit_reservations disable trigger icash_owner_recovery_credit_guard",
  "alter table icash_research_private.expired_preflight_ticket_continuations disable trigger expired_checking_proof_capture",
  "update icash_research_private.expired_preflight_ticket_policy set trigger_hashes=(trigger_hashes-'icash_owner_recovery_credit_guard')||jsonb_build_object('expired_checking_proof_capture',(select trigger_hashes->'expired_checking_proof_capture' from icash_research_private.expired_checking_policy))",
  "create or replace function public.icash_continue_expired_owner_preflight_ticket() returns jsonb language sql as $$select '{\"status\":\"idle\"}'::jsonb$$",
 ]){
  await pg.exec('begin');await pg.exec(mutation);await assert.rejects(pg.exec(migration),/Expired-ticket deadline/,mutation);await pg.exec('rollback');
  assert.equal(await definition(),originalDefinition);assert.deepEqual(await policies(),originalPolicies);
 }
 const historic=await seed(16999);assert.equal((await run()).ticketId,historic.ticket);
 const originalHistory=await originals();await pg.exec('begin;'+migration+'commit;');
 assert.deepEqual(await originals(),originalHistory,'Installation does not rewrite any ticket, receipt, recovery or journal');
 const updatedPolicies=await policies(),updatedHash=await v('select md5($1)',[await definition()]);
 for(const name of ['base','checking']){
  assert.equal(updatedPolicies[name].function_hashes[signature],updatedHash);
  assert.deepEqual({...updatedPolicies[name],function_hashes:{...updatedPolicies[name].function_hashes,[signature]:originalPolicies[name].function_hashes[signature]}},originalPolicies[name]);
 }
 assert.deepEqual(updatedPolicies.step,originalPolicies.step);
 await isolate(async()=>{
  // Keep pre-existing history while checking the exact one-call success delta.
  const sources=await cohort(),count=await v('select count(*)::int from icash_research_private.expired_preflight_ticket_continuations'),order=[];
  const before=await originals();
  for(let i=0;i<sources.length;i++){
   const result=await run();assert.equal(result.status,'continued');order.push(result.ticketId);
   assert.equal(await v('select count(*)::int from icash_research_private.expired_preflight_ticket_continuations'),count+i+1);
  }
  assert.deepEqual(order,sources.map(c=>c.ticket));
  assert(order.every((id,turn)=>turn*60<30+sources.findIndex(c=>c.ticket===id)*60),'Same one-minute cadence can reach every immutable deadline');
  assert.equal((await run()).status,'idle');const after=await originals();
  assert.deepEqual(after.preflights,before.preflights);assert.deepEqual(after.requests,before.requests);
  for(const ticket of before.tickets){
   const next=after.tickets.find(t=>t.id===ticket.id);
   assert.deepEqual({...next,outcome:ticket.outcome,owner_preview_retry_after:ticket.owner_preview_retry_after},ticket,'Only the original allowed retry fields change');
  }
 });
 await isolate(async()=>{
  const retryFirst=await seed(16100,{deadlineSeconds:120}),sourceFirst=await seed(16101,{checking:true,ageMinutes:1439,deadlineSeconds:600});
  assert.equal((await run()).ticketId,sourceFirst.ticket,'The original 24-hour source window wins over a later retry deadline');
  assert.equal((await run()).ticketId,retryFirst.ticket);
 });
 await isolate(async()=>{
  const first=await seed(16110),second=await seed(16111);
  const expected=(await q('select t.id from public.icash_automation_tickets t join icash_research_private.owner_export_preflights p on p.account_id=t.account_id where t.id=any($1::uuid[]) order by p.created_at,p.id,t.id',[[first.ticket,second.ticket]])).rows.map(r=>r.id);
  assert.equal((await run()).ticketId,expected[0]);assert.equal((await run()).ticketId,expected[1]);
 });
 await isolate(async()=>{
  const c=await seed(16120),p=await v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]);
  // A second historical exact pair is fixture-only. Restore every original
  // trigger before invoking the real selector; one ticket still gets one journal.
  await pg.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_generation_immutable');
  const copy={...p,id:'90000000-0000-4000-8000-000000016120',generation:2};
  await q('insert into icash_research_private.owner_export_preflights select (jsonb_populate_record(null::icash_research_private.owner_export_preflights,$1::jsonb)).*',[JSON.stringify(copy)]);
  await pg.exec('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_generation_immutable');
  assert.equal((await run()).ticketId,c.ticket);assert.equal((await run()).status,'idle');
  assert.equal(await v('select count(*)::int from icash_research_private.expired_preflight_ticket_continuations where ticket_id=$1',[c.ticket]),1);
 });
 for(const mutation of [
  c=>q('update public.icash_accounts set bot_paused=true where id=$1',[c.account]),
  ()=>q('update public.fixture_cleanup_policy set member=false'),
  c=>q('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account]),
  c=>q('update public.icash_automation_tickets set owner_preview_retry_until=now() where id=$1',[c.ticket]),
  c=>q('update public.icash_automation_tickets set prospecting_quote_cents=104 where id=$1',[c.ticket]),
  c=>q('insert into icash_private.provider_costs values($1)',[`owners:${c.account}:${c.screening}`]),
 ])await isolate(async()=>{const c=await seed(16130);await mutation(c);const before=await originals();assert.equal((await run()).status,'idle');assert.deepEqual(await originals(),before);});
 await isolate(async()=>{await seed(16140);await pg.exec('update icash_research_private.expired_preflight_ticket_policy set enabled=false');assert.equal((await run()).status,'disabled');});
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,$2,'execute')",[role,signature]),false);
 assert.equal(await v("select has_function_privilege('service_role',$1,'execute')",[signature]),true);
 assert.equal(await v('select count(*)::int from public.icash_operation_spend'),0);
 console.log('PASS original-ticket deadline ordering: reproduced FIFO loss, feasible unchanged cadence, both immutable deadlines, guarded migration/ledger rollback, policy provenance, duplicate pairs, exclusions and no provider work.');
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{await pg.close();}
