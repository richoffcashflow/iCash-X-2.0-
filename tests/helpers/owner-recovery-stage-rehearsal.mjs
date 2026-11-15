import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {recoveryStages} from './owner-expired-ticket-fixture.mjs';

// Run against an already initialized disposable checking fixture. The history
// shape/counts come from production; identities and evidence are synthetic.
export async function rehearseRecoveryStageUpgrade(db,{stepSql,continuationSql,checkingSql},hooks={}){
 const value=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
 const constraint=()=>value("select jsonb_build_object('definition',pg_get_constraintdef(oid),'md5',md5(pg_get_constraintdef(oid)),'validated',convalidated,'noInherit',connoinherit) from pg_constraint where conrelid='public.icash_owner_enrichment_recoveries'::regclass and conname='icash_owner_enrichment_recoveries_code_stage_check'");
 const history=()=>value("select jsonb_agg(to_jsonb(r) order by operation_key) from public.icash_owner_enrichment_recoveries r where reviewed_source='Synthetic original recovery stage fixture'");
 const stage1=()=>value('select to_jsonb(p) from icash_work_private.preflight_step_policy p');
 const ledger=()=>value('select jsonb_agg(to_jsonb(l) order by version) from public.fixture_release_ledger l');
 const absent=async()=>{
  for(const relation of ['icash_research_private.expired_preflight_ticket_policy','icash_research_private.expired_preflight_ticket_continuations','icash_research_private.expired_checking_policy'])assert.equal(await value('select to_regclass($1)',[relation]),null);
  assert.equal(await value("select to_regprocedure('public.icash_continue_expired_owner_preflight_ticket()')"),null);
  assert.equal(await value("select exists(select 1 from pg_trigger where tgname='continued_owner_preflight_creation' and not tgisinternal)"),false);
 };
 assert.deepEqual(await constraint(),Object.fromEntries(['definition','md5','validated','noInherit'].map(k=>[k,recoveryStages[k]])));
 assert.equal(createHash('sha256').update(stepSql).digest('hex'),'978e90303616e9fed5dfc18e69c920a66e0910d9d0654c85f941a7b8f10075af','Already installed stage-one bytes must not change');
 let n=60000;
 for(const [stage,count] of Object.entries(recoveryStages.rowsByStage))for(let i=0;i<count;i++){
  const c=await value('select fixture_expired_ticket_seed($1)',[n++]);
  await db.query(`insert into public.icash_owner_enrichment_recoveries
   (operation_key,ticket_id,account_id,screening_id,expected_ticket_hash,expected_screening_hash,reviewed_source,reviewed_source_hash,code_stage,approved_max_charge_cents)
   values($1,$2,$3,$4,repeat('a',64),repeat('b',64),'Synthetic original recovery stage fixture',repeat('c',64),$5,105)`,[`owners:${c.account}:${c.screening}`,c.ticket,c.account,c.screening,stage]);
 }
 const originalHistory=await history(),originalConstraint=await constraint();
 assert.equal(originalHistory.length,86);
 assert.deepEqual(await value('select jsonb_object_agg(code_stage,n) from(select code_stage,count(*)::int n from icash_owner_enrichment_recoveries group by code_stage)s'),recoveryStages.rowsByStage);
 await db.exec('create table public.fixture_release_ledger(version text primary key,canonical_file text not null);');
 // Production committed stage one while disabled. All subsequent failures
 // below leave that exact installation and ledger receipt in place.
 await db.exec("begin;"+stepSql+"insert into public.fixture_release_ledger values('20261115063438','20261115000614_owner_preflight_step_capacity.sql');commit;");
 const installedStep=await stage1(),installedLedger=await ledger();
 assert.equal(installedStep.enabled,false);assert.equal(installedStep.release_sha,null);assert.equal(installedStep.activated_at,null);
 const unchanged=async()=>{
  assert.deepEqual(await history(),originalHistory,'Historical recovery approvals remain byte-for-byte unchanged');
  assert.deepEqual(await stage1(),installedStep,'Committed disabled stage one survives');
 };
 await hooks.beforeStageTwo?.();await unchanged();await absent();
 // Reject predecessor drift, including the right expression left unvalidated.
 for(const suffix of [" or code_stage='unreviewed_recovery'",'']){
  await db.exec('begin');
  const definition=suffix?originalConstraint.definition.slice(0,-1)+suffix+')':originalConstraint.definition+' NOT VALID';
  await db.exec('alter table public.icash_owner_enrichment_recoveries drop constraint icash_owner_enrichment_recoveries_code_stage_check, add constraint icash_owner_enrichment_recoveries_code_stage_check '+definition);
  await assert.rejects(db.exec(continuationSql),/Original recovery stage constraint changed/);
  await db.exec('rollback');await unchanged();await absent();
 }
 // Reproduce the actual omitted-variant failure with all 86 historical rows.
 const omitted=continuationSql.replace("'owner_preview_local_record_rejection_v1',",'');
 assert.notEqual(omitted,continuationSql);
 await db.exec('begin');await assert.rejects(db.exec(omitted),error=>error.code==='23514');await db.exec('rollback');
 await unchanged();await absent();assert.deepEqual(await constraint(),originalConstraint);assert.deepEqual(await ledger(),installedLedger);
 // A successful corrected schema change must still roll back if its ledger
 // write fails; retry starts at stage two without reinstalling stage one.
 await db.exec('begin');await db.exec(continuationSql);
 await assert.rejects(db.exec("insert into public.fixture_release_ledger values('20261115063438','simulated duplicate ledger failure')"),error=>error.code==='23505');
 await db.exec('rollback');await unchanged();await absent();assert.deepEqual(await constraint(),originalConstraint);assert.deepEqual(await ledger(),installedLedger);
 await db.exec("begin;"+continuationSql+"insert into public.fixture_release_ledger values('20261115000635','20261115000635_owner_expired_preflight_ticket_continuation.sql');commit;");
 await unchanged();
 const stage2=await value('select to_jsonb(p) from icash_research_private.expired_preflight_ticket_policy p');
 await db.exec('begin');await db.exec(checkingSql);
 await assert.rejects(db.exec("insert into public.fixture_release_ledger values('20261115000635','simulated stage-three ledger failure')"),error=>error.code==='23505');
 await db.exec('rollback');await unchanged();
 assert.equal(await value("select to_regclass('icash_research_private.expired_checking_policy')"),null);
 assert.deepEqual(await value('select to_jsonb(p) from icash_research_private.expired_preflight_ticket_policy p'),stage2);
 await db.exec("begin;"+checkingSql+"insert into public.fixture_release_ledger values('20261115002841','20261115002841_owner_expired_checking_continuation.sql');commit;");
 await unchanged();assert.equal((await ledger()).length,3);
 for(const table of ['icash_work_private.preflight_step_policy','icash_research_private.expired_preflight_ticket_policy','icash_research_private.expired_checking_policy'])assert.equal(await value('select enabled from '+table),false);
 const actualConstraint=await constraint();assert.equal(actualConstraint.validated,true);assert.equal(actualConstraint.noInherit,false);
 for(const stage of [...Object.keys(recoveryStages.rowsByStage),'owner_preview_expired_known_list_v1'])assert(actualConstraint.definition.includes("'"+stage+"'::text"));
 await assert.rejects(db.exec("update icash_owner_enrichment_recoveries set approved_max_charge_cents=106 where reviewed_source='Synthetic original recovery stage fixture'"),/immutable/);
 await assert.rejects(db.exec("delete from icash_owner_enrichment_recoveries where reviewed_source='Synthetic original recovery stage fixture'"),/immutable/);
 assert.deepEqual(await history(),originalHistory);
}
