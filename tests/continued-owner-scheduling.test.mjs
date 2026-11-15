import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {installContinuedSchedulingFixture,seedContinued,seedOrdinary,seedLive,seedReady,issue,source,original,decisions,value,read} from './helpers/continued-owner-scheduling-fixture.mjs';
const p=new PGlite(),q=(s,a=[])=>p.query(s,a),v=(s,a=[])=>value(p,s,a);
const isolated=async fn=>{await p.exec('begin');try{return await fn();}finally{await p.exec('rollback');}};
const deadline=c=>v('select icash_work_private.continued_owner_preflight_deadline($1,$2)',[c.account,c.screening]);
const migration=()=>read('config/continued-owner-scheduling.sql');
const policy=()=>v('select to_jsonb(p) from icash_work_private.continuation_policy p where id=1');
try{
 await installContinuedSchedulingFixture(p);
 // Reproduce the reported shape with synthetic identities: one repaired and
 // canonically cleaned original remains behind 100 older ordinary accounts.
 await isolated(async()=>{
  const urgent=await seedContinued(p,32000,{deadlineMinutes:5}),ordinary=[];
  for(let n=32100;n<32200;n++)ordinary.push(await seedOrdinary(p,n));
  for(let i=0;i<100;i++){const selected=await issue(p);assert(ordinary.some(c=>c.account===selected?.account_id));}
  const last=await issue(p);assert.equal(last.id,urgent.ticket);
  assert.equal((await decisions(p)).at(-1).continuation,false,'Current scheduler loses journaled source classification');
  assert(100*4>5*60,'At a synthetic four-second interval, rank101 exceeds the immutable five-minute deadline; this fast fixture does not simulate elapsed production time');
 });
 const beforePolicy=await policy();
 for(const mutation of [
  'update icash_work_private.continuation_policy set enabled=false',
  'update icash_research_private.acquisition_headroom_policy set activated_at=null,release_sha=null',
  "update icash_work_private.preflight_step_policy set function_hashes=function_hashes-'public.icash_next_acquisition()'",
 ]){
  const beforeDefinition=await v("select pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)");
  await p.exec('begin');await p.exec(mutation);await assert.rejects(p.exec(migration()),/Continued original scheduling/);await p.exec('rollback');
  assert.equal(await v("select pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)"),beforeDefinition);
  assert.deepEqual(await policy(),beforePolicy);assert.equal(await v("select to_regprocedure('icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)')"),null);
 }
 await p.exec('begin;'+migration()+'commit;');
 await p.exec('begin;'+read('config/owner-wait-admission.sql')+'commit;');
 assert.equal(migration(),read('supabase/migrations/20261115134000_continued_owner_scheduling.sql'));
 assert.equal((await policy()).enabled,beforePolicy.enabled);assert.equal((await policy()).issued,beforePolicy.issued);
 assert.equal((await policy()).release_sha,beforePolicy.release_sha);assert.equal((await policy()).activated_at,beforePolicy.activated_at);
 await isolated(async()=>{
  const urgent=await seedContinued(p,32300,{deadlineMinutes:5}),before=await original(p,urgent),savedSource=await source(p,urgent);
  for(let n=32400;n<32500;n++)await seedOrdinary(p,n);
  assert(await deadline(urgent));
  const selected=await issue(p);assert.equal(selected.id,urgent.ticket,'The actual scheduler issues the exact original first');
  assert.equal(selected.account_id,urgent.account);assert.equal(selected.screening_id,urgent.screening);
  assert.notEqual(selected.token,before.token);assert.equal(selected.owner_preview_retry_until,before.owner_preview_retry_until);
  assert.equal(selected.owner_preview_deferrals,before.owner_preview_deferrals);assert.equal(selected.issue_attempts,before.issue_attempts);
  assert.deepEqual(await source(p,urgent),savedSource,'Issuance cannot rewrite original cleanup evidence');
  const saved=await decisions(p);assert.equal(saved.length,1);assert.equal(saved[0].ticket_id,urgent.ticket);
  assert.equal(saved[0].preflight_id,urgent.preflight);assert.equal(saved[0].continuation,true);
  assert.equal(saved[0].issue_token_hash,createHash('sha256').update(selected.token).digest('hex'));
  assert.equal(await deadline(urgent),null,'A just-issued source is no longer a held ranking candidate');
  await q('select icash_work_private.record_continuation_decision($1,$2,$3,true)',[selected.id,urgent.account,urgent.screening]);
  assert.deepEqual(await decisions(p),saved,'Identical issued-token acknowledgment consumes no second fairness turn');
  await p.exec('savepoint wrong_decision');
  await assert.rejects(q('select icash_work_private.record_continuation_decision($1,$2,$3,false)',[selected.id,urgent.account,urgent.screening]),/Continuation issuance changed/);
  await p.exec('rollback to wrong_decision');
 });
 await isolated(async()=>{
  const later=await seedContinued(p,32590,{deadlineMinutes:30});
  const urgent=await seedContinued(p,32591,{account:later.account,deadlineMinutes:5,checking:false});
  assert.equal((await issue(p)).id,urgent.ticket,'The actual property selector picks the earliest original deadline within the same account');
  assert.equal((await original(p,later)).state,'held');
 });
 await isolated(async()=>{
  const urgent=[];for(let i=0;i<6;i++)urgent.push(await seedContinued(p,32600+i,{checking:i%2===0,deadlineMinutes:10+i}));
  const ordinary=[];for(let i=0;i<6;i++)ordinary.push(await seedOrdinary(p,32700+i));
  const selected=[];for(let i=0;i<9;i++)selected.push(await issue(p));
  assert.deepEqual(selected.map(t=>urgent.some(c=>c.ticket===t.id)?'continuation':'ordinary'),['continuation','continuation','ordinary','continuation','continuation','ordinary','continuation','continuation','ordinary']);
  assert.deepEqual(selected.filter(t=>urgent.some(c=>c.ticket===t.id)).map(t=>t.id),urgent.map(c=>c.ticket),'Continuation slots follow earliest immutable deadline');
  assert.equal((await decisions(p)).length,9);assert.equal((await policy()).issued,9);
  assert(selected.filter(t=>!urgent.some(c=>c.ticket===t.id)).every(t=>ordinary.some(c=>c.account===t.account_id)));
 });
 await isolated(async()=>{
  const c=await seedContinued(p,32800);
  for(const available of [0,2]){
   await q('update public.fixture_cleanup_policy set ordinary=$1,starter=0',[available]);
   await q("update public.icash_discovery_configs set next_run_at=now()-interval '1 minute' where account_id=$1",[c.account]);
   const dueBefore=await v('select next_run_at from public.icash_discovery_configs where account_id=$1',[c.account]);
   assert.equal(await deadline(c),null,'A renewed original still needs three requests; zero/two-token capacity cannot qualify');
   assert.equal(await issue(p),null);assert.equal((await decisions(p)).length,0);
   assert.deepEqual(await v('select next_run_at from public.icash_discovery_configs where account_id=$1',[c.account]),dueBefore,'Actual acquisition headroom preserves the waiting account schedule');
  }
  await p.exec('update public.fixture_cleanup_policy set ordinary=3');
  await q("update public.icash_discovery_configs set next_run_at=now()-interval '1 minute' where account_id=$1",[c.account]);
  assert(await deadline(c));assert.equal((await issue(p)).id,c.ticket);
 });
 for(const liveFirst of [true,false])await isolated(async()=>{
  const n=liveFirst?33000:33010,journal=await seedContinued(p,n,{deadlineMinutes:liveFirst?10:5}),live=await seedLive(p,n+1,liveFirst?1:20),ordinary=await seedOrdinary(p,n+2);
  const first=await issue(p),second=await issue(p),third=await issue(p);
  assert.equal(first.id,liveFirst?live.ticket:journal.ticket,'Earlier immutable deadline wins across both live and journaled families');
  assert.equal(second.id,liveFirst?journal.ticket:live.ticket);assert.equal(third.account_id,ordinary.account);
  assert.deepEqual((await decisions(p)).map(d=>d.continuation),[true,true,false]);
 });
 await isolated(async()=>{
  const journal=await seedContinued(p,33020,{deadlineMinutes:5}),live=await seedLive(p,33021,20);
  await p.exec('update public.fixture_cleanup_policy set ordinary=2,starter=0');
  assert.equal(await deadline(journal),null);assert(await v('select public.icash_owner_preflight_due_at($1,$2)',[live.account,live.screening]));
  assert.equal((await issue(p)).id,live.ticket,'Two-token original live step remains available without authorizing a cleaned renewal');
  assert.equal((await original(p,journal)).state,'held');
 });
 for(const liveFirst of [true,false])await isolated(async()=>{
  const n=liveFirst?33030:33040,journal=await seedContinued(p,n,{deadlineMinutes:liveFirst?10:5}),live=await seedLive(p,n+1,liveFirst?1:20,journal.account);
  assert.equal((await issue(p)).id,liveFirst?live.ticket:journal.ticket,'Same-account property choice compares live and journaled deadlines');
 });
 await isolated(async()=>{
  const later=await seedLive(p,33050,20),invalid=await seedLive(p,33051,1,later.account),journal=await seedContinued(p,33052,{deadlineMinutes:5});
  await q("insert into public.icash_property_controls(account_id,property_id,manual) select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs where id=$1",[invalid.screening]);
  assert.equal(await v('select icash_work_private.live_owner_preflight_deadline($1,$2)',[invalid.account,invalid.screening]),null);
  assert.equal((await issue(p)).id,journal.ticket,'An ineligible earlier sibling cannot promote its account over a current earlier original');
 });
 for(const readyFirst of [true,false])await isolated(async()=>{
  const n=readyFirst?33060:33070,journal=await seedContinued(p,n,{deadlineMinutes:readyFirst?10:5}),ready=await seedReady(p,n+1,readyFirst?1:20);
  assert.equal(await v('select icash_research_private.owner_preflight_ready_current($1)',[ready.preflight]),true);
  assert.equal((await issue(p)).id,readyFirst?ready.ticket:journal.ticket,'READY keeps its original checked-at clock across mixed deadline ranking');
 });
 await isolated(async()=>{
  const c=await seedContinued(p,32801),o=await seedOrdinary(p,32802);
  await p.exec('update icash_work_private.continuation_policy set enabled=false');
  assert.equal((await issue(p)).account_id,o.account,'Disabling fairness restores ordinary aging');
  assert.equal((await decisions(p)).length,0);assert.equal((await original(p,c)).state,'held');
 });
 const mutations=[
  ['Pause',c=>q('update public.icash_accounts set bot_paused=true where id=$1',[c.account])],
  ['membership',()=>q('update public.fixture_cleanup_policy set member=false')],
  ['funds',c=>q('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account])],
  ['expired original deadline',c=>q('update public.icash_automation_tickets set owner_preview_retry_until=now() where id=$1',[c.ticket])],
  ['extended original deadline',c=>q("update public.icash_automation_tickets set owner_preview_retry_until=owner_preview_retry_until+interval '1 hour' where id=$1",[c.ticket])],
  ['source drift',c=>q("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"prop_changed\"') where id=$1",[c.screening])],
  ['stale screening',c=>q("update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[c.screening])],
  ['paid evidence',c=>q('insert into icash_private.provider_costs values($1)',[`owners:${c.account}:${c.screening}`])],
  ['reconciliation hold',c=>q("update public.icash_automation_tickets set outcome='held_for_reconciliation' where id=$1",[c.ticket])],
  ['rate cap',c=>q('update public.icash_operation_rates set charge_cents=106 where id=$1',[c.rate])],
  ['customer property control',c=>q("insert into public.icash_property_controls(account_id,property_id,manual) select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs where id=$1",[c.screening])],
 ];
 for(let i=0;i<mutations.length;i++)await isolated(async()=>{
  const c=await seedContinued(p,32900+i);await mutations[i][1](c);
  const before=await original(p,c),savedSource=await source(p,c);
  assert.equal(await deadline(c),null,mutations[i][0]);
  assert.equal((await decisions(p)).length,0);assert.deepEqual(await original(p,c),before);assert.deepEqual(await source(p,c),savedSource);
 });
 await isolated(async()=>{const c=await seedContinued(p,32990,{cleanup:false});assert.equal(await deadline(c),null,'Missing canonical original deletion cannot become renewal priority');});
 await isolated(async()=>{
  const c=await seedContinued(p,32991);
  assert.equal((await v('select public.icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(c.items),JSON.stringify(c.request)])).status,'create');
  assert.equal(await deadline(c),null,'An already-admitted newer generation cannot reuse its original priority');
 });
 assert.equal(await v('select count(*)::int from public.icash_operation_spend'),0);
 assert.equal(await v('select count(*)::int from public.icash_owner_contacts'),0);
 console.log('PASS actual continued-owner scheduler: rank101 reproduction and synthetic deadline projection, same-original issuance and recorder, mixed live/READY/journal deadlines, three-token capacity, two-thirds continuation/one-third ordinary fairness, immutable evidence and late guards.');
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{await p.close();}
