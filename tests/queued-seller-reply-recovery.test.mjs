import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const native=process.env.ICASH_NATIVE_QUEUED_REPLY==='1';
let pg,second;
if(native){
 const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE);
 const connect=database=>new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database});
 const admin=connect('postgres');await admin.connect();await admin.query('drop database if exists icash_queued_reply');await admin.query('create database icash_queued_reply');await admin.end();
 const client=connect('icash_queued_reply');second=connect('icash_queued_reply');await client.connect();await second.connect();
 pg={query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql),close:()=>client.end()};
}else pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args);
const one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const account=randomUUID(),thread=randomUUID(),source=randomUUID(),out=randomUUID(),job=randomUUID(),deal=randomUUID(),screen=randomUUID(),recording=randomUUID();
const sender='+15550100001',recipient='+15550100002';
try{
 let predecessors=read('./fixtures/queued-seller-reply-predecessors.sql');
 if(native)predecessors=predecessors.replace('create role service_role;',"do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;");
 await pg.exec(predecessors);
 const migration=read('../config/queued-seller-reply-recovery.sql');assert.equal(migration,read('../supabase/migrations/20261118194800_queued_seller_reply_recovery.sql'));
 await pg.exec(migration);
 await pg.exec("insert into icash_operating_budget values(1);insert into icash_seller_progress_settings values(1,true,false,null,now()-interval '1 day')");
 await q('insert into icash_accounts(id) values($1)',[account]);
 await q("insert into icash_deal_files values($1,$2,$3,'draft','{}')",[deal,account,screen]);
 await q("insert into icash_text_threads values($1,$2,$3,'seller',false,false,'auto',null,$4,$5)",[thread,account,deal,sender,recipient]);
 await q("insert into icash_sms_routes values($1,$2,$3,7,false)",[account,sender,recipient]);
 await q("insert into icash_text_events values('evt','text.incoming.sms',jsonb_build_object('type','text.incoming.sms','id','evt','data',jsonb_build_object('from',$1::text,'to',$2::text,'body','Please text me.'),'timestamp',extract(epoch from now()-interval '4 hours')))",[recipient,sender]);
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,created_at,event_id,route_revision) values($1,$2,$3,'incoming','received','Please text me.',now()-interval '4 hours','evt',7)",[source,account,thread]);
 await q("insert into icash_text_messages(id,account_id,thread_id,request_key,direction,state,body,created_at) values($1,$2,$3,$4,'outgoing','ready','Which property?',now()-interval '4 hours'+interval '1 minute')",[out,account,thread,job]);
 await q("insert into icash_text_ai_jobs values($1,$2,$3,$4,'queued',$5,null,$6,now()-interval '1 hour',now()-interval '4 hours')",[job,account,thread,source,{dialoguePolicy:'seller-dialogue-v1'},out]);
 await q("insert into icash_automation_tickets(account_id,kind,text_ai_job_id,state,outcome,completed_at,created_at) values($1,'text_ai',$2,'held','message_held',now()-interval '3 hours',now()-interval '3 hours')",[account,job]);
 const tick=()=>one('select icash_issue_due_text_ai()');
 const voice=()=>one('select icash_seller_voice_text_context($1,$2)',[account,source]);
 const check=async(sql,args=[])=>{await pg.exec('begin');try{await q(sql,args);assert.equal((await tick()).token,undefined,sql);}finally{await pg.exec('rollback');}};
 for(const [sql,args] of [
  ["update icash_text_threads set paused=true",[]],["update icash_accounts set bot_paused=true",[]],["update icash_text_threads set manual_only=true",[]],
  ["insert into icash_text_suppressions values($1)",[recipient]],["update icash_text_messages set request_key=gen_random_uuid() where id=$1",[out]],
  ["update icash_text_messages set customer_author_id=gen_random_uuid() where id=$1",[out]],["update icash_text_messages set account_id=gen_random_uuid() where id=$1",[out]],
  ["update icash_text_messages set body='Edited' where id=$1",[out]],["update icash_text_messages set provider_id='accepted' where id=$1",[out]],
  ["update icash_text_events set payload=jsonb_set(payload,'{data,from}','\"elsewhere\"')",[]],["update icash_automation_tickets set outcome='text_ai_needs_review'",[]],
  ["update icash_automation_tickets set state='consumed',expires_at=now()+interval '5 minutes'",[]],
  ["insert into icash_operation_spend values($1,$2)",['text:'+out,account]],
  ["insert into icash_text_messages(id,account_id,thread_id,direction,state,body,created_at) values(gen_random_uuid(),$1,$2,'incoming','received','Someone else',now())",[account,thread]],
  ["insert into icash_text_messages(id,account_id,thread_id,direction,state,customer_author_id,created_at) values(gen_random_uuid(),$1,$2,'outgoing','delivered',gen_random_uuid(),now())",[account,thread]],
 ])await check(sql,args);
 await pg.exec('begin');assert.ok((await tick()).token);assert.equal((await tick()).token,undefined);await pg.exec('rollback');
 await q("insert into icash_call_recordings values($1,$2,$3,$4,$5,'seller','CAfixture','ACfixture',now()-interval '4 hours 10 minutes',now()-interval '4 hours 5 seconds')",[recording,account,screen,sender,recipient]);
 await q("update icash_text_ai_jobs set analysis=analysis||jsonb_build_object('voiceReceiptWait',jsonb_build_object('recordingId',$1::uuid,'enabledAt',(select voice_receipt_wait_enabled_at from icash_seller_progress_settings)))",[recording]);
 assert.equal(await voice(),true,'The original was finished and prepared inside the receipt deadline');
 for(const [sql,args] of [
  ["update icash_call_recordings set call_ended_at=now()-interval '3 hours'",[]],["update icash_text_ai_jobs set state='drafted'",[]],
  ["update icash_text_messages set created_at=now()-interval '3 hours' where id=$1",[out]],
  ["update icash_seller_progress_settings set voice_receipt_wait_enabled_at=now()",[]],
  ["update icash_call_recordings set screening_id=gen_random_uuid()",[]],
  ["update icash_call_recordings set account_id=gen_random_uuid()",[]],
  ["update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb(extract(epoch from now()-interval '25 hours')))",[]],
 ]){
  await pg.exec('begin');try{await q(sql,args);assert.equal(await voice(),false,sql);assert.equal((await tick()).token,undefined,sql);}finally{await pg.exec('rollback');}
 }
 if(native){
  const outcomes=await Promise.all([tick(),second.query('select icash_issue_due_text_ai() as result').then(r=>r.rows[0].result)]);
  assert.equal(outcomes.filter(r=>r.token).length,1,'Two independent workers issue one original ticket');
 }else assert.ok((await tick()).token);
 assert.equal((await tick()).token,undefined);
 assert.equal(await one('select count(*)::int from icash_text_messages'),2);
 assert.equal(await one('select count(*)::int from icash_operation_spend'),0);
 console.log('PASS original seller reply recovery, source/receipt deadlines, held and uncertain sends, identity, opt-outs and one-ticket admission.');
}finally{await second?.end();await pg.close();}
