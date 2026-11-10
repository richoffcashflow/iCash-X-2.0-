import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function testSenderHealthRouting(f){
 const {db,q,one,account,screen,deal,recipient,sms,sender,thread,customer}=f;
 const before=JSON.parse(read('tests/fixtures/sender-health-routing-before.json'));
 const migration=read('config/sender-health-routing.sql');
 assert.equal(migration,read('supabase/migrations/20261110180400_sender_health_routing.sql'));
 await db.exec(`create schema icash_text_receipt_private;
 create table icash_text_events(id text,type text,payload jsonb);
 alter table icash_operation_spend add dispatched_at timestamptz;
 alter table icash_text_messages add last_delivery_at timestamptz;
 create table icash_seller_opener_assignments(thread_id uuid,message_id uuid,created_at timestamptz);
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select false$$;
 create table icash_seller_intakes(id uuid,assigned_account uuid,screening_id uuid,request_id uuid,phone text,state text,ai_consented boolean,contact_consent_scope text,attribution jsonb);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_optin_call_requests(lead_id uuid,request_id uuid,phone text,source text,account_id uuid,requested_by uuid,request_version text,request_reference text);`);
 await db.exec(before.health);
 const predecessor=(await one("select pg_get_functiondef('icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure) d")).d;
 const metadata=()=>one("select provolatile,prosecdef,proconfig,proacl from pg_proc where oid='icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure");
 const originalMetadata=await metadata();
 const reset=async()=>{await f.reset();await db.exec('truncate icash_text_events,icash_text_messages,icash_operation_spend,icash_seller_opener_assignments;');};
 async function delayed(phone,n){
  const t=(await one("insert into icash_text_threads(account_id,deal_id,sender,recipient,party) values($1,$2,$3,'+12025550888','seller') returning id",[account,deal,phone])).id;
  const m=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,provider_id,created_at) values($1,$2,'outgoing','accepted',$3,now()-interval '3 minutes') returning id",[account,t,'fixture-'+n])).id;
  await q("insert into icash_operation_spend(account_id,operation_key,state,dispatched_at) values($1,$2,'dispatched',now()-interval '2 minutes')",[account,'text:'+m]);
  await q("insert into icash_text_events values($1,'numbers.delayed',jsonb_build_object('id',$1::text,'type','numbers.delayed','timestamp',extract(epoch from now()-interval '1 minute'),'data',jsonb_build_object('original_number',$2::text,'affected_id',$3::text,'reason','number_temporary_unavailable')))",['event-'+n,phone,'fixture-'+n]);
  return {t,m};
 }
 // Validate the original main selector and the compatible, already installed
 // owner-demo routing variant. Both retain every original clause and its ACL.
 for(const definition of [predecessor,before.selector]){
  await db.exec(definition);await reset();
  const initial=await sms(),voice=await sender();assert(initial);
  const first=await delayed(initial,1);
  assert.equal(await sms(),initial,'Reproduce: first allocation still chooses the temporarily unavailable sender');
  const receipts=(await q('select to_jsonb(o) value from icash_operation_spend o order by operation_key')).rows;
  await db.exec(migration);await db.exec(migration);
  const alternate=await sms();assert(alternate&&alternate!==initial,'New conversations choose another eligible sender');
  assert.equal(await sender(),voice,'Independent verified voice selection is unchanged');
  await q('update icash_text_senders set enabled=false where phone=$1',[alternate]);assert.equal(await sms(),null,'Disabled alternatives cannot be enabled by failover');
  await q('update icash_text_senders set enabled=true where phone=$1',[alternate]);
  await thread(initial);assert.equal(await sms(),initial,'An established conversation never rotates to escape its hold');
  await q('delete from icash_text_threads where recipient=$1',[recipient]);
  await customer(initial);assert.equal(await sms(),initial,'Unknown earlier calling identity remains binding');
  await db.exec('truncate icash_customer_phone_calls');
  await delayed(alternate,2);assert.equal(await sms(),null,'All unavailable SMS numbers hold new work');
  assert.equal(await sender(),voice,'All-SMS unavailability does not stop independent calls');
  await q("update icash_text_messages set state='delivered',last_delivery_at=now() where id=$1",[first.m]);
  assert.equal(await sms(),null,'A late receipt for a pre-delay send cannot claim recovery');
  await q("insert into icash_text_messages(account_id,thread_id,direction,state,provider_id,created_at,last_delivery_at) values($1,$2,'outgoing','delivered','fixture-recovered',now(),now()) returning id",[account,first.t]).then(async r=>{
   await q("insert into icash_operation_spend(account_id,operation_key,state,dispatched_at) values($1,$2,'settled',now())",[account,'text:'+r.rows[0].id]);
  });
  assert.equal(await sms(),initial,'Verified delivery for post-delay work restores ordinary selection');
  await q('insert into icash_text_suppressions values($1)',[recipient]);assert.equal(await sms(),null,'Opt-out always wins over failover');
  assert.deepEqual((await q("select to_jsonb(o) value from icash_operation_spend o where state='dispatched' and operation_key=$1",['text:'+first.m])).rows,receipts,'Routing never changes the original spend receipt');
  assert.deepEqual(await metadata(),originalMetadata);
  await db.exec(definition.replace('has_thread boolean:=false','has_thread boolean:=true'));
  await assert.rejects(db.exec(migration),/Unexpected sender health routing predecessor/);await db.exec('rollback');
 }
 await db.exec(predecessor);await db.exec(migration);await reset();
 await db.exec(`create sequence fixture_health_checks;
 alter function icash_text_receipt_private.sender_opener_available(text) rename to fixture_original_sender_health;
 create function icash_text_receipt_private.sender_opener_available(text) returns boolean language plpgsql stable as $$begin
 perform nextval('public.fixture_health_checks');return icash_text_receipt_private.fixture_original_sender_health($1);end$$;`);
 const first=await sms();assert.equal((await one('select last_value from fixture_health_checks')).last_value,1,'Healthy selection checks one sender, not the whole pool');
 await sender();await thread(first);await sms();assert.equal((await one('select last_value from fixture_health_checks')).last_value,1,'Voice and established identities do not add health scans');
 await q('delete from icash_text_threads where recipient=$1',[recipient]);await delayed(first,20);
 await q("select setval('fixture_health_checks',1,false)");
 assert.notEqual(await sms(),first);assert.equal((await one('select last_value from fixture_health_checks')).last_value,2,'Each unavailable candidate is checked only once');
 console.log('PASS sender health routing: actual signed-delay policy, new eligible-number failover, all-SMS hold, independent voice, immutable identities, opt-out, verified recovery and guarded variants.');
}
