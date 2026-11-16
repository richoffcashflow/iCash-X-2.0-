import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {installPriorityFixture, value, snapshot} from './research-priority-fixture.mjs';
import {seedLive, seedReady, seedContinued, seedOrdinary} from './continued-owner-scheduling-fixture.mjs';
import {migration, signature, catalog, policy} from './collector-deadline-fixture.mjs';

const exec=(db,sql)=>db.exec?db.exec(sql):db.query(sql);
const vector=async(db,accounts)=>value(db,`with members as (
 select account_id from unnest($1::uuid[]) account_id
 union all select md5('collector-fictional-empty-'||n)::uuid from generate_series(1,351)n
), rows as (
 select account_id,public.icash_enrichment_before_prospecting_budget(account_id) candidate,
 icash_work_private.live_owner_preflight_deadline(account_id,null::uuid) deadline from members
) select jsonb_build_object('observed_at',now()::text,'rows',jsonb_agg(to_jsonb(r) order by account_id))::text from rows r`,[accounts]);
const sha=s=>createHash('sha256').update(s).digest('hex');
const receipts=db=>value(db,`select jsonb_build_object(
 'preflights',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from icash_research_private.owner_export_preflights p),
 'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.icash_automation_tickets t),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from icash_research_private.requests r),
 'decisions',(select coalesce(jsonb_agg(to_jsonb(d) order by turn),'[]'::jsonb) from icash_work_private.continuation_decisions d))`);

// Exact captured ranking/source functions on fictional records. This is NOT the
// complete operational collector or a production-cohort continuity claim.
export async function exerciseCollectorSelector(db){
 await installPriorityFixture(db);
 assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[signature]),'136f9850a750ce7883f5e0514ff6e027');
 await exec(db,'begin');
 try{
  const cases=[];
  for(const [kind,seed] of [['live',seedLive],['ready',seedReady],['continued',seedContinued],['ordinary',seedOrdinary]]){
   for(let n=0;n<3;n++)cases.push({kind,...await seed(db,97000+cases.length)});
  }
  // Synthetic fixture negatives: explicit customer pause, exhausted wallet and
  // an original retry deadline. No production evidence is read or modified.
  await db.query('update public.icash_accounts set bot_paused=true where id=$1',[cases[1].account]);
  await db.query('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[cases[4].account]);
  await db.query('update public.icash_automation_tickets set owner_preview_retry_until=now() where id=$1',[cases[7].ticket]);
  const accounts=cases.map(c=>c.account),beforeCatalog=await catalog(db),sourceBefore=await receipts(db),moneyBefore=await snapshot(db);
  const variants=[];
  for(const tokens of [0,2,3])for(const turn of [0,2]){
   await db.query('update public.fixture_cleanup_policy set ordinary=$1,starter=0',[tokens]);
   await db.query('update icash_work_private.continuation_policy set issued=$1',[turn]);
   variants.push({tokens,turn,before:await vector(db,accounts)});
  }
  const beforePolicy=await policy(db);
  await exec(db,migration);
  const afterPolicy=await policy(db),afterCatalog=await catalog(db),expected=structuredClone(beforePolicy);
  expected.continued_original_hashes[signature]=createHash('md5').update(afterCatalog.definition).digest('hex');
  assert.deepEqual(afterPolicy,expected,'Only the exact helper hash slot changes');
  const expectedCatalog={...beforeCatalog,definition:afterCatalog.definition};
  assert.deepEqual(afterCatalog,expectedCatalog,'Owner, ACL, security and volatility are unchanged');
  const results=[];
  for(const {tokens,turn,before} of variants){
   await db.query('update public.fixture_cleanup_policy set ordinary=$1,starter=0',[tokens]);
   await db.query('update icash_work_private.continuation_policy set issued=$1',[turn]);
   const after=await vector(db,accounts);
   assert.equal(after,before,`Exact ranked UUID/deadline bytes with tokens=${tokens},turn=${turn}`);
   const rows=JSON.parse(after).rows;assert.equal(rows.length,363);
   results.push({tokens,turn,rows:rows.length,nonNullCandidates:rows.filter(r=>r.candidate!==null).length,sha256:sha(after)});
  }
  assert(results.some(r=>r.nonNullCandidates>0),'Equivalence includes actual eligible candidates, not all-null output');
  assert.deepEqual(await receipts(db),sourceBefore,'Original receipts and tickets unchanged');
  const finalMoney=await snapshot(db);
  for(const k of ['budget','accounts','wallets','operations','reservations','requests'])assert.deepEqual(finalMoney[k],moneyBefore[k],k);
  return {syntheticVectors:results,scope:'captured ranked selector and helper only, not full collector'};
 }finally{await exec(db,'rollback');}
}
