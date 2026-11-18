import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {threeTouchFixtureSql,threeTouchMigrations,read} from './helpers/three-touch-fixture.mjs';
const pg=await PGlite.create(),q=(s,p=[])=>pg.query(s,p),value=async(s,p=[])=>Object.values((await q(s,p)).rows[0]??{})[0];
const account='00000000-0000-4000-8000-000000000001',contact='00000000-0000-4000-8000-000000000002',screen='00000000-0000-4000-8000-000000000003';
const thread=randomUUID(),first=randomUUID(),second=randomUUID(),correction=read('config/three-touch-text-settlement.sql');
const signature='public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)';
const current=(message=null)=>value('select icash_seller_text_cadence_current($1,$2,$3,true)',[account,thread,message]);
const catchup=()=>value('select icash_prepare_unanswered_seller_texts()');
const prepare=gap=>value('select icash_prepare_seller_recovery($1,$2)',[account,gap]);
let cases=0;
async function scenario(name,fn){await pg.exec('begin');try{await fn();cases++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await pg.exec('rollback');}}
async function originals(){return value(`select jsonb_build_object(
 'messages',(select jsonb_agg(to_jsonb(m) order by id) from icash_text_messages m where id in ($1,$2)),
 'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o))`,[first,second]);}
try{
 assert.equal(correction,read('supabase/migrations/20261116210750_three_touch_text_settlement.sql'));
 await pg.exec(threeTouchFixtureSql()+'begin;'+threeTouchMigrations()+'commit;');
 assert.equal(await value('select md5(pg_get_functiondef($1::regprocedure))',[signature]),'03b79c28737302d81e96658e09bedf2b');
 await q("insert into icash_text_threads(id,account_id,deal_id,recipient,sender,party,operational_contact_id,eligibility_until,paused,manual_only,ai_mode) values($1,$2,$1,'+12145550123','+17205550100','seller',$3,now()+interval '10 hours',false,false,'auto')",[thread,account,contact]);
 await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft','{}')",[thread,account,screen]);
 for(const [id,age] of [[first,'12 hours'],[second,'6 hours']]){
  await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,provider_id,body,created_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered',$1::uuid::text,'Would you consider a cash offer?',now()-$4::interval,now()-$4::interval)",[id,thread,account,age]);
  await q("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) values('text:'||$1::uuid::text,$2,'settled',now()-$3::interval)",[id,account,age]);
 }
 await q("insert into icash_seller_recovery_attempts(account_id,thread_id,message_id,reason,assigned_at,delivered_at) values($1,$2,$3,'no_response',now()-interval '6 hours',now()-interval '6 hours')",[account,thread,second]);
 await scenario('predecessor queues third SMS despite unresolved introduction cost',async()=>{
  await q('update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=true,three_touch_activated_at=now()');
  await q("update icash_operation_spend set state='dispatched' where operation_key='text:'||$1::uuid::text",[first]);
  assert.equal(await current(),true);assert.equal(await catchup(),1);
  assert.ok(await prepare(await value('select id from icash_seller_gaps')));
 });
 await scenario('activated policy cannot receive inactive rollout correction',async()=>{
  await q('update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=true,three_touch_activated_at=now()');
  await assert.rejects(pg.exec(correction),/requires inactive rollout/);
 });
 await scenario('source drift rejects the forward correction',async()=>{
  const definition=await value('select pg_get_functiondef($1::regprocedure)',[signature]);
  await pg.exec(definition.replace('begin','begin\n -- deliberately changed source'));
  await assert.rejects(pg.exec(correction),/prerequisite changed/);
 });
 const before=await originals();
 const metadata=()=>q("select proowner,prolang,prosecdef,provolatile,proparallel,proconfig,proacl,prorettype from pg_proc where oid=$1::regprocedure",[signature]);
 const originalMetadata=await metadata();
 await pg.exec('begin;'+correction+'commit;');
 assert.deepEqual(await originals(),before,'forward migration preserves original messages and operation evidence');
 assert.deepEqual(await metadata(),originalMetadata,'forward migration preserves owner, stability, security, search_path and ACL');
 await q('update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=true,three_touch_activated_at=now()');
 const changes=[
  ['dispatched introduction',"update icash_operation_spend set state='dispatched' where operation_key='text:'||$1::uuid::text",first],
  ['unknown introduction state',"update icash_operation_spend set state=null where operation_key='text:'||$1::uuid::text",first],
  ['missing introduction ledger',"delete from icash_operation_spend where operation_key='text:'||$1::uuid::text",first],
  ['wrong-account introduction ledger',"update icash_operation_spend set account_id=gen_random_uuid() where operation_key='text:'||$1::uuid::text",first],
  ['unsettled reminder',"update icash_operation_spend set state='dispatched' where operation_key='text:'||$1::uuid::text",second],
 ];
 for(const [name,sql,id] of changes){
  await scenario(name+' blocks discovery of another cold reminder',async()=>{
   await q(sql,[id]);assert.equal(await current(),false);assert.equal(await catchup(),0);
   assert.equal(await value('select count(*)::int from icash_text_messages'),2);
  });
  await scenario(name+' blocks preparation after a gap already exists',async()=>{
   assert.equal(await catchup(),1);const gap=await value('select id from icash_seller_gaps');
   await q(sql,[id]);const prior=await originals();assert.equal(await prepare(gap),null);
   assert.deepEqual(await originals(),prior,'rejection does not settle, delete or replay original evidence');
  });
 }
 await scenario('all settled originals permit one third text and exclude its current operation',async()=>{
  const prior=await originals();assert.equal(await current(),true);assert.equal(await catchup(),1);
  const gap=await value('select id from icash_seller_gaps'),third=await prepare(gap);assert.ok(third);
  assert.equal(await prepare(gap),null);assert.deepEqual(await originals(),prior);
  await q("update icash_text_messages set state='dispatching',provider_id='current-in-flight' where id=$1",[third]);
  await q("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) values('text:'||$1::uuid::text,$2,'dispatched',now())",[third,account]);
  assert.equal(await current(third),true,'current message is excluded from its own prior-cost check');
  assert.equal(await current(),false,'a later fourth message remains blocked');
 });
 await scenario('enabled three-touch also blocks second text on unresolved first',async()=>{
  await q('delete from icash_seller_recovery_attempts where message_id=$1',[second]);
  await q('delete from icash_text_messages where id=$1',[second]);
  await q("delete from icash_operation_spend where operation_key='text:'||$1::uuid::text",[second]);
  await q("update icash_operation_spend set state='dispatched' where operation_key='text:'||$1::uuid::text",[first]);
  assert.equal(await current(),false);
  await q('update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=false');
  assert.equal(await current(),true,'inactive legacy second-text behavior is preserved');
 });
 console.log(`PASS three-touch text settlement: ${cases} scenarios; predecessor reproduced, all prior costs settled, missing/wrong-account evidence fails closed, late changes blocked, legacy behavior and originals preserved.`);
}catch(e){console.error(e.message,e.cause?.message??'');process.exitCode=1;}finally{await pg.close();}
