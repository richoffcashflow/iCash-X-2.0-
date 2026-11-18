import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {threeTouchFixtureSql,threeTouchMigrations,threeTouchMetaFixtureSql,read} from './helpers/three-touch-fixture.mjs';
const db=await PGlite.create(),q=(s,p=[])=>db.query(s,p),val=async(s,p=[])=>Object.values((await q(s,p)).rows[0]??{})[0];
const a=randomUUID(),lead=randomUUID(),screen=randomUUID(),cp=randomUUID(),first=randomUUID(),second=randomUUID(),phone='+12145550144';
let cases=0;
async function scenario(name,fn){await db.exec('begin');try{await fn();cases++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await db.exec('rollback');}}
const prepare=()=>val('select icash_meta_prepare_followups($1)',[lead]);
const current=id=>val('select icash_meta_followup_call_current($1,$2)',[lead,id]);
try{
 assert.equal(read('config/three-touch-meta-calls.sql'),read('supabase/migrations/20261116184502_three_touch_meta_calls.sql'));
 await db.exec(threeTouchFixtureSql()+threeTouchMetaFixtureSql());
 const originalJobs=await q('select to_jsonb(j) row from icash_voice_jobs j');
 await db.exec('begin;'+threeTouchMigrations()+read('config/three-touch-meta-calls.sql')+'commit;');
 assert.deepEqual(await q('select to_jsonb(j) row from icash_voice_jobs j'),originalJobs,'original financial-recovery source snapshots remain byte-for-byte identical');
 await q('insert into icash_accounts(id,bot_paused) values($1,false)',[a]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)',[a]);
 await q("insert into icash_seller_intakes(id,phone,state,contact_consent_scope) values($1,$2,'awaiting_address','homeoffer_network')",[lead,phone]);
 await q("insert into icash_contact_permissions(id,account_id,screening_id,seller_intake_id,phone,party,contact_key,permission_until) values($1,$2,$3,$4,$5,'seller',encode(sha256(convert_to($5,'UTF8')),'hex'),now()+interval '24 hours')",[cp,a,screen,lead,phone]);
 await q("insert into icash_meta_leads(lead_id,account_id,screening_id,voice_job_id,paused,voice_paused,first_outreach_at,contact_until) values($1,$2,$3,$4,false,false,now()-interval '30 hours',now()+interval '24 hours')",[lead,a,screen,first]);
 for(const [job,age,isFollowup] of [[first,'30 hours',false],[second,'5 hours',true]]){
  await q("insert into icash_voice_jobs(id,account_id,permission_id,meta_followup_lead_id,state,created_at) values($1,$2,$3,$4,'dispatched',now()-$5::interval)",[job,a,cp,isFollowup?lead:null,age]);
  const recording=randomUUID(),conversation=randomUUID();
  await q("insert into icash_call_recordings(id,account_id,voice_job_id,screening_id,party,operation_key,to_phone,from_phone,contact_key,dial_claimed_at,call_ended_at,call_sid,conversation_id) values($1,$2,$3,$4,'seller','voice:'||$3::uuid::text,$5,'+17205550100',encode(sha256(convert_to($5,'UTF8')),'hex'),now()-$6::interval,now()-$6::interval+interval '1 minute','CA'||$1::uuid::text,$7)",[recording,a,job,screen,phone,age,conversation]);
  await q("insert into icash_operation_spend(operation_key,account_id,state) values('voice:'||$1::uuid::text,$2,'settled')",[job,a]);
  await q("insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,contact_key,conversation_id,state,completed_at,result) values($1,$2,$3,'seller','voice:'||$4::uuid::text,encode(sha256(convert_to($5,'UTF8')),'hex'),$6,'complete',now()-$7::interval+interval '1 minute',$8)",[randomUUID(),a,screen,job,phone,conversation,age,{contactEvidence:'automated_answer',transcript:[{role:'user',message:'Please leave a message after the tone.'}]}]);
 }
 const initial=randomUUID();await q("insert into icash_text_messages(id,account_id,direction,state,provider_id) values($1,$2,'outgoing','delivered','initial-fixture')",[initial,a]);
 await q("insert into icash_meta_lead_messages(lead_id,message_id,purpose) values($1,$2,'initial')",[lead,initial]);
 assert.equal((await prepare()).voiceJobId,null,'inactive policy never creates the third call');
 await q("update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=true,three_touch_activated_at=now()");
 await scenario('third Meta call reuses exact lead and permission, never original job',async()=>{
  const result=await prepare(),third=result.voiceJobId;assert.ok(third);assert.notEqual(third,first);assert.notEqual(third,second);
  assert.equal(await current(third),true);
  assert.equal(await val('select icash_seller_phone_call_current($1,$2)',[a,third]),true,'actual final phone gate recognizes the consent-bound third call');
  assert.equal((await prepare()).voiceJobId,third);
  assert.equal(await val('select count(*)::int from icash_voice_jobs where account_id=$1',[a]),3);
  assert.equal(await val('select count(*)::int from icash_operation_spend where account_id=$1',[a]),2);
  await q("update icash_voice_jobs set state='dispatched' where id=$1",[third]);assert.equal((await prepare()).voiceJobId,null);
 });
 for(const [name,change] of [
  ['paused',`update icash_meta_leads set paused=true where lead_id='${lead}'`],
  ['text only',`update icash_meta_leads set voice_paused=true where lead_id='${lead}'`],
  ['address answered',`update icash_meta_leads set address_confirmed_at=now() where lead_id='${lead}'`],
  ['seller replied',`update icash_meta_leads set response_at=now() where lead_id='${lead}'`],
  ['declined',`update icash_meta_leads set declined_at=now() where lead_id='${lead}'`],
  ['no credit',`update icash_wallets set balance_cents=0 where account_id='${a}'`],
  ['source expired',`update icash_meta_leads set contact_until=now()-interval '1 minute' where lead_id='${lead}'`],
  ['owner demo',`update icash_seller_intakes set contact_consent_scope='icash_x_demo' where id='${lead}'`],
  ['unknown original cost',`update icash_operation_spend set state='dispatched' where operation_key='voice:${first}'`],
  ['unknown second cost',`update icash_operation_spend set state='dispatched' where operation_key='voice:${second}'`],
  ['missing second transcript',`delete from icash_live_conversations where operation_key='voice:${second}'`],
  ['real voice answer',`update icash_live_conversations set result='{"contactEvidence":"automated_answer","transcript":[{"role":"user","message":"Stop calling me."}]}' where operation_key='voice:${second}'`],
  ['too soon',`update icash_call_recordings set dial_claimed_at=now()-interval '1 hour' where voice_job_id='${second}'`],
  ['sender changed',`update icash_call_recordings set from_phone='+12145550999' where voice_job_id='${second}'`],
  ['different property',`update icash_contact_permissions set screening_id=gen_random_uuid() where id='${cp}'`],
  ['policy off',"update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=false"],
 ])await scenario(name+' blocks late third Meta call',async()=>{const third=(await prepare()).voiceJobId;assert.ok(third);await db.exec(change);assert.equal(await current(third),false);assert.equal(await val('select icash_seller_phone_call_current($1,$2)',[a,third]),false);});
 assert.equal(await val("select has_function_privilege('authenticated','icash_seller_recovery_private.meta_third_call_current(uuid,uuid)','execute')"),false);
 console.log(`PASS three-touch Meta sequence: ${cases} scenarios; exact consent/source, settled unanswered calls, single third job, no replay and late controls.`);
}catch(e){console.error(e.message,e.where??'',e.cause?.message??'');process.exitCode=1;}finally{await db.close();}
