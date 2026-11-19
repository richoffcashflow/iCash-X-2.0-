import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {assertDisposablePostgresTarget} from './helpers/disposable-postgres-target.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
let pg,admin,Client,fixture;
const native=process.env.ICASH_PAYMENT_RECOVERY_NATIVE==='1';
const connection={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',ssl:false,connectionTimeoutMillis:5000};
if(native){
 ({Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'));
 admin=new Client({...connection,database:'icash_reliability'});await admin.connect();await assertDisposablePostgresTarget(admin);
 fixture='icash_recovery_'+randomUUID().replaceAll('-','');await admin.query('create database '+fixture);
 pg=new Client({...connection,database:fixture});await pg.connect();
}else pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args),exec=sql=>native?pg.query(sql):pg.exec(sql),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const account='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000003';
const claim=async()=> (await one("select icash_claim_auto_recharge($1,'live') v",[account])).v;
const fail=async(t,kind='temporary')=>{await q('update icash_auto_recharge_attempts set stripe_payment_id=$1 where id=$2',['pi_'+t.id.replaceAll('-',''),t.id]);await q('select icash_record_recharge_failure($1,$2,$3,$4)',[t.id,'pi_'+t.id.replaceAll('-',''),kind,'fixture']);};
const ready=()=>q("update icash_auto_recharges set last_attempt_at=now()-interval '2 days',next_retry_at=now()-interval '1 second'");
try{
 await exec(read('tests/fixtures/payment-recovery-foundation.sql'));await exec(read('tests/fixtures/payment-recovery-predecessors.sql'));
 const migration=read('config/payment-recovery.sql');
 await exec('begin');await exec(migration);await exec('rollback');assert.equal((await one("select to_regclass('icash_payment_recoveries') v")).v,null,'Installation rolls back atomically');
 await exec('begin');await exec(migration);await exec('commit');
 assert.equal((await one('select enabled from icash_payment_recovery_settings')).enabled,false);
 let t=await claim();assert(t);await fail(t);assert.equal((await one('select enabled from icash_auto_recharges')).enabled,false,'Disabled rollout retains prior fail-stop behavior');
 await exec("update icash_payment_recovery_settings set enabled=true;update icash_auto_recharges set enabled=true,recovery_failures=0,recovery_started_at=null,issue=null;delete from icash_payment_recoveries;");await ready();
 for(let n=1;n<=5;n++){
  t=await claim();assert(t);await fail(t);await fail(t);
  const r=await one('select *,extract(epoch from (next_retry_at-now())) seconds from icash_auto_recharges');
  assert.equal(r.recovery_failures,n,'Repeated failures are idempotent');assert.equal(r.enabled,n<5);
  if(n<5){assert(Math.abs(Number(r.seconds)-[0,86400,86400,172800,259200][n])<5);assert.equal(await claim(),null,'No early retry');await ready();}
 }
 assert.equal(await claim(),null,'Retry exhaustion stays off');assert.equal(Number((await one('select count(*) n from icash_payment_recoveries')).n),1,'One case across a retry sequence');
 await exec("update icash_auto_recharges set enabled=true,recovery_failures=0,recovery_started_at=null;delete from icash_payment_recoveries;");await ready();
 t=await claim();await fail(t,'authentication');assert.equal((await one('select enabled from icash_auto_recharges')).enabled,false);
 await exec("update icash_auto_recharges set enabled=true,recovery_failures=0,recovery_started_at=null");await ready();t=await claim();
 await exec("update icash_auto_recharges set enabled=false,issue=null");await fail(t);assert.equal((await one('select enabled from icash_auto_recharges')).enabled,false,'Manual off survives failure');
 await exec("update icash_auto_recharges set enabled=true,recovery_failures=0;update icash_accounts set bot_paused=true");await ready();assert.equal(await claim(),null);
 await exec("update icash_accounts set bot_paused=false;update icash_memberships set cancel_at_period_end=true");assert.equal(await claim(),null);
 await exec("update icash_memberships set cancel_at_period_end=false");t=await claim();await fail(t);await ready();
 await exec("update icash_payment_recovery_settings set enabled=false");assert.equal(await claim(),null,'Recovery switch stops retries');
 await exec("update icash_payment_recovery_settings set enabled=true");t=await claim();
 await q("select icash_settle_auto_recharge($1,'pi_paid',2500,'cus_fixture','pm_fixture','live')",[t.id]);await q("select icash_settle_auto_recharge($1,'pi_paid',2500,'cus_fixture','pm_fixture','live')",[t.id]);
 assert.equal(Number((await one('select balance_cents from icash_wallets')).balance_cents),2500,'Duplicate settlement credits once');assert.equal((await one('select recovery_failures from icash_auto_recharges')).recovery_failures,0);
 assert.equal((await one("select state from icash_payment_recoveries order by created_at desc limit 1")).state,'recovered');
 // Messaging uses an existing invoice, original consent and shared recipient/sender limits.
 await q("select icash_register_invoice_recovery('membership',$1,$2,'in_fixture',5000,now()-interval '2 days')",[member,account]);
 const c=(await q('select * from icash_claim_payment_recoveries()')).rows[0];assert(c);
 const send=(channel='email',step=0)=>one('select icash_claim_payment_recovery_message($1,$2,$3,$4,$5,$6::jsonb) v',[c.id,c.lease_token,channel,step,'fixture@example.invalid',JSON.stringify({text:'Original immutable fixture message'})]);
 assert.equal((await one('select icash_claim_payment_recovery_message($1,null,\'email\',0,\'fixture@example.invalid\',\'{}\') v',[c.id])).v,null);
 const delivery=(await send()).v;assert(delivery);assert.equal((await send()).v,null,'Concurrent/duplicate scheduler cannot replay email immediately');
 await exec("update icash_payment_recovery_deliveries set last_attempt_at=now()-interval '16 minutes'");assert.equal((await send()).v.id,delivery.id,'Uncertain email reuses original idempotency key');
 await q("select icash_payment_recovery_delivery_event($1,$2,'other@example.invalid','email.bounced')",[delivery.id,randomUUID()]);assert.equal((await one('select state from icash_payment_recovery_deliveries where id=$1',[delivery.id])).state,'sending');
 const provider=randomUUID();await q("select icash_payment_recovery_delivery_event($1,$2,'fixture@example.invalid','email.bounced')",[delivery.id,provider]);
 await q("select icash_payment_recovery_delivery_event($1,$2,'fixture@example.invalid','email.delivered')",[delivery.id,provider]);assert.equal((await one('select state from icash_payment_recovery_deliveries where id=$1',[delivery.id])).state,'suppressed','Late delivery never undoes bounce suppression');
 await exec("update icash_payment_recoveries set started_at=now()-interval '4 days'");assert.equal((await send('email',1)).v,null,'Bounce stops later reminders');
 await exec("update icash_customer_update_preferences set timezone=(select name from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1),sms_enabled=false");assert.equal((await send('sms')).v,null);
 await exec("update icash_customer_update_preferences set sms_enabled=true;update fixture_sender_room set enabled=false");assert.equal((await send('sms')).v,null,'Sender capacity is required');
 await exec("update fixture_sender_room set enabled=true;insert into icash_text_suppressions values('+12125550123')");assert.equal((await send('sms')).v,null);
 await exec("delete from icash_text_suppressions");const sms=(await send('sms')).v;assert(sms);assert.equal((await send('sms')).v,null,'Unknown SMS is never automatically replayed');assert.equal((await one("select icash_lifecycle_frequency_ok('sms','+12125550123') v")).v,false,'Other campaigns count recovery texts');
 assert.equal(Number((await one('select count(*) n from icash_sender_private.uses')).n),1);
 await exec("update icash_memberships set cancel_at_period_end=true");assert.equal((await one('select icash_payment_recovery_active($1) v',[c.id])).v,false);
 await exec('set role anon');await assert.rejects(q('select * from public.icash_payment_recoveries'),/permission denied/);await assert.rejects(q('select public.icash_claim_payment_recoveries()'),/permission denied/);await exec('reset role');
 if(native){
  // Competing claims serialize against the real PostgreSQL row locks.
  await exec("update icash_memberships set cancel_at_period_end=false;update icash_wallets set balance_cents=0;update icash_auto_recharges set enabled=true,recovery_failures=0");await ready();
  const other=new Client({...connection,database:fixture});await other.connect();
  try{
   await pg.query('begin');const first=await claim();assert(first);
   const pending=other.query("select icash_claim_auto_recharge($1,'live') v",[account]);
   await pg.query('commit');assert.equal((await pending).rows[0].v,null,'Competing worker cannot claim or charge twice');
   await pg.query('begin');await pg.query("update icash_auto_recharges set enabled=false,issue=null");
   const late=other.query("select icash_record_recharge_failure($1,$2,'temporary','insufficient_funds')",[first.id,'pi_race']);
   await pg.query('update icash_auto_recharge_attempts set stripe_payment_id=$1 where id=$2',['pi_race',first.id]);await pg.query('commit');await late;
   assert.equal((await one('select enabled from icash_auto_recharges')).enabled,false,'Concurrent manual off wins over retry recovery');
  }finally{await other.end();}
 }
 console.log('PASS payment recovery database: source-pinned atomic migration, retry schedule/cap, pause/cancel/kill switch, once-only credit, immutable email retries, SMS consent/capacity/frequency, suppression, service-only permissions'+(native?', native competing workers and manual-off race':'')+'. Fictional accounts; no providers.');
}finally{if(native){await pg.end();await admin.query('drop database '+fixture);await admin.end();}else await pg.close();}
