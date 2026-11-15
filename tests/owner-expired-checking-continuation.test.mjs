import assert from 'node:assert/strict';
import{PGlite}from'@electric-sql/pglite';
import{baseSql,stepSql,continuationSql,checkingSql,read}from'./helpers/owner-expired-checking-fixture.mjs';
const p=new PGlite(),q=(s,a=[])=>p.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const seed=n=>v('select fixture_expired_checking_seed($1)',[n]);
const run=()=>v('select icash_continue_expired_owner_preflight_ticket()');
const isolate=async fn=>{await p.exec('begin');try{await fn();}finally{await p.exec('rollback');}};
const activate=()=>v("select icash_research_private.activate_expired_checking_continuation(repeat('b',40))");
const proof=c=>v('select icash_research_private.expired_checking_original_proof($1)',[c.preflight]);
const uuid=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
try{
 await p.exec(baseSql);
 assert.equal(checkingSql,read('config/owner-expired-checking-continuation.sql'));
 await p.exec('begin;'+stepSql+continuationSql+'commit;');
 const before=await v("select function_hashes from icash_research_private.expired_preflight_ticket_policy");
 await p.exec('begin;'+checkingSql);
 await assert.rejects(p.exec('select 1/0 as late_migration_ledger_failure'),/division by zero/);await p.exec('rollback');
 assert.equal(await v("select to_regclass('icash_research_private.expired_checking_policy')"),null);
 assert.deepEqual(await v('select function_hashes from icash_research_private.expired_preflight_ticket_policy'),before);
 await p.exec('begin;'+checkingSql+'commit;');
 const c=await seed(11101),original=await v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]);
 assert(await proof(c));
 assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(c.items),JSON.stringify(c.request)])).status,'held','Exact denied eligible handler cannot resume after its validity expires');
 assert.equal(await v('select icash_research_private.owner_preflight_cleanup_current($1,$2)',[c.account,c.preflight]),false,'Reproduce waiting-only cleanup boundary');
 assert.equal((await run()).status,'disabled');
 assert.equal(await v("select icash_work_private.activate_preflight_step_capacity(repeat('b',40))"),true);
 assert.equal(await v("select icash_research_private.activate_expired_preflight_ticket_continuation(repeat('b',40))"),true);
 assert.equal((await run()).status,'idle','Disabled checking overlay cannot journal or admit its family');
 await isolate(async()=>{
  await p.exec("create or replace function icash_research_private.expired_checking_original_proof(p_id uuid) returns jsonb language plpgsql stable as $$begin raise exception 'disabled checking proof must not run';end$$");
  assert.equal((await run()).status,'idle','Disabled checking predicate returns before expensive source proof');
  const waiting=await v('select fixture_expired_ticket_seed(11199)');
  assert.equal((await run()).ticketId,waiting.ticket,'Existing waiting-family continuation still works with the overlay disabled');
  assert.equal(await v('select count(*)::int from icash_research_private.expired_checking_proofs'),0);
 });
 for(const mutation of [
  "update icash_research_private.expired_checking_policy set function_hashes=function_hashes-'icash_research_private.expired_checking_original_proof(uuid)'",
  "alter table icash_research_private.owner_preflight_quota_deferrals disable trigger owner_preflight_quota_immutable",
  "alter table icash_research_private.expired_preflight_ticket_continuations disable trigger expired_checking_proof_capture",
  "alter table icash_research_private.owner_export_preflights disable trigger continued_owner_preflight_creation",
  "alter table public.icash_credit_reservations disable trigger icash_owner_recovery_credit_guard",
  "alter table public.icash_operation_spend disable trigger icash_owner_recovery_spend_guard",
 ])await isolate(async()=>{await p.exec(mutation);assert.equal(await activate(),false);});
 assert.equal(await activate(),true);assert.equal(await activate(),false);
 assert.equal((await run()).ticketId,c.ticket);
 assert.deepEqual(await v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]),original,'No timestamp extension or baseline replay');
 assert.equal(await v('select count(*)::int from icash_research_private.expired_checking_proofs'),1);
 assert.equal(await v('select denial_request_id from icash_research_private.expired_checking_proofs where preflight_id=$1',[c.preflight]),c.denial);
 await assert.rejects(q("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status)values($1,$2,106,'reserved')",[c.account,`owners:${c.account}:${c.screening}`]),/approval exceeded/);
 assert.equal(await v('select count(*)::int from icash_research_private.requests'),2,'Repair adds no request or cost');
 const source=await v('select icash_continued_owner_preflight($1,$2,$3,false)',[c.account,c.screening,JSON.stringify(c.items)]);
 assert.equal(source.status,'bound');assert.equal(source.cleanupRequired,true);assert.deepEqual(source.items,c.items);
 await isolate(async()=>{
  const before=await v('select to_jsonb(t) from icash_automation_tickets t where id=$1',[c.ticket]);
  await q("update icash_automation_tickets set state='consumed',created_at=now(),expires_at=now()+interval '2 minutes',completed_at=null where id=$1",[c.ticket]);
  assert.equal(await v('select icash_defer_expired_checking_cleanup($1,$2,$3,$4,$5,$6)',[c.ticket,c.account,c.screening,before.token,`owners:${c.account}:${c.screening}`,c.preflight]),true,'Known pre-admission contention uses exact current checking-source witness');
  const after=await v('select to_jsonb(t) from icash_automation_tickets t where id=$1',[c.ticket]);
  assert.equal(after.outcome,'owner_preview_rate_limited');assert.equal(after.owner_preview_deferrals,before.owner_preview_deferrals+1);
  assert.equal(after.owner_preview_retry_until,before.owner_preview_retry_until,'Busy wait preserves original retry deadline');
 });
 const admission=id=>v('select icash_admit_expired_checking_cleanup($1,$2,$3)',[c.account,c.preflight,id]);
 await isolate(async()=>{await p.exec('update fixture_cleanup_policy set quota=false');assert.equal((await admission(uuid(1))).status,'quota_wait');assert.equal(await v('select cleanup_attempts from icash_research_private.owner_export_preflights where id=$1',[c.preflight]),0);});
 await isolate(async()=>{await q('update icash_accounts set bot_paused=true where id=$1',[c.account]);assert.equal((await admission(uuid(2))).status,'held');});
 await isolate(async()=>{await q("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result)values($1,'owner_preview',$2,$3,true,null)",[uuid(3),c.account,`owner-preflight:${c.preflight}:eligible`]);assert.equal(await proof(c),null);assert.equal((await admission(uuid(4))).status,'held');});
 const admitted=await admission(uuid(5));assert.equal(admitted.status,'admitted');
 assert.equal(await v('select icash_defer_expired_checking_cleanup($1,$2,$3,$4,$5,$6)',[c.ticket,c.account,c.screening,'unknown',`owners:${c.account}:${c.screening}`,c.preflight]),false,'An admitted/unknown DELETE cannot become a pre-admission retry');
 assert.equal((await admission(uuid(6))).status,'held','Unknown original deletion cannot be retried by this continuation');
 assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(c.items),JSON.stringify(c.request)])).status,'held');
 await p.exec('update icash_research_private.expired_checking_policy set enabled=false;update icash_research_private.expired_preflight_ticket_policy set enabled=false;');
 const changedItems=c.items.map(i=>({...i,ids:['per_999999']})),changedRequest={...c.request,people_ids:['per_999999']};
 await assert.rejects(v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(changedItems),JSON.stringify(changedRequest)]),/Original continued preflight cleanup required/);
 assert.equal(await v('select icash_record_owner_preflight_cleanup($1,$2,$3)',[c.preflight,admitted.token,JSON.stringify({httpStatus:200,raw:{data:{deleted:true}},rawText:'{"data":{"deleted":true}}'})]),true);
 assert.equal((await v('select icash_continued_owner_preflight($1,$2,$3,false)',[c.account,c.screening,JSON.stringify(c.items)])).cleanupRequired,false);
 assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(c.items),JSON.stringify(c.request)])).status,'create','Canonical deletion permits ordinary fresh generation, including after rollback');
 assert.equal(await v('select count(*)::int from icash_operation_spend'),0);
 await p.exec('update icash_research_private.expired_checking_policy set enabled=true;update icash_research_private.expired_preflight_ticket_policy set enabled=true;');
 const d=await seed(11102);
 const mutations=[
  ["update icash_automation_tickets set prospecting_quote_cents=104 where id=$1",[d.ticket]],
  ["update icash_automation_tickets set outcome=null where id=$1",[d.ticket]],
  ["update icash_research_private.requests set admitted=null where id=$1",[d.denial]],
  ["update icash_research_private.requests set admitted=true where id=$1",[d.denial]],
  ["update icash_research_private.requests set result='{}' where id=$1",[d.denial]],
  ["update icash_research_private.requests set operation_key='wrong' where id=$1",[d.denial]],
  ["update icash_research_private.requests set finished_at=now() where id=$1",[d.denial]],
  ["update icash_research_private.requests set result='{}' where id=$1",[d.baseline]],
  ["update icash_research_private.requests set finished_at=null where id=$1",[d.baseline]],
  ["update icash_accounts set bot_paused=true where id=$1",[d.account]],
  ["update fixture_cleanup_policy set member=false",[]],
  ["update icash_wallets set reserved_cents=balance_cents where account_id=$1",[d.account]],
  ["update icash_discovery_configs set contacts_enabled=false where account_id=$1",[d.account]],
  ["update icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[d.screening]],
  ["insert into icash_private.provider_costs values($1)",[`owners:${d.account}:${d.screening}`]],
  ["insert into icash_cost_observations(provider,event_key,source_ref,amount,units)values('dealmachine',$1,'SYNTHETIC uncertain original',0,'provider_credits')",[`owners:${d.account}:${d.screening}:people`]],
  ["update icash_automation_tickets set owner_preview_retry_until=now()-interval '1 second' where id=$1",[d.ticket]],
 ];
 for(const [sql,args] of mutations)await isolate(async()=>{await q(sql,args);assert.equal(await v('select icash_research_private.expired_preflight_ticket_current($1,$2)',[d.ticket,d.preflight]),false,sql);});
 await isolate(async()=>{await p.exec('alter table icash_research_private.owner_preflight_quota_deferrals disable trigger owner_preflight_quota_immutable');await q("update icash_research_private.owner_preflight_quota_deferrals set receipts_hash='changed' where preflight_id=$1",[d.preflight]);assert.equal(await proof(d),null);});
 await isolate(async()=>{await p.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');await q("update icash_research_private.owner_export_preflights set created_at=now()-interval '29 minutes',started_at=now()-interval '6 minutes' where id=$1",[d.preflight]);assert.equal(await proof(d),null);});
 // Global canonical cleanup may win before the journal; no second DELETE.
 const global=await v('select icash_claim_owner_preflight_cleanup($1)',[d.preflight]);
 assert.equal(await v('select icash_record_owner_preflight_cleanup($1,$2,$3)',[d.preflight,global.token,JSON.stringify({httpStatus:404,raw:{error:'not found'},rawText:'{"error":"not found"}'})]),true);
 assert.equal((await run()).ticketId,d.ticket);
 assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[d.account,JSON.stringify(d.items),JSON.stringify(d.request)])).status,'create');
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'icash_admit_expired_checking_cleanup(uuid,uuid,uuid)','execute')",[role]),false);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await v("select has_function_privilege($1,'icash_research_private.activate_expired_checking_continuation(text)','execute')",[role]),false);
  assert.equal(await v("select has_table_privilege($1,'icash_research_private.expired_checking_proofs','update')",[role]),false);
 }
 await assert.rejects(q('delete from icash_research_private.expired_checking_proofs'),/immutable/);
 console.log('PASS expired checking: exact source denial, disabled staging, canonical cleanup, fresh renewal, unknown cost holds, rollback fence and atomic ledger.');
}finally{await p.close();}
