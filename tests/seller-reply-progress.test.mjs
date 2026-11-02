import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {planSellerProgress} from '../lib/seller-progress-policy.ts';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const fixture=read('./helpers/seller-progress-fixture.sql'),split=fixture.indexOf('create function icash_queue_ai_reply(');
const original=read('./fixtures/seller-progress-original-functions.sql');
const fn=(file,name)=>{const s=read('../config/'+file+'.sql'),start=s.indexOf('create function public.'+name+'(');assert(start>=0,name);const tag=s.slice(start).match(/\bas (\$[A-Za-z_]*\$)/i)[1];const body=s.indexOf(tag,start);return s.slice(start,s.indexOf(tag+';',body+tag.length)+tag.length+1);};
const setup=fixture.slice(0,split)+original+fixture.slice(split)+fn('seller-response-policy','icash_seller_direct_response_match')+fn('seller-response-policy','icash_seller_response_disposition')+fn('seller-gap-recovery','icash_seller_contact_stop')+`create trigger icash_text_ai_incoming after insert on icash_text_messages for each row execute function icash_enqueue_text_ai();`;
// Optional localhost native test runner consumes this same SQL fixture.
if(process.env.SELLER_PROGRESS_FIXTURE_OUTPUT)writeFileSync(process.env.SELLER_PROGRESS_FIXTURE_OUTPUT,setup);
const pg=await PGlite.create();
await pg.exec(setup);
const q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>(await q(sql,args)).rows[0];
const rpc=async(name,args)=>Object.values(await one(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args))[0];
async function seed(){const a=randomUUID(),t=randomUUID(),d=randomUUID(),s=randomUUID();
 await q('insert into icash_accounts(id) values($1)',[a]);
 await q("insert into icash_screening_jobs(id,account_id,snapshot,result) values($1,$2,$3,$4)",[s,a,{propertyId:s},{preliminarySellerCeilingCents:12938400,offerAuthorized:true}]);
 await q("insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,$4)",[d,a,s,{address:'Fixture property'}]);
 await q('insert into icash_text_threads(id,account_id,deal_id,recipient) values($1,$2,$3,$4)',[t,a,d,'+1555'+Math.floor(Math.random()*9999999).toString().padStart(7,'0')]);return {a,t,d,s};
}
async function incoming(c,body,minutes=1){return (await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id,created_at) values($1,$2,'incoming','received',$3,$4,now()-$5*interval '1 minute') returning id",[c.a,c.t,body,randomUUID(),minutes])).id;}
async function outgoing(c,body,{manual=false,minutes=2,state='delivered',receipt=true}={}){return (await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,customer_author_id,provider_id,created_at) values($1,$2,'outgoing',$3,$4,$5,$6,now()-$7*interval '1 minute') returning id",[c.a,c.t,state,body,manual?randomUUID():null,receipt?randomUUID():null,minutes])).id;}
async function draft(c,m,action='ask_callback',facts=[]){return (await one("update icash_text_ai_jobs set state='drafted',analysis=$3 where account_id=$1 and message_id=$2 returning id",[c.a,m,{action,facts}])).id;}
const refresh=(c,m,failure=null)=>rpc('icash_refresh_seller_reply_progress',[c.a,m,failure]);

// Reproduce the original stranded-draft/repeated-action cause before applying fix.
const floral=await seed(),first=await incoming(floral,'Yes',30),firstJob=await draft(floral,first);
const firstOut=await rpc('icash_queue_ai_reply',[floral.a,firstJob,'When is a good time to talk about a cash offer?']);assert.ok(firstOut);
await q("update icash_text_messages set state='delivered',provider_id='first-receipt',created_at=now()-interval '25 minutes' where id=$1",[firstOut]);
await outgoing(floral,'Is $210,000 reasonable?',{manual:true,minutes:20});
const accepted=await incoming(floral,'$210,000 works for me.',10);await draft(floral,accepted);
const okay=await incoming(floral,'Ok',5),floralJob=await draft(floral,okay,'ask_callback',[{kind:'price',quote:'$210,000 works for me.'}]);
assert.equal(await rpc('icash_queue_ai_reply',[floral.a,floralJob,'When is a good time to talk about a cash offer?']),null);
assert.equal(await rpc('icash_issue_due_text_ai',[]),null,'Original issuer excludes the stranded draft');
assert.equal((await one('select state from icash_text_ai_jobs where id=$1',[floralJob])).state,'drafted');
await q("update icash_deal_files set terms=terms||'{\"priceCents\":21500000}' where id=$1",[floral.d]);

// Original ownership-stage route drops a price question, with current unpaused account.
await pg.exec('update fixture_flags set conversation=false');
const memphis=await seed(),owner=await outgoing(memphis,'Is this the owner of Fixture property?');
await q('insert into icash_sms_seller_openings(account_id,thread_id,owner_question_id) values($1,$2,$3)',[memphis.a,memphis.t,owner]);
const howmuch=await incoming(memphis,'How much ');
assert.equal((await one('select count(*)::int n from icash_text_ai_jobs where message_id=$1',[howmuch])).n,0);
assert.equal((await one('select bot_paused from icash_accounts where id=$1',[memphis.a])).bot_paused,false);
await pg.exec(read('../config/seller-reply-progress.sql'));
await pg.exec('update icash_seller_progress_settings set enabled=true');
let r=await refresh(memphis,howmuch);assert.equal(r.reason,'ownership_offer_question');
assert.equal((await one('select owner_reply_id from icash_sms_seller_openings where thread_id=$1',[memphis.t])).owner_reply_id,null);
await q('update icash_accounts set bot_paused=true where id=$1',[memphis.a]);
r=await refresh(memphis,howmuch);assert.equal(r.reason,'account_paused');assert(r.context.blockers.includes('account_paused'));

r=await refresh(floral,okay);assert.equal(r.reason,'price_reconciliation');assert.equal(r.context.proposedPriceCents,21500000);assert.equal(r.context.modelEstimateCents,12938400);
assert.equal(r.context.offerAuthorityPresent,false);assert.equal(r.context.offerAuthorized,false);assert.equal(r.context.customerNegotiation,true);
assert(r.context.priceStatements.some(x=>x.quote==='$210,000 works for me.'));
assert.equal((await rpc('icash_resume_seller_text_ai',[floral.a,floralJob])).mode,'held');
assert.equal((await one('select count(*)::int n from icash_signing_envelopes')).n,0);
await pg.exec('update fixture_flags set conversation=true');
const rockport=await seed();await incoming(rockport,"Yes, I'm only interested in a cash offer. No 3rd parties",10);
await incoming(rockport,'Then text.me to set up a visit',5);const pictures=await incoming(rockport,'Pictures are there');const rockJob=await draft(rockport,pictures);
r=await refresh(rockport,pictures);assert.equal(r.reason,'third_party_condition');assert.equal(r.context.visitRequests.length,1);assert.equal(r.milestone,'buyer_model_review');
assert.equal((await rpc('icash_resume_seller_text_ai',[rockport.a,rockJob])).mode,'held');

const normal=await seed(),answer=await incoming(normal,'The roof needs work.'),job=await draft(normal,answer,'ask_price',[{kind:'condition',quote:'The roof needs work.'}]);
r=await refresh(normal,answer);assert.equal(r.state,'pending');assert.deepEqual(r.context.answered,['condition']);
assert.ok(await rpc('icash_issue_due_text_ai',[]),'Issuer recovers a fresh saved draft');
assert.equal((await one('select state from icash_text_ai_jobs where id=$1',[job])).state,'drafted','Recovery preserves saved analysis');
const resumed=await rpc('icash_resume_seller_text_ai',[normal.a,job]);assert.equal(resumed.mode,'dispatch');
assert.equal((await rpc('icash_resume_seller_text_ai',[normal.a,job])).messageId,resumed.messageId);
assert.equal((await one('select count(*)::int n from icash_text_messages where request_key=$1',[job])).n,1);
assert.equal((await refresh(normal,answer)).reason,'awaiting_dispatch');
assert.ok(await rpc('icash_claim_text',[normal.a,resumed.messageId,'+15550000001']));
assert.equal(await rpc('icash_claim_text',[normal.a,resumed.messageId,'+15550000001']),null,'No second provider claim');
r=await refresh(normal,answer);assert.equal(r.reason,'provider_receipt_unresolved');
assert.equal((await rpc('icash_resume_seller_text_ai',[normal.a,job])).mode,'held');
await q("update icash_text_messages set state='accepted',provider_id='original-provider' where id=$1",[resumed.messageId]);
assert.equal((await refresh(normal,answer)).reason,'provider_delivery_pending');
assert.equal((await one("select state from icash_text_attention where thread_id=$1 and kind='seller_progress'",[normal.t])).state,'acknowledged','Late original receipt resolves the receipt review without a resend');
await q("update icash_text_messages set state='delivered' where id=$1",[resumed.messageId]);
assert.equal((await refresh(normal,answer)).reason,'awaiting_seller_reply');
await q("update icash_text_messages set updated_at=now()-interval '25 hours' where id=$1",[resumed.messageId]);
assert.equal((await refresh(normal,answer)).reason,'followup_due');
await q("update icash_text_messages set state='failed' where id=$1",[resumed.messageId]);
assert.equal((await refresh(normal,answer)).reason,'provider_delivery_failed');

// Duplicate webhook receipt creates neither another job nor another review item.
const unknown=await seed();await pg.exec('update fixture_flags set conversation=false');
const unanswered=await incoming(unknown,'Can you explain the next step?');
assert.equal((await refresh(unknown,unanswered)).reason,'reply_not_routed');
const source=await one('select * from icash_text_messages where id=$1',[unanswered]);
await q("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id) values($1,$2,'incoming','received',$3,$4) on conflict(event_id) do nothing",[unknown.a,unknown.t,source.body,source.event_id]);
await refresh(unknown,unanswered);assert.equal((await one('select count(*)::int n from icash_text_attention where thread_id=$1',[unknown.t])).n,1);
assert.equal(await rpc('icash_refresh_seller_reply_progress',[floral.a,unanswered,null]),null,'Tenant fence');
await pg.exec('update fixture_flags set conversation=true');

for(const [change,reason] of [
 ["update icash_accounts set bot_paused=true where id=$1",'account_paused'],
 ["update icash_text_threads set manual_only=true where account_id=$1",'manual_control'],
 ["update icash_text_threads set paused=true where account_id=$1",'manual_control'],
 ["update icash_text_threads set permission_until=now()-interval '1 second' where account_id=$1",'contact_checks_required'],
 ["update icash_text_messages set event_id=null where account_id=$1 and direction='incoming'",'source_receipt_missing']
]){const c=await seed(),m=await incoming(c,'Needs a roof'),j=await draft(c,m,'ask_price');await q(change,[c.a]);assert.equal((await refresh(c,m)).reason,reason);assert.equal((await rpc('icash_resume_seller_text_ai',[c.a,j])).mode,'held');assert.equal((await one("select count(*)::int n from icash_text_messages where account_id=$1 and direction='outgoing'",[c.a])).n,0);}
const existing=await seed(),existingm=await incoming(existing,'How much for the property?');
await q("delete from icash_text_attention where thread_id=$1",[existing.t]);
await q("insert into icash_text_attention(account_id,thread_id,deal_id,screening_id,message_id,kind,party,quote) values($1,$2,$3,$4,$5,'campaign_reply','seller','How much for the property?')",[existing.a,existing.t,existing.d,existing.s,existingm]);
await q("delete from icash_text_ai_jobs where message_id=$1",[existingm]);await refresh(existing,existingm);
assert.equal((await one('select count(*)::int n from icash_text_attention where thread_id=$1',[existing.t])).n,1,'Reuse existing campaign review');
assert.equal((await one('select progress_reason from icash_text_attention where thread_id=$1',[existing.t])).progress_reason,'reply_not_routed');
const delayed=await seed();await incoming(delayed,'Needs a roof',5);const event=randomUUID();
await q("insert into icash_text_events values($1,jsonb_build_object('timestamp',extract(epoch from now()-interval '2 days')))",[event]);
const late=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id) values($1,$2,'incoming','received','Yes',$3) returning id",[delayed.a,delayed.t,event])).id;
assert.equal((await refresh(delayed,late)).state,'superseded','Delayed provider event cannot replace a newer seller reply');
const old=await seed(),oldm=await incoming(old,'Would sell for 150k',60*48),oldj=await draft(old,oldm,'ask_price');assert.equal((await refresh(old,oldm)).reason,'historical_reply');assert.equal((await rpc('icash_resume_seller_text_ai',[old.a,oldj])).mode,'held');
const stop=await seed(),stopm=await incoming(stop,'STOP');assert.equal((await refresh(stop,stopm)).state,'stopped');
const superseded=await seed(),sm=await incoming(superseded,'Roof needs work',10),sj=await draft(superseded,sm,'ask_price');await incoming(superseded,'Actually wait, I need to check',1);assert.equal((await refresh(superseded,sm)).state,'superseded');assert.equal((await rpc('icash_resume_seller_text_ai',[superseded.a,sj])).mode,'held');
const crash=await seed(),cm=await incoming(crash,'Needs a roof'),cj=await draft(crash,cm,'ask_price');await q("update icash_text_ai_jobs set state='analyzing',updated_at=now()-interval '20 minutes' where id=$1",[cj]);assert.equal((await refresh(crash,cm)).reason,'analysis_receipt_unresolved');
const repeat=await seed(),rm=await incoming(repeat,'Yes',20),rj=await draft(repeat,rm);const ro=await rpc('icash_queue_ai_reply',[repeat.a,rj,'When is a good time to talk about a cash offer?']);await q("update icash_text_messages set created_at=now()-interval '10 minutes' where id=$1",[ro]);const rm2=await incoming(repeat,'Needs a roof'),rj2=await draft(repeat,rm2);assert.equal(await rpc('icash_queue_ai_reply',[repeat.a,rj2,'When is a good time to talk about a cash offer?']),null);assert.equal((await one('select progress_reason from icash_text_attention where thread_id=$1',[repeat.t])).progress_reason,'action_not_admitted');
const raw={action:'ask_callback',facts:[{kind:'condition',quote:'Needs a roof'}],humanRequested:false,callbackRequested:false,optedOut:false,declined:false};
assert.equal(planSellerProgress(raw,{priorActions:['ask_callback'],answered:['condition']}).action,'ask_price');
assert.equal(planSellerProgress(raw,{customerNegotiation:true}).action,'review');
assert.equal(planSellerProgress(raw,{priorActions:['ask_callback','ask_condition','ask_price','ask_timing','ask_owners','ask_occupancy']}).action,'review');
// An existing signed purchase keeps its independently authorized viewing lane.
const signed=await seed();await outgoing(signed,'The seller agreed to $210,000.',{manual:true,minutes:15});
const signedm=await incoming(signed,'Tomorrow afternoon works'),signedj=await draft(signed,signedm,'review');
await q("insert into icash_signing_envelopes(account_id,deal_id,state,provider_id) values($1,$2,'completed','signed-fixture')",[signed.a,signed.d]);
await pg.exec('update fixture_flags set viewing=true');assert.equal(await rpc('icash_seller_progress_gate',[signed.a,signedj]),true);
await pg.exec('update fixture_flags set viewing=false');r=await refresh(signed,signedm);assert.equal(r.milestone,'title_handoff');assert.equal(r.state,'needs_review');
const envelope=await seed(),em=await incoming(envelope,'Did you get the signed agreement?');await draft(envelope,em,'review');
await q("insert into icash_signing_envelopes(account_id,deal_id,state,provider_id) values($1,$2,'sent','envelope-fixture')",[envelope.a,envelope.d]);
r=await refresh(envelope,em);assert.equal(r.milestone,'signature_followup');assert.equal(r.reason,'signature_followup_review');
const qualified=await seed(),qm=await incoming(qualified,'Roof needed. 150000. Next month. All owners agree. Vacant.');
const qj=await draft(qualified,qm,'review',['condition','price','timing','owners','occupancy'].map(kind=>({kind,quote:'Roof needed.'})));
r=await refresh(qualified,qm);assert.equal(r.milestone,'offer_review');assert.equal(r.context.answered.length,5);
await q("insert into icash_offer_authorities(account_id,screening_id,max_offer_cents,expires_at) values($1,$2,15000000,now()+interval '1 hour')",[qualified.a,qualified.s]);
r=await refresh(qualified,qm);assert.equal(r.milestone,'contract_preparation');assert.equal(r.reason,'contract_authorization_review');assert.equal(r.context.offerAuthorized,false);
for(const role of ['anon','authenticated']){assert.equal((await one("select has_function_privilege($1,'icash_resume_seller_text_ai(uuid,uuid)','EXECUTE') allowed",[role])).allowed,false);assert.equal((await one("select has_table_privilege($1,'icash_seller_reply_progress','SELECT') allowed",[role])).allowed,false);}
await pg.close();
console.log('Seller reply progress: original failures reproduced; source-bound reviews, safe draft recovery, receipt/failure distinction, duplicate events, pauses, account isolation, historical holds, conflicting prices and missing-answer alternatives passed.');
