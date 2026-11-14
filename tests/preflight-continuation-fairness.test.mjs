import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {continuationSetup} from './helpers/stalled-work-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const seed=(n,waiting=true,age='2 minutes')=>v('select fixture_preflight_seed($1,$2,$3::interval)',[n,waiting,age]);
const issue=async()=>{const result=await v('select icash_next_acquisition()');if(!result)return null;return v('select account_id from icash_automation_tickets where token=$1',[result.token]);};
async function isolated(test){await pg.exec('begin');try{await test();}finally{await pg.exec('rollback');}}
try{
 await pg.exec(continuationSetup());
 const waiting=[];for(let n=1;n<=6;n++)waiting.push(await seed(n));
 const ordinary=[];for(let n=100;n<230;n++)ordinary.push(await seed(n,false,'20 minutes'));
 await isolated(async()=>{const a=await issue();assert.ok(ordinary.some(c=>c.account===a),'Reproduce ordinary aging starving a valid 30-minute list');});
 const migration=read('config/preflight-continuation-fairness.sql');
 assert.equal(migration,read('supabase/migrations/20261114165019_preflight_continuation_fairness.sql'));
 const immutable=await v("select jsonb_agg(to_jsonb(p) order by id) from icash_research_private.owner_export_preflights p");
 await pg.exec(migration);
 assert.equal(await v('select enabled from icash_work_private.continuation_policy'),false);
 await isolated(async()=>{const a=await issue();assert.ok(ordinary.some(c=>c.account===a),'Disabled install preserves original selection');});
 const makeDue=async c=>{
  await q("update icash_automation_tickets set state='held',outcome='owner_preview_rate_limited',completed_at=now(),owner_preview_deferrals=owner_preview_deferrals+1,owner_preview_retry_after=now()-interval '1 second' where id=$1",[c.ticket]);
  await q("update icash_discovery_configs set next_run_at=now()-interval '1 second' where account_id=$1",[c.account]);
 };
 await isolated(async()=>{
  await v("select icash_work_private.activate_continuation_fairness(repeat('a',40))");
  const account=await issue(),c=waiting.find(c=>c.account===account);assert(c);
  await q('update icash_accounts set bot_paused=true where id<>$1',[account]);
  await makeDue(c);assert(await v('select icash_owner_preflight_due_at($1,$2)',[account,c.screening]));
  await assert.rejects(issue,/continuation_decisions_pkey/,'Reproduce second valid continuation aborting on the reused original ticket ID');
 });
 const issuance=read('config/preflight-continuation-issuance.sql');
 const receiptName=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_preflight_continuation_issuance.sql'));
 assert(receiptName);assert.equal(issuance,read('supabase/migrations/'+receiptName));await pg.exec(issuance);
 assert.equal(await v("select icash_work_private.activate_continuation_fairness('bad')"),false);
 assert.equal(await v("select icash_work_private.activate_continuation_fairness(repeat('a',40))"),true);
 await isolated(async()=>{
  const c=waiting[0];await q('update icash_accounts set bot_paused=true where id<>$1',[c.account]);
  await q(`insert into icash_research_private.owner_export_preflights(id,account_id,fingerprint,items,request,state,list_name,list_id,receipts,created_at,started_at,next_check_at)
   select md5('stale-overlap')::uuid,account_id,md5('stale-overlap'),items,request,'waiting','stale-overlap','"stale-overlap"','{}',now()-interval '9 minutes',now()-interval '9 minutes',now()-interval '7 minutes'
   from icash_research_private.owner_export_preflights where id=$1`,[c.preflight]);
  assert.equal(await issue(),c.account);
  assert.equal(await v('select preflight_id from icash_work_private.continuation_decisions'),c.preflight,'Decision binds the actual current source, not an older unverified overlapping list');
 });
 await isolated(async()=>{
  const account=await issue(),c=waiting.find(c=>c.account===account);assert(c);
  await q('update icash_accounts set bot_paused=true where id<>$1',[account]);
  const originals=await v('select jsonb_agg(to_jsonb(p) order by id) from icash_research_private.owner_export_preflights p');
  for(let n=0;n<2;n++){await makeDue(c);assert.equal(await issue(),account,'A normal original ticket safely continues through multiple preflight steps');}
  const saved=await v('select jsonb_agg(to_jsonb(d) order by turn) from icash_work_private.continuation_decisions d');
  assert.equal(saved.length,3);assert(saved.every(d=>d.ticket_id===c.ticket&&d.preflight_id===c.preflight));
  assert.equal(new Set(saved.map(d=>d.issue_token_hash)).size,3);
  for(let n=0;n<2;n++)await v('select icash_work_private.record_continuation_decision($1,$2,$3,true)',[c.ticket,account,c.screening]);
  assert.equal(await v('select issued from icash_work_private.continuation_policy'),3,'Identical acknowledgment does not consume a turn');
  assert.deepEqual(await v('select jsonb_agg(to_jsonb(d) order by turn) from icash_work_private.continuation_decisions d'),saved);
  assert.deepEqual(await v('select jsonb_agg(to_jsonb(p) order by id) from icash_research_private.owner_export_preflights p'),originals);
  assert.equal(await v('select count(*) from icash_operation_spend'),0);
 });
 await isolated(async()=>{
  const kinds=[];for(let n=0;n<9;n++){const a=await issue();kinds.push(waiting.some(c=>c.account===a)?'continuation':'ordinary');}
  assert.deepEqual(kinds,['continuation','continuation','ordinary','continuation','continuation','ordinary','continuation','continuation','ordinary']);
  assert.equal(await v('select count(*) from icash_work_private.continuation_decisions'),9);
  assert.equal(await v('select count(*) from icash_operation_spend'),0,'Selection never admits paid work');
  assert.deepEqual(await v('select jsonb_agg(to_jsonb(p) order by id) from icash_research_private.owner_export_preflights p'),immutable);
 });
 await isolated(async()=>{
  await pg.exec('update fixture_cleanup_policy set quota=false');assert.equal(await issue(),null);assert.equal(await v('select issued from icash_work_private.continuation_policy'),0);
 });
 await isolated(async()=>{
  await pg.exec('update fixture_cleanup_policy set check_quota=false');
  assert.equal(await v('select icash_owner_preflight_due_at($1,null::uuid)',[waiting[0].account]),null,'The existing three-request capacity gate remains authoritative');
  assert.deepEqual(await v('select jsonb_agg(to_jsonb(p) order by id) from icash_research_private.owner_export_preflights p'),immutable,'Quota waits preserve original continuations');
 });
 await isolated(async()=>{
  await pg.exec("alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable;update icash_research_private.owner_export_preflights set created_at=now()-interval '30 minutes';alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable;");
  assert.equal(await v('select icash_owner_preflight_due_at($1,null::uuid)',[waiting[0].account]),null,'Retryable ticket never revives an expired original list');
 });
 await isolated(async()=>{
  await pg.exec('update icash_work_private.continuation_policy set enabled=false');
  const a=await issue();assert.ok(ordinary.some(c=>c.account===a),'Rollback restores original aging order');
  assert.equal(await v('select count(*) from icash_work_private.continuation_decisions'),0);
 });
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'icash_work_private.activate_continuation_fairness(text)','execute')",[role]),false);
 await pg.exec('set role service_role');assert.ok(await issue());await pg.exec('reset role');
 console.log('PASS 136-account production scheduler: source-bound continuation turns, ordinary fairness, original evidence, quota waits, 30-minute expiry, disabled installation, rollback and service-role issuance.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
