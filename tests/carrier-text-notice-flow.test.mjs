// Offline connected database flows. Original trigger/claim bodies come from
// existing repository SQL; only external/provider admission is a fixture spy.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {checkRetainedNoticeDelegates} from './helpers/carrier-notice-delegate-cases.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function fn(file,name){const s=read(file),re=new RegExp('create(?: or replace)? function public\\.'+name+'\\(','i'),start=s.search(re);assert(start>=0,name);const tail=s.slice(start),tag=tail.match(/\bas (\$[A-Za-z_]*\$)/i)[1],begin=tail.indexOf(tag);return tail.slice(0,tail.indexOf(tag+';',begin+tag.length)+tag.length+1);}
const migration=read('config/carrier-text-notice-classification.sql');
const patches=[...migration.matchAll(/\(\$sig\$([\s\S]*?)\$sig\$,\$old\$([\s\S]*?)\$old\$,\$new\$([\s\S]*?)\$new\$,(\d+)\)/g)].map(m=>({signature:m[1],old:m[2],new:m[3],count:Number(m[4])}));
assert(patches.length>=60,'Complete checked patch set retained');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const statements=[],exec=pg.exec.bind(pg);pg.exec=async(sql)=>{statements.push(sql);return exec(sql);};
const notice='Free Msg: Receiver 12125550123 unable to receive message - Message Blocking is active';
try{
 const fixture=read('tests/helpers/seller-progress-fixture.sql'),split=fixture.indexOf('create function icash_queue_ai_reply(');
 await pg.exec(fixture.slice(0,split)+read('tests/fixtures/seller-progress-original-functions.sql')+fixture.slice(split));
 await pg.exec(`alter table icash_text_messages add asset_ids uuid[] default '{}',add last_delivery_at timestamptz;
 alter table icash_text_events add type text;
 alter table icash_text_threads add sender_pool_assigned boolean default false;
 alter table icash_sms_call_requests add id uuid default gen_random_uuid();
 create table icash_sms_routes(sender text,recipient text,account_id uuid,revision bigint default 1,needs_review boolean default false,primary key(sender,recipient));
 create table icash_sms_inbound_invitations(account_id uuid,thread_id uuid,reply_id uuid,message_id uuid);
 create table icash_seller_text_replies(account_id uuid,thread_id uuid,source_id uuid,message_id uuid);
 create table icash_seller_gaps(id uuid,account_id uuid,thread_id uuid,source text,source_id uuid,state text,outgoing_id uuid,reason text,stage text);
 create table icash_seller_opener_assignments(account_id uuid,thread_id uuid,message_id uuid);
 create table icash_cancellation_notices(account_id uuid,sms_id uuid);
 create table icash_seller_recovery_attempts(account_id uuid,thread_id uuid,gap_id uuid,message_id uuid);
 create table icash_meta_lead_messages(message_id uuid,lead_id uuid,purpose text,evidence_key text);
 create table icash_voice_jobs(id uuid,account_id uuid,sms_source_message_id uuid);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,actual_micros bigint,reserved_micros bigint,dispatched_at timestamptz);
 create table fixture_claims(operation_key text);
 create function icash_claim_before_seller_response(text) returns boolean language plpgsql set search_path=public as $$begin insert into fixture_claims values($1);return true;end$$;
 create function icash_seller_response_operation_allowed(uuid,text) returns boolean language sql as $$select true$$;
 create function icash_seller_text_operation_current(uuid,text) returns boolean language sql as $$select true$$;
 create function icash_seller_clarification_current(uuid,uuid,uuid,text,bigint) returns boolean language sql as $$select false$$;
 create table icash_seller_progress_settings(id integer,enabled boolean);
 insert into icash_seller_progress_settings values(1,false);
 set check_function_bodies=off;`);
 await pg.exec('drop function icash_sms_reply_time(uuid);');
 await pg.exec(fn('config/sms-campaign-reply-attention.sql','icash_sms_reply_time'));
 await pg.exec(fn('config/sms-property-routing.sql','icash_sms_message_route'));
 await pg.exec(fn('config/seller-negative-response-holds.sql','icash_claim_operation'));
 await pg.exec(fn('config/text-ai.sql','icash_save_text_ai').replace('icash_save_text_ai(', 'icash_save_text_ai_before_token_billing('));
 await pg.exec(fn('config/seller-reply-progress.sql','icash_seller_progress_gate'));
 await pg.exec(fn('config/seller-reply-progress.sql','icash_resume_seller_text_ai'));
 await pg.exec('alter function icash_issue_due_text_ai() rename to icash_issue_due_text_ai_before_progress;');
 await pg.exec(migration.slice(0,migration.indexOf('do $patch$'))+'commit;');
 const selected=['icash_enqueue_text_ai','icash_sms_message_route','icash_claim_operation','icash_save_text_ai_before_token_billing','icash_seller_progress_gate','icash_resume_seller_text_ai','icash_issue_due_text_ai_before_progress'];
 for(const patch of patches.filter(p=>selected.some(name=>p.signature.startsWith('public.'+name+'(')))){
  const def=await one('select pg_get_functiondef($1::regprocedure)',[patch.signature]);
  assert.equal(def.split(patch.old).length-1,patch.count,patch.signature+' prerequisite');
  await pg.exec(def.replaceAll(patch.old,patch.new));
 }
 await pg.exec(`set check_function_bodies=on;
 create trigger icash_route before insert on icash_text_messages for each row execute function icash_sms_message_route();
 create trigger icash_enqueue after insert on icash_text_messages for each row execute function icash_enqueue_text_ai();`);
 await pg.exec(migration.slice(migration.indexOf('revoke all on public.icash_response_text_messages')));
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_text_automatic_notice_hold(uuid,uuid)','execute')",[role]),false);
 if(process.env.CARRIER_NOTICE_FIXTURE_OUTPUT)writeFileSync(process.env.CARRIER_NOTICE_FIXTURE_OUTPUT,statements.join(';\n'));
 const a=randomUUID(),b=randomUUID(),t=randomUUID(),d=randomUUID(),screen=randomUUID(),sender='+12125550101',recipient='+12125550123';
 await q('insert into icash_accounts(id) values($1),($2)',[a,b]);
 await q('insert into icash_screening_jobs(id,account_id) values($1,$2)',[screen,a]);
 await q('insert into icash_deal_files(id,account_id,screening_id) values($1,$2,$3)',[d,a,screen]);
 await q('insert into icash_text_threads(id,account_id,deal_id,sender,recipient) values($1,$2,$3,$4,$5)',[t,a,d,sender,recipient]);
 await q('insert into icash_sms_routes(sender,recipient,account_id) values($1,$2,$3)',[sender,recipient,a]);
 const incoming=async(body,attachments=[])=>one("insert into icash_text_messages(account_id,thread_id,direction,state,body,attachments,event_id) values($1,$2,'incoming','received',$3,$4,$5) returning id",[a,t,body,attachments,randomUUID()]);
 const human=await incoming('I want to sell. What is your offer?');
 const humanJob=await one('select id from icash_text_ai_jobs where message_id=$1',[human]);assert(humanJob);
 const revision=await one('select revision from icash_sms_routes');
 const carrier=await incoming(notice);
 assert.equal(await one('select count(*)::int from icash_text_ai_jobs where message_id=$1',[carrier]),0);
 assert.equal(await one('select state from icash_text_ai_jobs where id=$1',[humanJob]),'pending','Late notice does not supersede real pending work');
 assert.equal(await one('select revision from icash_sms_routes'),revision,'Late notice does not advance conversational route');
 assert.equal(await one('select body from icash_text_messages where id=$1',[carrier]),notice,'Original evidence retained');
 assert.equal(await one('select count(*)::int from icash_response_text_messages where id=$1',[carrier]),0);
 assert.equal(await one('select count(*)::int from icash_text_suppressions'),0,'No invented STOP/global suppression');
 const savedNoticeJob=await one("insert into icash_text_ai_jobs(account_id,thread_id,message_id,state) values($1,$2,$3,'pending') returning id",[a,t,carrier]);
 assert.equal(await one('select icash_seller_progress_gate($1,$2)',[a,savedNoticeJob]),false,'Gate holds notice even with progress disabled');
 assert.equal(await one('select icash_seller_progress_gate($1,$2)',[a,humanJob]),true);
 assert.deepEqual(await one('select icash_resume_seller_text_ai($1,$2)',[a,savedNoticeJob]),{mode:'held'});
 assert.equal(await one('select icash_text_ai_source_is_notice($1,$2)',[b,savedNoticeJob]),false,'Account-bound lookup');
 const issued=await one('select icash_issue_due_text_ai_before_progress()');assert(issued?.token);
 assert.equal(await one('select text_ai_job_id from icash_automation_tickets where token=$1',[issued.token]),humanJob,'Historical notice cannot occupy scheduler slot');
 assert.equal(await one('select state from icash_text_ai_jobs where id=$1',[savedNoticeJob]),'pending','No historical state/receipt rewrite');
 const outgoing=await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,request_key) values($1,$2,'outgoing','ready','Fixture reply',$3) returning id",[a,t,savedNoticeJob]);
 await q('update icash_text_ai_jobs set outgoing_id=$2 where id=$1',[savedNoticeJob,outgoing]);
 const op='text:'+outgoing;await q("insert into icash_operation_spend values($1,$2,'reserved',null,500,null)",[op,a]);
 const money=await one('select to_jsonb(o) from icash_operation_spend o where operation_key=$1',[op]);
 assert.equal(await one('select icash_claim_operation($1)',[op]),false);
 assert.deepEqual(await one('select to_jsonb(o) from icash_operation_spend o where operation_key=$1',[op]),money,'Held/unreported costs untouched');
 assert.equal(await one('select count(*)::int from fixture_claims'),0,'Final provider admission never reached');
 const cold=await one("insert into icash_text_messages(account_id,thread_id,direction,state,body) values($1,$2,'outgoing','ready','Unanswered follow-up') returning id",[a,t]);
 await q("insert into icash_seller_gaps(account_id,thread_id,outgoing_id,reason,stage) values($1,$2,$3,'no_response','draft')",[a,t,cold]);
 await q("insert into icash_operation_spend values($1,$2,'reserved',null,500,null)",['text:'+cold,a]);
 assert.equal(await one('select icash_claim_operation($1)',['text:'+cold]),false,'Non-human reclassification does not reopen cold automatic sends');
 assert.equal(await one('select count(*)::int from fixture_claims'),0);
 // The delivery notice must not expand policy into a blanket automatic hold.
 for(const [kind,manual] of [['genuine_human_reply',false],['requested_agreement',false],['cancellation_notice',false],['manual_reply',true]]){
  const id=await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,customer_author_id) values($1,$2,'outgoing','ready',$3,$4) returning id",[a,t,kind,manual?randomUUID():null]);
  if(kind==='cancellation_notice'){
   await q('insert into icash_cancellation_notices values($1,$2)',[a,id]);
   await q('insert into icash_seller_opener_assignments values($1,$2,$3)',[a,t,id]);
  }
  assert.equal(await one('select icash_text_automatic_notice_hold($1,$2)',[a,id]),false,kind+' keeps original independent gates');
 }
 // An already charged AI attempt still saves the exact receipt, but hallucinated
 // human/callback fields from a notice cannot pause the human conversation.
 await q("update icash_text_ai_jobs set state='analyzing' where id=$1",[savedNoticeJob]);
 await q("select icash_save_text_ai_before_token_billing($1,$2,$3,$4,$5,$6)",[a,savedNoticeJob,{humanRequested:true,callbackRequested:true},'Do not send','fixture-provider',{input_tokens:7,output_tokens:3}]);
 const receipt=(await q('select state,analysis,provider_id,usage from icash_text_ai_jobs where id=$1',[savedNoticeJob])).rows[0];
 assert.equal(receipt.state,'superseded');assert.equal(receipt.provider_id,'fixture-provider');assert.deepEqual(receipt.usage,{input_tokens:7,output_tokens:3});
 assert.equal(await one('select paused from icash_text_threads where id=$1',[t]),false);
 assert.deepEqual(await one('select to_jsonb(o) from icash_operation_spend o where operation_key=$1',[op]),money);
 const quote=await incoming('I got "'+notice+'". Can we talk about the house?');assert(await one('select id from icash_text_ai_jobs where message_id=$1',[quote]));
 const attachment=await incoming(notice,[{url:'https://example.invalid/attachment'}]);assert(await one('select id from icash_text_ai_jobs where message_id=$1',[attachment]));
 assert.equal(await one('select count(*)::int from icash_text_suppressions'),0);
 assert.equal(await one('select icash_text_automatic_notice_hold($1,$2)',[a,cold]),true,'Human replies do not prove outgoing blocking cleared');
 const restored=await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,customer_author_id,provider_id,last_delivery_at) values($1,$2,'outgoing','delivered','Existing manually requested message',$3,'fixture-later-delivery',now()) returning id",[a,t,randomUUID()]);
 await q("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) select 'text:'||id,account_id,'dispatched',created_at from icash_text_messages where id=$1",[restored]);
 assert.equal(await one('select icash_text_automatic_notice_hold($1,$2)',[a,cold]),true,'A state label without its canonical receipt is insufficient');
 for(const [suffix,from,to,delta] of [['wrong-sender','+12125550999',recipient,0],['wrong-recipient',sender,'+12125550999',0],['historical-clock',sender,recipient,-60]]){
  await q("insert into icash_text_events(id,type,payload) select $4::text,'text.delivery.confirmed',jsonb_build_object('timestamp',extract(epoch from last_delivery_at)+$5,'data',jsonb_build_object('message_id',provider_id,'from',$2::text,'to',$3::text)) from icash_text_messages where id=$1",[restored,from,to,suffix,delta]);
  assert.equal(await one('select icash_text_automatic_notice_hold($1,$2)',[a,cold]),true,'Unrelated or historical terminal evidence cannot clear notice: '+suffix);
 }
 await q("insert into icash_text_events(id,type,payload) select 'fixture-delivery','text.delivery.confirmed',jsonb_build_object('timestamp',extract(epoch from last_delivery_at),'data',jsonb_build_object('message_id',provider_id,'from',$2::text,'to',$3::text)) from icash_text_messages where id=$1",[restored,sender,recipient]);
 await q("update icash_text_messages set state='accepted' where id=$1",[restored]);
 assert.equal(await one('select icash_text_automatic_notice_hold($1,$2)',[a,cold]),true,'Accepted is not terminal delivery');
 await q("update icash_text_messages set state='delivered' where id=$1",[restored]);
 await q("update icash_operation_spend set dispatched_at=(select created_at from icash_text_messages where id=$2)-interval '1 second' where operation_key='text:'||$1::text",[restored,carrier]);
 assert.equal(await one('select icash_text_automatic_notice_hold($1,$2)',[a,cold]),true,'A backfilled receipt for a pre-notice send does not clear blocking');
 await q("update icash_operation_spend set dispatched_at=(select created_at from icash_text_messages where id=$1::uuid) where operation_key='text:'||$1::text",[restored]);
 assert.equal(await one('select icash_text_automatic_notice_hold($1,$2)',[a,cold]),false,'Only a later original same-thread delivered receipt resolves the delivery hold');
 assert.equal(await one('select icash_claim_operation($1)',[op]),false,'Resolved transport does not turn the original notice into a reply or replay its AI output');
 if(!process.env.CARRIER_NOTICE_FIXTURE_OUTPUT)await checkRetainedNoticeDelegates({pg,q,one,read,fn,patches,randomUUID,notice,account:a,deal:d,screening:screen});
 console.log('Carrier notice connected SQL flow: raw retention, route/real-job preservation, historical scheduler/resume/final admission, no new cold-send authority, account fences, and in-flight usage preservation passed. No provider requests.');
}catch(e){console.error(e.message,e.cause?.message??'',e.where??'',e.cause?.where??'');throw e;}finally{await pg.close();}
