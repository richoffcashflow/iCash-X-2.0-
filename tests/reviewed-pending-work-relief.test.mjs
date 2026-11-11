import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite();
const q=(s,a=[])=>db.query(s,a);
const val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const before=JSON.parse(read('tests/fixtures/reviewed-pending-work-before.json'));
const sql=read('config/reviewed-pending-work-relief.sql');
const available=(a=id(1))=>val('select icash_prospecting_total_available($1)',[a]);
const target=()=>val('select icash_daily_work_target($1)',[id(1)]);
const accounting=()=>val(`select jsonb_build_object('operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o),
 'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),'budget',(select to_jsonb(b) from icash_operating_budget b),
 'authorizations',(select jsonb_agg(to_jsonb(r) order by operation_key) from icash_credit_reservations r),'ledger',(select jsonb_agg(to_jsonb(l)) from icash_credit_ledger l))`);
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('tests/fixtures/opportunity-schema.sql'));
 // SQL functions validate their relation dependencies when installed.
 await db.exec('create table icash_prospecting_budgets(id bigint generated always as identity primary key,account_id uuid,baseline_cents bigint);');
 await db.exec(before.icash_prospecting_total_available);
 await db.exec('drop table icash_prospecting_budgets cascade;');
 await db.exec(read('tests/fixtures/reviewed-pending-work-foundation.sql'));
 for(const definition of Object.values(before))await db.exec(definition);
 await db.exec('create trigger fixture_final_guard before insert on icash_operation_spend for each row execute function icash_guard_prospecting_spend();');
 const unchanged=await accounting();
 assert.equal(Number(await available()),0);
 await db.exec(sql);
 assert.deepEqual(await accounting(),unchanged,'installation does not change money, operation state or supplier reserves');
 assert.equal(Number(await available()),0,'installed inactive');
 assert.equal((await target()).planningPendingCents,1100);
 const manifest=await val('select manifest from icash_reliability_private.pending_work_relief_policy');
 const activate=(m=manifest,sha='a'.repeat(40))=>val('select icash_reliability_private.activate_pending_work_relief($1,$2)',[m,sha]);
 await assert.rejects(activate('b'.repeat(32)),/manifest changed/);
 assert.equal((await activate()).activated,true);
 assert.equal((await activate()).activated,false,'one activation, idempotent exact retry');
 await assert.rejects(activate(manifest,'b'.repeat(40)),/another release/);
 assert.deepEqual(await accounting(),unchanged,'activation neither refunds nor settles nor releases supplier reserves');
 assert.equal(Number(await available()),900);
 assert.equal(Number(await available(id(2))),900,'other old accounts remain fully reserved');
 assert.equal(Number(await available(id(4))),0,'zero-balance account gains no credit');
 assert.equal(Number(await available(id(99))),0);
 const daily=await target();
 assert.equal(daily.pendingCents,1100);assert.equal(daily.planningPendingCents,100);assert.equal(daily.releasedPendingCents,1000);
 assert.equal(daily.remainingCents,400);assert.equal(daily.percent,50);assert.equal(daily.minimumPercent,30);
 await q("update icash_operation_spend set estimate_checked_at=now() where operation_key='old-call'");
 assert.equal(Number(await available()),900,'routine receipt check does not recreate planning hold');
 for(const update of ["charge_cap_cents=899","reserved_micros=1","account_id='"+id(2)+"'","state='reserved'","permission_until='2028-01-01'","credit_reservation_id=gen_random_uuid()"]){
  await db.exec('begin');await db.exec("update icash_operation_spend set "+update+" where operation_key='old-call'");
  assert.equal(Number(await val("select icash_reliability_private.pending_planning_cents(o) from icash_operation_spend o where operation_key='old-call'")),update.startsWith('charge_cap')?899:900,'changed original binding fails closed');
  await db.exec('rollback');
 }
 await q("update icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key='old-reserved'");
 assert.equal(Number(await available()),800,'new dispatch of an old reserved operation restores its commitment');
 await q("update icash_operation_spend set state='reserved',dispatched_at=null where operation_key='old-reserved'");
 const admit=(key,cents,a=id(1))=>val('select fixture_relief_admit($1,$2,$3)',[a,key,cents]);
 await assert.rejects(admit('paused',100,id(3)),/Bot paused/);
 await assert.rejects(admit('empty',100,id(4)),/Insufficient credits/);
 const attempts=await Promise.allSettled(Array.from({length:8},(_,n)=>admit('new-'+n,200)));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,4,'final admission bounds new commitments to real balance');
 assert.equal(Number(await available()),100);
 assert.equal(await admit('new-0',200),false,'exact existing operation is not repeated');
 assert.equal(Number(await val('select count(*) from icash_credit_reservations')),8,'rejected operations roll back credit authorizations');
 // The original delayed receipt follows unchanged production once-only billing.
 await val("select icash_finish_credit($1,'old-call',250,'SYNTHETIC original late receipt')",[id(1)]);
 await q("update icash_operation_spend set state='settled',charged_cents=250,actual_micros=100000,settled_at=now() where operation_key='old-call'");
 await val("select icash_finish_credit($1,'old-call',250,'SYNTHETIC duplicate original receipt')",[id(1)]);
 assert.equal(Number(await val('select balance_cents from icash_wallets where account_id=$1',[id(1)])),750);
 assert.equal(Number(await val('select count(*) from icash_credit_ledger')),1);
 assert.equal(Number(await available()),0,'late actual charge immediately reduces remaining capacity');
 await assert.rejects(admit('overdraw',1),/Prospecting budget reached/);
 for(const name of ['icash_guard_prospecting_spend','icash_finish_credit','icash_reserve_credit_before_owner_recovery','icash_reserve_credit']){
  assert.equal(await val('select pg_get_functiondef(oid) from pg_proc where proname=$1',[name]),before[name],'original final admission and billing functions unchanged');
 }
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await val("select has_function_privilege($1,'icash_reliability_private.activate_pending_work_relief(text,text)','execute')",[role]),false);
  for(const table of ['pending_work_relief','pending_work_relief_policy'])assert.equal(await val("select has_table_privilege($1,$2,'insert,update,delete')",[role,'icash_reliability_private.'+table]),false);
 }
 const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(p=>p.endsWith('_reviewed_pending_work_relief.sql'));
 assert.equal(sql,read('supabase/migrations/'+migration));
 console.log('PASS reviewed old planning relief: inactive install, exact frozen bindings, one-use activation, fresh holds, final admission, Pause, zero balance, late receipt billing, private ACLs and untouched supplier reserves. Offline only.');
}finally{await db.close();}
