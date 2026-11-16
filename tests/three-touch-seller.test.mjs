import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {threeTouchFixtureSql,threeTouchMigrations,read} from './helpers/three-touch-fixture.mjs';
const pg=await PGlite.create(),q=(s,p=[])=>pg.query(s,p),val=async(s,p=[])=>Object.values((await q(s,p)).rows[0]??{})[0];
const a='00000000-0000-4000-8000-000000000001',contact='00000000-0000-4000-8000-000000000002',screen='00000000-0000-4000-8000-000000000003',first='00000000-0000-4000-8000-000000000004';
const phone='+12145550123',thread=randomUUID(),initial=randomUUID(),secondText=randomUUID();
let cases=0;
async function scenario(name,fn){await pg.exec('begin');try{await fn();cases++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await pg.exec('rollback');}}
const queue=()=>val('select icash_queue_unanswered_seller_calls()');
const followup=parent=>val('select id from icash_voice_jobs where seller_followup_of=$1',[parent]);
const current=id=>val('select icash_seller_phone_call_current($1,$2)',[a,id]);
const texts=()=>val('select icash_seller_text_cadence_current($1,$2,null,true)',[a,thread]);
async function complete(job,hours){
 await q("update icash_voice_jobs set state='dispatched',created_at=now()-$2::interval where id=$1",[job,`${hours} hours`]);
 const rid=randomUUID(),conv=randomUUID();
 await q("insert into icash_call_recordings(id,account_id,voice_job_id,screening_id,party,operation_key,to_phone,from_phone,contact_key,dial_claimed_at,call_ended_at,call_sid,conversation_id) values($1,$2,$3,$4,'seller','voice:'||$3::uuid::text,$5,'+17205550100','fixture-contact',now()-$6::interval,now()-$6::interval+interval '1 minute','CA'||$1::uuid::text,$7)",[rid,a,job,screen,phone,`${hours} hours`,conv]);
 await q("insert into icash_operation_spend(operation_key,account_id,state) values('voice:'||$1::uuid::text,$2,'settled')",[job,a]);
 await q("insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,contact_key,conversation_id,state,completed_at,result) values($1,$2,$3,'seller','voice:'||$4::uuid::text,'fixture-contact',$5,'complete',now()-$6::interval+interval '1 minute',$7)",[randomUUID(),a,screen,job,conv,`${hours} hours`,{contactEvidence:'automated_answer',transcript:[{role:'user',message:'Please leave a message after the tone.'}]}]);
}
async function seedText(id,age,body='Would you consider a cash offer?'){
 await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,provider_id,body,created_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered',$1::uuid::text,$4,now()-$5::interval,now()-$5::interval)",[id,thread,a,body,age]);
}
try{
 for(const [name,version] of [['calls','20261116183024'],['texts','20261116183150'],['catchup','20261116183154']])assert.equal(read(`config/three-touch-seller-${name}.sql`),read(`supabase/migrations/${version}_three_touch_seller_${name}.sql`));
 await pg.exec(threeTouchFixtureSql());
 const before=await q('select to_jsonb(j) row from icash_voice_jobs j order by id');
 await pg.exec('begin;'+threeTouchMigrations()+'commit;');
 assert.deepEqual(await q('select to_jsonb(j) row from icash_voice_jobs j order by id'),before,'inactive install never changes original jobs');
 assert.equal(await val('select three_touch_enabled from icash_seller_recovery_private.unanswered_policy'),false);
 await q("update icash_call_recordings set dial_claimed_at=now()-interval '10 hours',call_ended_at=now()-interval '599 minutes'");
 await q("update icash_live_conversations set completed_at=now()-interval '599 minutes'");
 await q("update icash_voice_jobs set created_at=now()-interval '11 hours'");
 await scenario('disabled policy retains exactly one additional call',async()=>{
  assert.equal(await queue(),1);const second=await followup(first);await complete(second,5);assert.equal(await queue(),0);
 });
 await q("update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=true,three_touch_activated_at=now()");
 await scenario('third call is separate, fourth call is impossible',async()=>{
  assert.equal(await queue(),1);const second=await followup(first);assert.equal(await current(second),true);
  await complete(second,5);assert.equal(await queue(),1);const third=await followup(second);assert.equal(await current(third),true);
  assert.equal(await queue(),0);await complete(third,2.5);assert.equal(await queue(),0);
  assert.equal(await val('select count(*)::int from icash_voice_jobs'),3);
  assert.equal(await val('select count(*)::int from icash_operation_spend'),3,'only fixture completions create spend rows');
  assert.equal(await val('select seller_followup_of from icash_voice_jobs where id=$1',[first]),null);
 });
 const changes=[
  ['STOP',`insert into icash_text_suppressions values('${phone}')`],
  ['Pause',"update icash_accounts set bot_paused=true"],
  ['manual takeover',`insert into icash_property_controls values('${a}','${screen}',true)`],
  ['funds exhausted','update icash_wallets set balance_cents=0'],
  ['contact expired',"update icash_operational_contacts set eligibility_until=now()-interval '1 second'"],
  ['contact revoked','update icash_operational_contacts set revoked_at=now()'],
  ['financial/source/contact admission changed','update fixture_eligibility set allowed=false'],
  ['SMS only',`insert into icash_outreach_campaigns values('${a}','sms_inbound')`],
  ['original receipt unsettled',`update icash_operation_spend set state='dispatched' where operation_key='voice:${first}'`],
  ['second receipt unsettled',`update icash_operation_spend set state='dispatched' where operation_key<>'voice:${first}'`],
  ['real human response',`update icash_live_conversations set result='{"contactEvidence":"no_response","transcript":[{"role":"user","message":"Yes, this is my house."}]}' where operation_key<>'voice:${first}'`],
  ['unknown original call','update icash_call_recordings set call_sid=null,call_ended_at=null'],
  ['wrong original recipient',`update icash_call_recordings set to_phone='+12145550999' where voice_job_id='${first}'`],
  ['sender changed',`update icash_call_recordings set from_phone='+12145550999' where voice_job_id<>'${first}'`],
  ['duplicate manual dial',`insert into icash_customer_phone_calls(recipient_phone,child_sid,created_at) values('${phone}','CAhuman',now())`],
  ['policy disabled','update icash_seller_recovery_private.unanswered_policy set enabled=false'],
  ['three-touch rollback','update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=false'],
 ];
 for(const [name,change] of changes)await scenario(name+' blocks final third dial',async()=>{
  assert.equal(await queue(),1);const second=await followup(first);await complete(second,5);
  assert.equal(await queue(),1);const third=await followup(second);assert.equal(await current(third),true);
  await pg.exec(change);assert.equal(await current(third),false);
 });
 await scenario('second call must settle before a third can queue',async()=>{
  assert.equal(await queue(),1);const second=await followup(first);assert.equal(await queue(),0);
  await complete(second,1);assert.equal(await queue(),0,'two hours minimum between calls');
 });
 await scenario('existing introduction before old cutover is admitted only with current evidence',async()=>{
  await q("update icash_seller_recovery_private.unanswered_policy set activated_at=now()-interval '1 hour'");
  assert.equal(await queue(),1);
 });
 await q("insert into icash_text_threads(id,account_id,deal_id,recipient,sender,party,operational_contact_id,eligibility_until,paused,manual_only,ai_mode) values($1,$2,$1,$3,'+17205550100','seller',$4,now()+interval '10 hours',false,false,'auto')",[thread,a,phone,contact]);
 await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft','{}')",[thread,a,screen]);
 await seedText(initial,'12 hours');
 await seedText(secondText,'6 hours','Still interested in discussing a cash offer?');
 await q("insert into icash_seller_recovery_attempts(account_id,thread_id,message_id,reason,assigned_at,delivered_at) values($1,$2,$3,'no_response',now()-interval '6 hours',now()-interval '6 hours')",[a,thread,secondText]);
 await q("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) values('text:'||$1::uuid::text,$2,'settled',now()-interval '6 hours')",[secondText,a]);
 await scenario('predecessor reproduces third text blocked after a delivered reminder',async()=>{
  const old=JSON.parse(read('tests/fixtures/three-touch-predecessors.json')).find(f=>f.definition.startsWith('CREATE OR REPLACE FUNCTION public.icash_prepare_seller_recovery('));
  await pg.exec(old.definition);assert.equal(await val('select icash_prepare_unanswered_seller_texts()'),1);
  const gap=await val('select id from icash_seller_gaps');
  assert.equal(await val('select icash_prepare_seller_recovery($1,$2)',[a,gap]),null);
  assert.equal(await val('select state from icash_seller_gaps'),'needs_review');
 });
 await scenario('third reminder reaches the actual message queue exactly once',async()=>{
  assert.equal(await val('select icash_prepare_unanswered_seller_texts()'),1);
  const gap=await val('select id from icash_seller_gaps'),third=await val('select icash_prepare_seller_recovery($1,$2)',[a,gap]);assert.ok(third);
  assert.equal(await val('select state from icash_text_messages where id=$1',[third]),'ready');
  assert.equal(await val('select request_key from icash_text_messages where id=$1',[third]),gap);
  assert.equal(await val('select count(*)::int from icash_seller_recovery_attempts where thread_id=$1',[thread]),2);
  assert.equal(await val('select icash_prepare_seller_recovery($1,$2)',[a,gap]),null);
  assert.equal(await val('select count(*)::int from icash_text_messages'),3);
 });
 for(const [name,change] of [
  ['unsettled reminder cost',"update icash_operation_spend set state='dispatched' where operation_key='text:"+secondText+"'"],
  ['undelivered attempt record','update icash_seller_recovery_attempts set delivered_at=null'],
  ['different recovery reason',"update icash_seller_recovery_attempts set reason='human'"],
  ['responded recovery','update icash_seller_recovery_attempts set responded_at=now()'],
  ['late contact expiry',"update icash_text_threads set eligibility_until=now()-interval '1 minute'"],
  ['late account Pause','update icash_accounts set bot_paused=true'],
 ])await scenario(name+' blocks actual third message preparation',async()=>{
  assert.equal(await val('select icash_prepare_unanswered_seller_texts()'),1);
  const gap=await val('select id from icash_seller_gaps');await pg.exec(change);
  assert.equal(await val('select icash_prepare_seller_recovery($1,$2)',[a,gap]),null);
  assert.equal(await val('select count(*)::int from icash_text_messages'),2);
 });
 await scenario('second delivered text can schedule exactly one third reminder',async()=>{
  assert.equal(await texts(),true);
  assert.equal(await val('select icash_prepare_unanswered_seller_texts()'),1);
  assert.equal(await val('select source_id from icash_seller_gaps'),secondText);
  assert.equal(await val('select icash_prepare_unanswered_seller_texts()'),0);
  await seedText(randomUUID(),'1 minute');assert.equal(await texts(),false,'fourth text is blocked');
 });
 await scenario('actual delivery observer continues after the second text and ends at three',async()=>{
  await pg.exec('create trigger three_touch_delivery after update on icash_text_messages for each row execute function icash_observe_seller_recovery_text()');
  await q("update icash_text_messages set state='delivered' where id=$1",[secondText]);
  assert.equal(await val('select count(*)::int from icash_seller_gaps'),1);
  assert.equal(await val('select source_id from icash_seller_gaps'),secondText);
  const third=randomUUID();await seedText(third,'1 minute');
  await q("insert into icash_seller_recovery_attempts(account_id,thread_id,message_id,reason) values($1,$2,$3,'no_response')",[a,thread,third]);
  await q("update icash_text_messages set state='delivered' where id=$1",[third]);
  assert.equal(await val('select count(*)::int from icash_seller_gaps'),1,'no fourth-reminder gap');
 });
 await scenario('late canonical delivery is recovered without replaying the message',async()=>{
  await pg.exec('create or replace function icash_text_receipt_private.canonical_update(icash_text_messages,icash_text_messages) returns boolean language sql as $$select true$$');
  await pg.exec('create trigger three_touch_delivery after update on icash_text_messages for each row execute function icash_observe_seller_recovery_text()');
  await q("update icash_text_messages set state='delivered' where id=$1",[secondText]);
  assert.equal(await val('select count(*)::int from icash_seller_gaps'),0);
  assert.equal(await val('select icash_prepare_unanswered_seller_texts()'),1);
  assert.equal(await val('select count(*)::int from icash_text_messages'),2,'catch-up only creates the missing gap');
 });
 for(const [name,change] of [
  ['too soon',"update icash_operation_spend set dispatched_at=now()-interval '1 hour' where operation_key='text:"+secondText+"'"],
  ['unknown delivery',"update icash_text_messages set state='needs_review' where id='"+secondText+"'"],
  ['accepted only',"update icash_text_messages set state='accepted' where id='"+secondText+"'"],
  ['disabled triple',"update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=false"],
 ])await scenario(name+' prevents third text',async()=>{await pg.exec(change);assert.equal(await texts(),false);});
 await scenario('a different account cannot restart the same phone sequence',async()=>{
  const other=randomUUID(),otherAccount=randomUUID();
  await q("insert into icash_text_threads(id,account_id,recipient,party) values($1,$2,$3,'seller')",[other,otherAccount,phone]);
  await q('update icash_text_messages set thread_id=$1,account_id=$2 where id=$3',[other,otherAccount,initial]);
  assert.equal(await texts(),false);
 });
 await scenario('expired contact makes a new gap require checks without renewing expiry',async()=>{
  await q("update icash_text_threads set eligibility_until=now()-interval '1 minute'");
  assert.equal(await val('select icash_prepare_unanswered_seller_texts()'),1);
  assert.equal(await val('select review_reason from icash_seller_gaps'),'contact_checks_expired');
  assert.equal(await val('select eligibility_until<now() from icash_text_threads'),true);
 });
 await scenario('actual response ends cold followups across properties',async()=>{
  const other=randomUUID();await q("insert into icash_text_threads(id,account_id,recipient,party) values($1,$2,$3,'seller')",[other,randomUUID(),phone]);
  await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,event_id,body,created_at) select $1,id,account_id,'incoming','received','reply','Not interested',now() from icash_text_threads where id=$2",[randomUUID(),other]);
  assert.equal(await texts(),false);assert.equal(await val('select icash_prepare_unanswered_seller_texts()'),0);
 });
 for(const role of ['anon','authenticated']){
  assert.equal(await val("select has_function_privilege($1,'public.icash_prepare_unanswered_seller_texts()','execute')",[role]),false);
  assert.equal(await val("select has_function_privilege($1,'icash_seller_recovery_private.three_touch_call_current(uuid,uuid,uuid)','execute')",[role]),false);
 }
 console.log(`PASS three-touch seller sequence: ${cases} scenarios; three calls/texts, historical catch-up, spacing, original receipts, late controls and rollback.`);
}catch(e){console.error(e.message,e.where??'',e.cause?.message??'');process.exitCode=1;}finally{await pg.close();}
