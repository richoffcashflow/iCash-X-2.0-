import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {unansweredFixtureSql,unansweredNativeFixtureSql,read} from './helpers/unanswered-seller-fixture.mjs';
const pg=await PGlite.create(),q=(s,p=[])=>pg.query(s,p),val=async(s,p=[])=>Object.values((await q(s,p)).rows[0]??{})[0];
const a=randomUUID(),original=randomUUID(),contact=randomUUID(),recording=randomUUID(),screen=randomUUID(),phone='+12145550123',thread=randomUUID();
let cases=0;
const scenario=async(name,fn)=>{await pg.exec('begin');try{await fn();cases++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await pg.exec('rollback');}};
const eligible=()=>val('select icash_unanswered_seller_call_current($1,$2)',[a,original]);
const queue=()=>val('select icash_queue_unanswered_seller_calls()');
const followup=()=>val('select id from icash_voice_jobs where seller_followup_of=$1',[original]);
const final=async()=>val('select icash_seller_phone_call_current($1,$2)',[a,await followup()]);
try{
 assert.equal(read('tests/fixtures/unanswered-seller-native.sql'),unansweredNativeFixtureSql(),'native fixture matches real migrations');
 await pg.exec(unansweredFixtureSql());
 await pg.exec('begin;'+read('config/seller-call-answer-context.sql')+read('config/seller-call-automated-greetings.sql')+read('config/seller-specific-price-answers.sql')+'commit;');
 const migration=read('config/unanswered-seller-followups.sql');
 assert.equal(migration,read('supabase/migrations/20261112221500_unanswered_seller_followups.sql'));
 await pg.exec('begin;'+migration+'commit;');
 assert.equal(await queue(),0,'disabled installation cannot create calls');
 await q("update icash_seller_recovery_private.unanswered_policy set enabled=true,activated_at=now()-interval '12 hours'");
 await q('insert into icash_accounts(id,bot_paused) values($1,false)',[a]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)',[a]);
 await q("insert into icash_operational_contacts(id,account_id,screening_id,phone,contact_key,channel,eligibility_until) values($1,$2,$3,$4,'fixture-contact','voice',now()+interval '10 hours')",[contact,a,screen,phone]);
 await q('insert into fixture_eligibility values($1,$2,true)',[a,contact]);
 await q("insert into icash_voice_jobs(id,account_id,operational_contact_id,state,created_at) values($1,$2,$3,'dispatched',now()-interval '4 hours')",[original,a,contact]);
 await q("insert into icash_call_recordings(id,account_id,voice_job_id,screening_id,party,operation_key,to_phone,from_phone,contact_key,dial_claimed_at,call_ended_at,call_sid,conversation_id) values($1,$2,$3,$4,'seller','voice:'||$3::uuid::text,$5,'+17205550100','fixture-contact',now()-interval '3 hours',now()-interval '175 minutes','CAfixture','conv-fixture')",[recording,a,original,screen,phone]);
 await q("insert into icash_operation_spend(operation_key,account_id,state) values('voice:'||$1::uuid::text,$2,'settled')",[original,a]);
 await q("insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,contact_key,conversation_id,state,completed_at,result) values($1,$2,$3,'seller','voice:'||$4::uuid::text,'fixture-contact','conv-fixture','complete',now()-interval '175 minutes',$5)",[randomUUID(),a,screen,original,{contactEvidence:'no_response',transcript:[{role:'user',message:'...'}]}]);
 await scenario('one separate follow-up and no original mutation',async()=>{
  const before=await q('select to_jsonb(j) j from icash_voice_jobs j where id=$1',[original]);
  assert.equal(await eligible(),true);assert.equal(await queue(),1);assert.equal(await final(),true);
  assert.equal(await queue(),0);assert.equal(await eligible(),false);
  assert.deepEqual(await q('select to_jsonb(j) j from icash_voice_jobs j where id=$1',[original]),before);
  assert.equal(await val('select count(*)::int from icash_operation_spend'),1,'queue does not reserve or charge');
 });
 for(const [name,change] of [
  ['customer Pause',"update icash_accounts set bot_paused=true"],['no funds','update icash_wallets set balance_cents=0'],
  ['expired contact',"update icash_operational_contacts set eligibility_until=now()-interval '1 minute'"],
  ['missing expiry',"update icash_operational_contacts set eligibility_until=null"],
  ['revoked contact','update icash_operational_contacts set revoked_at=now()'],['current checks fail','update fixture_eligibility set allowed=false'],
  ['human takeover',`insert into icash_property_controls values('${a}','${screen}',true)`],['STOP',`insert into icash_text_suppressions values('${phone}')`],
  ['SMS-only',`insert into icash_outreach_campaigns values('${a}','sms_inbound')`],
  ['unsettled cost',"update icash_operation_spend set state='dispatched'"],['active call','update icash_call_recordings set call_ended_at=null'],
  ['missing carrier identity','update icash_call_recordings set call_sid=null'],['missing result','delete from icash_live_conversations'],
  ['not due',"update icash_call_recordings set dial_claimed_at=now()-interval '1 hour'"],['before cutover',"update icash_seller_recovery_private.unanswered_policy set activated_at=now()-interval '1 hour'"],
  ['disabled','update icash_seller_recovery_private.unanswered_policy set enabled=false'],['another property','update icash_live_conversations set screening_id=gen_random_uuid()'],
  ['another call','update icash_live_conversations set conversation_id=\'different\''],['wrong recipient',"update icash_call_recordings set to_phone='+12145550999'"],
  ['wrong account','update icash_live_conversations set account_id=gen_random_uuid()'],
 ])await scenario(name+' before queue and at final dial',async()=>{
  assert.equal(await queue(),1);await pg.exec(change);assert.equal(await final(),false);
 });
 for(const answer of ['No.','Yes.','Stop calling me.','Please text me only','Call me tomorrow'])await scenario('actual answer '+answer,async()=>{
  await q("update icash_live_conversations set result=$1",[{contactEvidence:'human_response',transcript:[{role:'agent',message:'Is this the owner of 12 Fixture Lane?'},{role:'user',message:answer}]}]);
  assert.equal(await queue(),0);
 });
 await scenario('late incoming text cancels a queued call',async()=>{
  assert.equal(await queue(),1);
  await q("insert into icash_text_threads(id,account_id,recipient,party) values($1,$2,$3,'seller')",[thread,a,phone]);
  await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,event_id) values($1,$2,$3,'incoming','received','What is your offer?','event-fixture')",[randomUUID(),a,thread]);
  assert.equal(await final(),false);
 });
 await scenario('late second attempt or human call blocks another dial',async()=>{
  assert.equal(await queue(),1);await q("insert into icash_customer_phone_calls(recipient_phone,child_sid,created_at) values($1,'CAhuman',now())",[phone]);assert.equal(await final(),false);
 });
 await scenario('Spanish automated greeting beginning with no remains unanswered',async()=>{
  await q('update icash_live_conversations set result=$1',[{contactEvidence:'automated_answer',transcript:[{role:'agent',message:'Is this the owner of 12 Fixture Lane?'},{role:'user',message:'No se ha grabado nada. Grabe su mensaje después de la señal.'}]}]);
  assert.equal(await eligible(),true);
 });
 await scenario('human transcript overrides a mistaken unanswered flag',async()=>{
  await q('update icash_live_conversations set result=$1',[{contactEvidence:'no_response',transcript:[{role:'user',message:'Hello, what is your offer?'}]}]);
  assert.equal(await queue(),0);
 });
 await scenario('verified inbound conversation stops cold follow-up',async()=>{
  await q('insert into icash_seller_agreement_private.call_history values($1,$2)',['fixture-contact',[{role:'user',message:'I called you back.'}]]);
  assert.equal(await queue(),0);
 });
 for(const [status,binding,expected] of [['no-answer',true,true],['busy',true,true],['completed',true,false],['no-answer',false,false]])await scenario('settled carrier '+status+' exact binding '+binding,async()=>{
  await q('delete from icash_live_conversations');
  await q("update icash_call_recordings set call_ended_at=null,conversation_id=null,state='failed',last_action='gate_settled',provider_account_sid='ACfixture'");
  await q('insert into icash_recording_private.terminal_cost_receipts values($1,$2)',[recording,{status,providerAccountSid:'ACfixture',callSid:binding?'CAfixture':'CAother',fromPhone:'+17205550100',toPhone:phone}]);
  assert.equal(await eligible(),expected);
 });
 await scenario('a second attempt cannot create a follow-up chain',async()=>{
  assert.equal(await queue(),1);
  assert.equal(await val('select icash_unanswered_seller_call_current($1,$2)',[a,await followup()]),false);
 });
 // Test the real recipient-wide SMS cadence, retaining historical timing.
 await q("insert into icash_text_threads(id,account_id,deal_id,recipient,sender,party) values($1,$2,$1,$3,'+17205550100','seller')",[thread,a,phone]);
 await q("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft','{}')",[thread,a,screen]);
 const sent=randomUUID();
 await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,provider_id,body,created_at) values($1,$2,$3,'outgoing','delivered','sms-fixture','Would you consider selling?',now()-interval '5 hours')",[sent,thread,a]);
 for(const [age,expected] of [['2 hours',false],['5 hours',true],['20 hours',false],['4 days',true],['6 days',false]])await scenario('prospective/historical SMS '+age,async()=>{
  await q("update icash_text_messages set created_at=now()-$1::interval where id=$2",[age,sent]);
  assert.equal(await val('select icash_seller_text_cadence_current($1,$2,null,true)',[a,thread]),expected);
 });
 await scenario('second text ends the cold sequence',async()=>{
  await q("insert into icash_text_messages(id,thread_id,account_id,direction,state,provider_id,created_at) values($1,$2,$3,'outgoing','delivered','second-fixture',now())",[randomUUID(),thread,a]);
  assert.equal(await val('select icash_seller_text_cadence_current($1,$2,null,true)',[a,thread]),false);
 });
 for(const role of ['anon','authenticated'])for(const fn of ['icash_queue_unanswered_seller_calls()','icash_unanswered_seller_call_current(uuid,uuid,uuid)'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 console.log(`PASS unanswered seller follow-ups: ${cases} scenarios; source-bound single call, final gates, late replies, tenant identity, no replay/charge, prospective SMS cadence and private grants.`);
}catch(e){console.error(e.message,e.where??'',e.cause?.message??'');process.exitCode=1;}finally{await pg.close();}
