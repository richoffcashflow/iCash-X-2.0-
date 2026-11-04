import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261104200000_confirmed_billing_queue_drain.sql');
const q=async s=>(await db.query(s)).rows;
const value=async s=>(await q(s))[0]?.v;
const claim=()=>value('select icash_claim_outbound_billing() v');
const seed=(n,settled=true,charge=16)=>value(`select fixture_billing_seed(${n},${settled},${charge}) v`);
const reset=()=>db.exec('truncate icash_outbound_billing_private.queue,icash_live_conversations,icash_operation_spend,icash_credit_reservations,icash_cost_manifests,icash_credit_ledger cascade');
const finance=()=>value(`select jsonb_build_object('operations',(select jsonb_agg(to_jsonb(x) order by operation_key) from icash_operation_spend x),'reservations',(select jsonb_agg(to_jsonb(x) order by id) from icash_credit_reservations x),'manifests',(select jsonb_agg(to_jsonb(x) order by operation_key) from icash_cost_manifests x),'ledger',(select jsonb_agg(to_jsonb(x) order by event_key) from icash_credit_ledger x),'calls',(select jsonb_agg(to_jsonb(x) order by id) from icash_live_conversations x)) v`);
try{
 await db.exec(read('tests/fixtures/outbound-billing-drain.sql'));
 await db.exec(read('config/outbound-billing-queue.sql'));
 const settled=await seed(1),unfinished=await seed(2,false);
 assert.equal((await claim())[0].call_id,settled,'Reproduce settled entry consuming the sole recovery turn');
 await db.exec('update icash_outbound_billing_private.queue set state=\'pending\',attempts=0,lease_token=null,lease_expires_at=null');
 const before=await finance();await db.exec(migration);
 assert.equal((await claim())[0].call_id,unfinished);
 assert.equal(await value(`select state v from icash_outbound_billing_private.queue where call_id='${settled}'`),'completed');
 assert.deepEqual(await finance(),before,'Queue cleanup must never mutate money or original calls');
 await reset();await db.exec('select fixture_billing_seed(n) from generate_series(1,101) n');
 assert.equal((await claim()).length,1);
 assert.equal(await value("select count(*)::int v from icash_outbound_billing_private.queue where state='completed'"),100,'Only 100 receipts may be cleared per claim');
 await reset();const zero=await seed(1,true,0);assert.deepEqual(await claim(),[]);
 assert.equal(await value(`select state v from icash_outbound_billing_private.queue where call_id='${zero}'`),'completed');
 for(const corrupt of ["delete from icash_credit_ledger","update icash_credit_ledger set delta_cents=-1","update icash_credit_reservations set settled_cents=1","update icash_cost_manifests set actual_micros=1","update icash_cost_manifests set evidence_ref='wrong'","update icash_live_conversations set state='waiting'","update icash_operation_spend set account_id='00000000-0000-4000-8000-000000999998'"]){
  await reset();const id=await seed(1);await db.exec(corrupt);const snapshot=await finance();
  assert.equal((await claim())[0].call_id,id,corrupt);assert.deepEqual(await finance(),snapshot);
 }
 await reset();const leased=await seed(1,false);const job=(await claim())[0];await seed(2);
 await db.exec("update icash_outbound_billing_private.queue set state='review' where attempts=0");
 assert.deepEqual(await claim(),[]);assert.deepEqual(await value(`select to_jsonb(q) v from icash_outbound_billing_private.queue q where call_id='${leased}'`),job,'Active lease remains untouched');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(claim(),/permission denied/);await db.exec('reset role');}
 await reset();await seed(1);await db.exec('set role service_role');assert.deepEqual(await claim(),[]);await db.exec('reset role');
 await assert.rejects(db.exec(migration),/claim changed/);await db.exec('rollback');
 console.log('PASS bounded billing drain: starvation reproduction, full canonical ledger guards, zero/positive settlement, 100-row bound, unchanged finance, active leases/review and private ACLs. Offline only.');
}finally{await db.close();}
