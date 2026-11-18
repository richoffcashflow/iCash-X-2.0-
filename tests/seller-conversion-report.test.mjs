// Offline only. Actual report SQL and saved canonical helpers; no provider paths.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';
import {validSellerConversionReport} from '../lib/seller-conversion-report.ts';
globalThis.fetch=async()=>{throw Error('NO NETWORK: offline conversion report');};
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const native=process.env.ICASH_NATIVE_CONVERSION==='1';
let pg;
if(native){
 const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE);
 const connect=database=>new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database});
 const admin=connect('postgres');await admin.connect();
 await admin.query('drop database if exists icash_conversion_report');await admin.query('create database icash_conversion_report');await admin.end();
 const client=connect('icash_conversion_report');await client.connect();
 pg={query:(s,a)=>client.query(s,a),exec:s=>client.query(s),close:()=>client.end()};
}else pg=await PGlite.create();
const q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
let fixture=read('./fixtures/seller-conversion-report.sql');
if(native)fixture=fixture.replace(/create role (anon|authenticated|service_role);/g,(_,role)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end$$;`);
await pg.exec(fixture+read('./fixtures/seller-conversion-report-helpers.sql')+read('../config/seller-conversion-report.sql'));
await pg.exec(`alter table icash_call_recordings add column start_claimed_at timestamptz,add column recording_sid text,add column provider_account_sid text,add column from_phone text,add column to_phone text;
 create table icash_recorded_gate_terminal_receipts(recording_id uuid primary key,account_id uuid,call_sid text,receipt jsonb,created_at timestamptz);`);
const outcomes=read('../config/known-seller-call-outcomes.sql');assert.equal(outcomes,read('../supabase/migrations/20261118195200_known_seller_call_outcomes.sql'));
await pg.exec(outcomes);
const report=async()=>{const {v}=await one('select icash_seller_conversion_report($1,7) v',[owner]);assert(validSellerConversionReport(v,7),JSON.stringify(v));return v;};
const at=n=>new Date(Date.now()-n*1000).toISOString();
async function seed({mode='live',actor=randomUUID(),practice=false}={}){
 const c={a:randomUUID(),s:randomUUID(),d:randomUUID(),t:randomUUID()};
 await q('insert into icash_accounts values($1,$2,false)',[c.a,actor]);
 await q("insert into icash_funding_orders values($1,$2,'paid')",[c.a,mode]);
 await q('insert into icash_screening_jobs values($1,$2,$3)',[c.s,c.a,{practice}]);
 await q('insert into icash_deal_files values($1,$2,$3,$4)',[c.d,c.a,c.s,{}]);
 await q('insert into icash_text_threads(id,account_id,deal_id) values($1,$2,$3)',[c.t,c.a,c.d]);return c;
}
async function incoming(c,{body='Yes, I own it',known=true,seconds=3600}={}){
 const id=randomUUID(),event=randomUUID(),time=at(seconds);
 await q('insert into icash_text_events values($1,$2,$3)',[event,'text.incoming.sms',{id:event,type:'text.incoming.sms',...(known?{timestamp:Date.parse(time)/1000}:{}),data:{from:'+15550000002',to:'+15550000001',body}}]);
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,event_id,created_at) values($1,$2,$3,'incoming','received',$4,$5,$6)",[id,c.a,c.t,body,event,time]);return {id,time};
}
async function outgoing(c,m,{state='delivered',dispatch=true,human=false,bind='ai'}={}){
 const id=randomUUID(),time=new Date(Date.parse(m.time)+15000).toISOString();
 await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,created_at,provider_id,last_delivery_at,customer_author_id,body) values($1,$2,$3,'outgoing',$4,$5,$6,$7,$8,'How soon would you sell?')",[id,c.a,c.t,state,time,state==='ready'?null:'provider-'+id,state==='delivered'?time:null,human?randomUUID():null]);
 if(bind==='ai')await q('insert into icash_text_ai_jobs(account_id,thread_id,message_id,outgoing_id) values($1,$2,$3,$4)',[c.a,c.t,m.id,id]);
 if(bind==='limited')await q('insert into icash_seller_limited_text_replies values($1,$2,$3,$4)',[c.a,c.t,m.id,id]);
 if(dispatch)await q('insert into icash_operation_spend values($1,$2,$3)',[c.a,'text:'+id,time]);return id;
}
async function call(c,{human=true,mismatch=false}={}){
 const id=randomUUID(),op='voice:'+randomUUID(),provider='conv_'+randomUUID(),time=at(1800);
 await q("insert into icash_call_recordings(account_id,screening_id,call_sid,dial_claimed_at,operation_key,contact_key,conversation_id) values($1,$2,'CA_fixture',$3,$4,'contact',$5)",[c.a,c.s,time,op,provider]);
 await q("insert into icash_live_conversations(id,account_id,screening_id,operation_key,contact_key,conversation_id,state,result,created_at,completed_at) values($1,$2,$3,$4,$5,$6,'complete',$7,$8,$8)",[id,c.a,c.s,op,mismatch?'other':'contact',provider,{transcript:[{role:'user',message:human?'Yes, I own the home.':'Please leave a message after the beep.'}]},time]);return id;
}
assert.equal((await report()).replies.observed,0);
await assert.rejects(q('select icash_seller_conversion_report($1,7)',[randomUUID()]),/Owner required/);
await assert.rejects(q('select icash_seller_conversion_report($1,2)',[owner]),/Invalid report window/);
for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await assert.rejects(report(),/permission denied/);await pg.exec('reset role');}
for(const options of [{mode:'test'},{actor:owner},{practice:true}]){const c=await seed(options);await incoming(c);await call(c);}
const old=await seed();await incoming(old,{seconds:8*86400});assert.equal((await report()).replies.observed,0);assert.equal((await report()).calls.attempted,0);
const c=await seed(),m=await incoming(c);await outgoing(c,m);await outgoing(c,m,{state:'ready',dispatch:false,bind:'limited'});
await q("insert into icash_seller_reply_progress values($1,$2,$3,'pending','stale_progress',$4)",[m.id,c.a,c.t,at(120)]);
let r=await report();assert.equal(r.replies.currentlyAccepted,1);assert.equal(r.replies.delivered,1);assert.equal(r.replies.dispatchLatencySeconds.p50,15);assert.equal(r.replies.currentUnsubmitted,0);assert.equal(r.replies.dueProgressChecks,0);
const unknown=await seed(),u=await incoming(unknown,{known:false});await outgoing(unknown,u);
const receipt=await seed(),rm=await incoming(receipt);await outgoing(receipt,rm,{state:'accepted',dispatch:false});
const human=await seed(),hm=await incoming(human);await outgoing(human,hm,{human:true,bind:null});
const due=await seed(),dm=await incoming(due);await q("insert into icash_seller_reply_progress values($1,$2,$3,'pending','quote_receipt_wait',$4)",[dm.id,due.a,due.t,at(120)]);
const stop=await seed();await incoming(stop,{body:'STOP'});
const superseded=await seed();await incoming(superseded);await incoming(superseded,{body:'Not interested',seconds:3500});
r=await report();assert.equal(r.replies.sourceTimeUnknown,1);assert.equal(r.replies.acceptedDispatchLatencyUnknown,2);assert.equal(r.replies.currentlyAccepted,3);assert.equal(r.replies.delivered,2);assert.equal(r.replies.laterCustomerReplies,1);assert.equal(r.replies.currentMissingAiJob,1);assert.equal(r.replies.dueProgressChecks,1);assert(r.replies.oldestDueSeconds>=120);
const live=await call(c),voicemail=await call(c,{human:false});await call(c,{mismatch:true});
await q("insert into icash_live_callbacks(conversation_id,account_id,screening_id,due_at,state,created_at) values($1,$2,$3,$4,'pending_dispatch_review',$5),($6,$2,$3,$4,'pending_dispatch_review',$5)",[live,c.a,c.s,at(300),at(1800),voicemail]);
r=await report();assert.deepEqual(r.calls,{attempted:3,completed:2,humanResponses:1,carrierUnanswered:0,humanResponseUnknown:1});assert.equal(r.callbacks.observed,1);assert.equal(r.callbacks.scheduledReviewsDue,1);
const missed=randomUUID(),fromPhone='+15550100101',toPhone='+15550100102';
await q("insert into icash_call_recordings(id,account_id,screening_id,call_sid,dial_claimed_at,provider_account_sid,from_phone,to_phone,operation_key) values($1,$2,$3,'CAfixture',now()-interval '1 hour','ACfixture',$4,$5,'voice:missed-fixture')",[missed,c.a,c.s,fromPhone,toPhone]);
await q("insert into icash_recorded_gate_terminal_receipts values($1,$2,'CAfixture',$3,now()-interval '50 minutes')",[missed,c.a,{sid:'CAfixture',account_sid:'ACfixture',from:fromPhone,to:toPhone,direction:'outbound-api',duration:'0',status:'no-answer'}]);
r=await report();assert.deepEqual(r.calls,{attempted:4,completed:2,humanResponses:1,carrierUnanswered:1,humanResponseUnknown:1});
for(const sql of [`update icash_recorded_gate_terminal_receipts set account_id=gen_random_uuid()`,`update icash_recorded_gate_terminal_receipts set receipt=receipt||'{"duration":"6"}'`,`update icash_recorded_gate_terminal_receipts set receipt=receipt||'{"account_sid":"other"}'`,`update icash_recorded_gate_terminal_receipts set receipt=receipt||'{"status":"completed"}'`,`update icash_call_recordings set recording_sid='REfixture' where id=$1`,`insert into icash_live_conversations(account_id,operation_key,conversation_id) select account_id,'voice:missed-fixture','contradictory' from icash_call_recordings where id=$1`]){
 await pg.exec('begin');await q(sql,sql.includes('$1')?[missed]:[]);const changed=await report();assert.equal(changed.calls.carrierUnanswered,0);assert.equal(changed.calls.humanResponseUnknown,2);await pg.exec('rollback');
}
const state={processedSource:m.id,textThreadId:c.t,quotedPriceCents:20000000,acceptedPriceCents:20000000,quoteRevision:1};
await q('insert into icash_call_offer_private.offers values($1,$2,$3,$4)',[c.d,c.a,state,at(100)]);
await q("insert into icash_call_offer_private.events(deal_id,account_id,call_key,action,state,created_at) values($1,$2,$3,'quote',$4,$5),($1,$2,$3,'accept',$4,$5)",[c.d,c.a,'sms:'+m.id,state,at(100)]);
r=await report();assert.equal(r.offers.observedDeals,1);assert.equal(r.offers.acceptanceRecorded,1);assert.equal(r.offers.currentQuoteSmsDelivered,0);assert.equal(r.offers.acceptedWithoutVerifiedPurchaseOnDeal,1);assert.equal(r.offers.verifiedPurchaseSigned,0);
await q("update icash_text_ai_jobs set analysis=$1,reply='How soon would you sell?' where message_id=$2",[{offerPolicy:'seller-text-offer-v1',offerAction:'cash_offer',offerState:state},m.id]);
assert.equal((await report()).offers.currentQuoteSmsDelivered,0,'action metadata alone is not a saved quote message');
const quote='As-is cash proposal: $200,000. Does that work?';
await q('update icash_text_ai_jobs set analysis=$1,reply=$2 where message_id=$3',[{offerPolicy:'seller-text-offer-v1',offerAction:'cash_offer',offerState:state,offerPlan:{kind:'message',action:'cash_offer',body:quote}},quote,m.id]);
await q('update icash_text_messages set body=$1 where id=(select outgoing_id from icash_text_ai_jobs where message_id=$2)',[quote,m.id]);
const envelope=randomUUID(),recipients=[{id:'seller',email:'seller@example.invalid'},{id:'buyer',email:'buyer@example.invalid'}];
const evidence={id:'envelope_fixture',test_mode:false,status:'completed',apply_signing_order:true,metadata:{icash_envelope:envelope,terms_hash:'hash'},recipients:recipients.map((v,i)=>({...v,status:'signed',signing_order:i+1}))};
await q("insert into icash_signing_envelopes(id,account_id,deal_id,kind,state,test_mode,provider_id,terms_hash,recipients,provider_evidence,updated_at) values($1,$2,$3,'purchase','completed',false,'envelope_fixture','hash',$4,$5,$6)",[envelope,c.a,c.d,JSON.stringify(recipients),evidence,at(60)]);
r=await report();assert.equal(r.offers.currentQuoteSmsDelivered,1);assert.equal(r.offers.verifiedPurchaseSigned,1);assert.equal(r.offers.acceptedWithoutVerifiedPurchaseOnDeal,0);
await q('update icash_signing_envelopes set test_mode=true');assert.equal((await report()).offers.verifiedPurchaseSigned,0);
await q("update icash_call_offer_private.events set account_id=$1",[unknown.a]);assert.equal((await report()).offers.observedDeals,0);
await pg.exec('begin read only;set role service_role');await report();await pg.exec('reset role;commit');
await q("insert into icash_text_messages(account_id,thread_id,direction,state,event_id,created_at) select $1,$2,'incoming','received','synthetic-'||g,now()-interval '10 minutes' from generate_series(1,2100) g",[c.a,c.t]);
r=await report();assert.equal(r.complete,false);assert.equal(r.truncated.replies,true);assert.equal(r.replies.observed,2000);
await pg.exec('analyze');
const plan=await q("explain (format json) select id from icash_text_messages where direction='incoming' and state='received' and created_at>=now()-interval '7 days' and created_at<now() order by created_at desc,id desc limit 2001");
assert.match(JSON.stringify(plan.rows),/icash_conversion_received_recent/);
if(native){
 // Large old cohorts prove recent LIMITs use the new time indexes, not full history.
 for(const [table,columns,values] of [
  ['icash_text_messages','account_id,thread_id,direction,state,event_id,created_at',"$1,$2,'incoming','received','old-'||g,now()-interval '40 days'"],
  ['icash_call_recordings','account_id,screening_id,call_sid,dial_claimed_at',"$1,$3,'CA_old',now()-interval '40 days'"],
  ['icash_call_offer_private.events','account_id,deal_id,call_key,created_at',"$1,$4,'unknown',now()-interval '40 days'"],
  ['icash_live_callbacks','account_id,screening_id,conversation_id,created_at',"$1,$3,$5,now()-interval '40 days'"],
 ])await q(`with seed as(select $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid) insert into ${table}(${columns}) select ${values} from generate_series(1,30000) g`,[c.a,c.t,c.s,c.d,live]);
 await q("insert into icash_call_recordings(account_id,screening_id,call_sid,dial_claimed_at) select $1,$2,'CA_recent',now()-interval '5 minutes' from generate_series(1,2100)",[c.a,c.s]);
 await q("insert into icash_call_offer_private.events(account_id,deal_id,call_key,created_at) select $1,$2,'sms:00000000-0000-0000-0000-000000000000',now()-interval '5 minutes' from generate_series(1,2100)",[c.a,c.d]);
 await q("insert into icash_live_callbacks(account_id,screening_id,conversation_id,state,due_at,created_at) select $1,$2,$3,'held_for_human',now(),now()-interval '5 minutes' from generate_series(1,2100)",[c.a,c.s,live]);
 await pg.exec('analyze');
 const begin=performance.now();r=await report();const elapsed=performance.now()-begin;
 assert.deepEqual(r.truncated,{replies:true,calls:true,offerEvents:true,callbacks:true});assert(elapsed<8000,`report ${elapsed}ms`);
 const sql=read('../config/seller-conversion-report.sql');
 const body=sql.slice(sql.indexOf(' with recent_received'),sql.indexOf(' into report;')).replace(/\bstart_at\b/g,"(now()-interval '7 days')").replace(/\bfinish\b/g,'now()').replace(/\bcap\b/g,'2000').replace(/\bp_days\b/g,'7').replace(/\bowner_id\b/g,`'${owner}'::uuid`);
 const explained=await q('explain (analyze,buffers,format json) '+body);
 const planText=JSON.stringify(explained.rows);
 for(const index of ['received','recorded','offer','callbacks'])assert(planText.includes('icash_conversion_'+index+'_recent'),index+' recent index');
 console.log(`Native PostgreSQL: 120000 historical rows, >2000 recent rows per source; report ${elapsed.toFixed(1)}ms; all four recent-source index paths verified.`);
}
for(const patch of [{complete:true},{replies:{...r.replies,dispatchLatencySeconds:{samples:1,p50:null,p90:null,max:null}}},{offers:{...r.offers,acceptanceRecorded:1}},{startAt:'not a timestamp'}])assert.equal(validSellerConversionReport({...r,...patch},7),false);
await pg.close();console.log('PASS private seller conversion report: SQL evidence, exclusions, unknowns, exact calls, stale progress, human continuation, source cap, read-only role security and indexed recent reads.');
