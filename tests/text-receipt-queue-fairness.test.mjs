import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),one=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const claim=()=>one('select icash_claim_text_delivery_rechecks()');
const reset=()=>pg.exec('update icash_text_receipt_private.control set next_run_at=now()');
try{
 await pg.exec(read('tests/fixtures/text-delivery-recovery-base.sql'));
 await pg.exec(read('tests/fixtures/text-delivery-recovery-observers.sql'));
 for(const x of JSON.parse(read('tests/fixtures/text-delivery-recovery-triggers.json')))await pg.exec(x.function_definition+';'+x.definition+';');
 for(const path of ['config/text-delivery-recovery.sql','config/text-delivery-source-binding.sql','config/text-delivery-tracking.sql','tests/fixtures/text-receipt-fairness-seed.sql'])await pg.exec(read(path));
 await pg.exec('select fixture_receipt_seed(100,200);select fixture_receipt_seed(1000,200,1)');
 const beforeClaim=await one("select pg_get_functiondef('icash_claim_text_delivery_rechecks()'::regprocedure)");
 const beforeFinish=await one("select pg_get_functiondef('icash_finish_text_delivery_recheck(uuid,jsonb)'::regprocedure)");
 // Reproduce the actual starvation ordering without changing permanent evidence.
 await pg.exec('begin');
 assert((await claim()).every(j=>Number(j.request.id.slice(-12))<1000),'Original claim selects only fresh work despite 200 due checks');
 await pg.exec('rollback');
 const originalSchedule=await one('select jsonb_agg(to_jsonb(s) order by message_id) from icash_text_receipt_private.schedule s');
 const originalControl=await one('select to_jsonb(c) from icash_text_receipt_private.control c');
 const patch=read('config/text-receipt-queue-fairness.sql');
 assert.equal(patch,read('supabase/migrations/20261103064558_text_receipt_queue_fairness.sql'));
 await pg.exec(patch);
 assert.deepEqual(await one('select jsonb_agg(to_jsonb(s) order by message_id) from icash_text_receipt_private.schedule s'),originalSchedule,'Migration cannot reset retry counters/deadlines');
 assert.deepEqual(await one('select to_jsonb(c) from icash_text_receipt_private.control c'),originalControl,'Migration cannot reset global read quota');
 const afterClaim=await one("select pg_get_functiondef('icash_claim_text_delivery_rechecks()'::regprocedure)");
 assert.equal(afterClaim.split(' for candidate in\n')[0],beforeClaim.split(' for candidate in\n')[0],'Same lock and global quota');
 assert.equal(afterClaim.split('\n loop')[1],beforeClaim.split('\n loop')[1],'Same request shape, count and backoff writes');
 assert.equal(await one("select pg_get_functiondef('icash_finish_text_delivery_recheck(uuid,jsonb)'::regprocedure)"),beforeFinish,'Finalizer is untouched');
 const originalSpend=await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o');
 const dueSeen=new Set(),freshSeen=new Set(),accounts=new Set();
 for(let round=0;round<24;round++){
  // New accepted work keeps arriving. Neither class may lose its bounded share.
  await pg.exec(`select fixture_receipt_seed(${10000+round*4},4)`);await reset();
  const jobs=await claim();assert.equal(jobs.length,3);assert.deepEqual(await claim(),[],'No extra same-minute batch');
  const due=jobs.filter(j=>j.request.id>=id(1000)&&j.request.id<id(1200));
  assert(due.length>=1&&due.length<=2,'Both nonempty classes receive a slot');
  for(const job of jobs){
   assert.deepEqual(Object.keys(job.request).sort(),['id','account_id','thread_id','provider_id','body','attachments','created_at','sender','recipient','operation'].sort());
   accounts.add(job.request.account_id);
   (due.includes(job)?dueSeen:freshSeen).add(job.request.id);
   assert.equal(await one('select icash_finish_text_delivery_recheck($1,$2)',[job.id,{source:'contiguity_canonical_get',message:{status:504}}]),'held','Timeout evidence stays held, not changed by helper columns');
  }
 }
 assert(dueSeen.size>=24&&freshSeen.size>=24);assert.equal(accounts.size,12);
 assert.deepEqual(await one("select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o where operation_key<('text:'||$1)",[id(10000)]),originalSpend);
 assert.equal(await one('select count(*) from icash_text_threads where not paused'),0);
 assert.equal(await one("select count(*) from icash_text_messages where state<>'accepted'"),0);
 assert.equal(await one('select count(*) from icash_text_events'),0);
 console.log('PASS receipt queue fairness: sustained 200+ fresh/due cohorts, twelve accounts, bounded three/minute, exact request shape and held timeout evidence; unchanged finalizer and finances.');
}finally{await pg.close();}
