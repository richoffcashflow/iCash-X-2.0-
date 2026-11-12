import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args);
const one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const sender='+16027722055',owner=await one("select md5('owner')::uuid");
const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(p=>p.endsWith('_contiguity_sender_volume.sql'));
const fix=read('../config/seller-source-reply-pacing.sql');
assert.equal(read('../supabase/migrations/20261111235500_seller_source_reply_pacing.sql'),fix);
const claim=id=>one('select icash_claim_text($1,$2,$3)',[owner,id,sender]);
const transactional=id=>one('select icash_sender_private.transactional(m,t) from icash_text_messages m join icash_text_threads t on t.id=m.thread_id where m.id=$1',[id]);
const make=async(key,body='Yes ',kind='limited')=>{
 const thread=await one('select fixture_thread($1,$2)',[key,sender]);
 const outgoing=await one('select fixture_message($1,$2)',[key,thread]);
 const source=await one("select md5('source'||$1)::uuid",[key]);
 await q(`insert into icash_text_events(id,type,payload,received_at)
  select $1,'text.incoming.sms',jsonb_build_object('id',$1::text,'type','text.incoming.sms','timestamp',extract(epoch from m.created_at),
   'data',jsonb_build_object('from',t.recipient,'to',t.sender,'body',$2::text)),m.created_at
  from icash_text_messages m join icash_text_threads t on t.id=m.thread_id where m.id=$3`,['event-'+key,body,outgoing]);
 await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,event_id,created_at)
  select $1,account_id,thread_id,'incoming','received',$2,$3,created_at from icash_text_messages where id=$4`,[source,body,'event-'+key,outgoing]);
 await q('update icash_text_messages set request_key=$1 where id=$2',[source,outgoing]);
 if(kind==='limited')await q('insert into icash_seller_limited_text_replies select account_id,thread_id,$1,id,body from icash_text_messages where id=$2',[source,outgoing]);
 if(kind==='clarification')await q('insert into icash_seller_text_replies select $1,$1,account_id,thread_id,id,body from icash_text_messages where id=$2',[source,outgoing]);
 if(kind==='interest'){
  const opener=await one("select md5('opener'||$1)::uuid",[key]);
  await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,created_at) select $1,account_id,thread_id,'outgoing','delivered','fixture-receipt',created_at-interval '1 minute' from icash_text_messages where id=$2",[opener,outgoing]);
  await q('insert into icash_sms_seller_openings select account_id,thread_id,$1,$2,id from icash_text_messages where id=$3',[opener,source,outgoing]);
 }
 return {thread,outgoing,source};
};
try{
 await pg.exec(read('fixtures/contiguity-volume-predecessors.sql')+read('fixtures/contiguity-volume-admission.sql'));
 await pg.exec(`create table icash_seller_limited_text_replies(account_id uuid,thread_id uuid,source_id uuid,message_id uuid,body text);
  create table icash_seller_text_replies(id uuid,source_id uuid,account_id uuid,thread_id uuid,message_id uuid,body text);
  create table icash_sms_seller_openings(account_id uuid,thread_id uuid,owner_question_id uuid,owner_reply_id uuid,interest_message_id uuid);`);
 await pg.exec(read('../supabase/migrations/'+migration)+read('../config/november-sender-pacing.sql')+read('../config/november-sender-200.sql')+read('../config/november-additional-sender-pacing.sql')+read('../config/november-11-sender-pacing.sql'));
 const failed=await make('original');
 await q("insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) values('fixture',md5('recent-opener')::uuid,$1,true,now()-interval '1 minute')",[sender]);
 assert.equal(await transactional(failed.outgoing),false,'reproduce fixed reply misclassified as cold outreach');
 assert.equal(await claim(failed.outgoing),null,'recent opener blocks its own continuation');
 assert.equal(await one('select count(*)::int from icash_sender_private.waiting'),1);
 await pg.exec("update icash_sender_private.waiting set next_check_at=now()-interval '1 second'");
 assert.equal(await one('select icash_next_sender_volume_retry()'),null);
 assert.equal(await one('select count(*)::int from icash_sender_private.waiting'),0,'reproduce source/equal-timestamp mistaken for new message');

 await pg.exec(fix);
 assert.equal(await transactional(failed.outgoing),true);
 assert.deepEqual(await claim(failed.outgoing),{from:sender},'reply proceeds immediately despite cold pacing');
 assert.equal(await claim(failed.outgoing),null,'one use, no duplicate send');
 assert.equal(await one('select count(*)::int from icash_operation_spend where operation_key=$1',['text:'+failed.outgoing]),1);
 assert.equal(await one("select cold from icash_sender_private.uses where source='property' and source_id=$1",[failed.outgoing]),false);
 for(const [key,body,kind] of [['debt-no','No','limited'],['clarify','Which property?','clarification'],['owner-yes','Yes','interest']]){
  const m=await make(key,body,kind);assert.equal(await transactional(m.outgoing),true,key);assert.deepEqual(await claim(m.outgoing),{from:sender});
 }
 const unbound=await make('unbound','Yes','none');assert.equal(await transactional(unbound.outgoing),false,'a human reply alone does not convert unrelated outreach');
 for(const [key,change] of [
  ['wrong-sender',"update icash_text_events set payload=jsonb_set(payload,'{data,to}','\"+12025550199\"') where id='event-wrong-sender'"],
  ['wrong-body',"update icash_text_messages set body='Tampered' where id=md5('messagewrong-body')::uuid"],
  ['wrong-source',"update icash_text_messages set request_key=md5('other')::uuid where id=md5('messagewrong-source')::uuid"],
  ['wrong-account',"update icash_seller_limited_text_replies set account_id=md5('other')::uuid where message_id=md5('messagewrong-account')::uuid"],
  ['optout',"update icash_text_events set payload=jsonb_set(payload,'{optOut}','true') where id='event-optout'"],
 ]){
  const m=await make(key);await pg.exec(change);assert.equal(await transactional(m.outgoing),false,key);
 }
 for(const body of ['STOP','Wrong number','Automatic reply: away']){const m=await make(body,body);assert.equal(await transactional(m.outgoing),false,body);}

 // Total provider capacity still blocks a real reply, and the exact original
 // source survives deferral. Another equal-time message still cancels recovery.
 const retry=await make('capacity-retry');
 await q("insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'full',md5(i::text)::uuid,$1,false,now() from generate_series(1,1000)i",[sender]);
 assert.equal(await claim(retry.outgoing),null);
 await pg.exec("update icash_sender_private.waiting set next_check_at=now()-interval '1 second'");
 assert.equal(await one('select icash_next_sender_volume_retry()'),null);
 assert.equal(await one('select count(*)::int from icash_sender_private.waiting where message_id=$1',[retry.outgoing]),1,'original source does not erase deferred work');
 await pg.exec("delete from icash_sender_private.uses where source='full';update icash_sender_private.waiting set next_check_at=now()-interval '1 second'");
 assert.deepEqual(await one('select icash_next_sender_volume_retry()'),{accountId:owner,messageId:retry.outgoing,claimKind:'automatic'});
 assert.deepEqual(await claim(retry.outgoing),{from:sender},'trigger also allows the exact same-time source');
 const changed=await make('newer');
 await q("select icash_sender_private.defer($1,$2,$3,'automatic')",[owner,changed.outgoing,sender]);
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,created_at) select md5('newer2')::uuid,account_id,thread_id,'incoming','received','Wait',created_at from icash_text_messages where id=$1",[changed.outgoing]);
 await pg.exec("update icash_sender_private.waiting set next_check_at=now()-interval '1 second'");
 assert.equal(await one('select icash_next_sender_volume_retry()'),null);
 assert.equal(await one('select count(*)::int from icash_sender_private.waiting where message_id=$1',[changed.outgoing]),0);
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_sender_private.reply_source(icash_text_messages,icash_text_threads)','execute')",[role]),false);
 console.log('PASS actual sender trigger/claim and retry regression: source-bound replies, equal timestamps, one dispatch, real provider capacity, changed messages and tenant/receipt/stop exclusions. No external calls.');
}finally{await pg.close();}
