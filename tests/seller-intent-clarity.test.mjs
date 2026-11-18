// OFFLINE ONLY. Synthetic seller threads; real SQL planning/save/claim boundaries.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertDisposablePostgresTarget} from './helpers/disposable-postgres-target.mjs';
import {PGlite} from '@electric-sql/pglite';
import {processSellerTextOffer} from '../lib/seller-text-offer-service.ts';
import {planSellerTextOffer} from '../lib/seller-text-offer.ts';
import {sellerIntentClarity,sellerIntentClarityPatterns,sellerIntentClarityReplies} from '../lib/seller-intent-clarity.ts';
globalThis.fetch=async()=>{throw Error('NO NETWORK: offline fixtures only');};
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const fixture=read('./helpers/seller-progress-fixture.sql'),split=fixture.indexOf('create function icash_queue_ai_reply(');
const fn=(file,name)=>{const s=read('../config/'+file+'.sql'),start=s.indexOf('create function public.'+name+'('),tag=s.slice(start).match(/\bas (\$[A-Za-z_]*\$)/i)[1],body=s.indexOf(tag,start);return s.slice(start,s.indexOf(tag+';',body+tag.length)+tag.length+1);};
const native=process.env.ICASH_INTENT_NATIVE==='1';
async function openNative(){
 const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
 const client=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',connectionTimeoutMillis:5000});
 await client.connect();await assertDisposablePostgresTarget(client);await client.query("set statement_timeout='12s';set lock_timeout='2s';set timezone='UTC'");client.exec=sql=>client.query(sql);client.close=()=>client.end();return client;
}
const pg=native?await openNative():await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
const rpc=async(n,args=[])=>Object.values(await one(`select ${n}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args))[0];
try{
await pg.exec(fixture.slice(0,split)+read('./fixtures/seller-progress-original-functions.sql')+fixture.slice(split)+read('./helpers/seller-dialogue-fixture.sql')+read('./fixtures/seller-dialogue-original-functions.sql')+
 fn('seller-response-policy','icash_seller_direct_response_match')+fn('seller-response-policy','icash_seller_response_disposition')+fn('seller-gap-recovery','icash_seller_contact_stop')+
 'create trigger icash_text_ai_incoming after insert on icash_text_messages for each row execute function icash_enqueue_text_ai();'+read('../config/seller-reply-progress.sql')+read('../config/seller-dialogue.sql')+
 read('./helpers/seller-text-offer-fixture.sql')+read('./fixtures/seller-text-offer-original-functions.sql')+read('../config/seller-text-offer.sql')+read('../config/seller-offer-receipt-wait.sql')+read('../config/seller-offer-source-prices.sql')+read('./helpers/seller-call-terminal-fixture.sql')+read('../config/seller-call-terminal-progress.sql'));
await pg.exec("update icash_seller_progress_settings set enabled=true,dialogue_enabled=true,offer_enabled=true,offer_enabled_at=now()-interval '2 hours'");
let tick=0;
const at=()=>new Date(Date.now()-3600000+(++tick)*1000).toISOString();
const terms={seller:'',buyer:'Fixture Buyer',address:'45 Oak Road',legalDescription:'Lot 1, Fixture Subdivision',state:'TX',priceCents:21500000,priceSource:'proposed'};
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:terms.address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
async function incoming(c,body,extra={}){return one("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id,created_at) values($1,$2,'incoming','received',$3,$4,$5) on conflict(event_id) do update set body=icash_text_messages.body returning *",[c.a,c.t,body,extra.event??randomUUID(),extra.at??at()]);}
async function seed({qualified=true}={}){
 const c={a:randomUUID(),t:randomUUID(),d:randomUUID(),s:randomUUID(),u:randomUUID(),phone:'+1214'+Math.floor(Math.random()*9999999).toString().padStart(7,'0')};
 await q('insert into auth.users(id,email) values($1,$2)',[c.u,'owner@example.invalid']);await q('insert into icash_accounts(id,owner_user_id) values($1,$2)',[c.a,c.u]);
 await q('insert into icash_customer_identities values($1,$2)',[c.a,terms.buyer]);
 await q('insert into icash_screening_jobs(id,account_id,snapshot,result) values($1,$2,$3,$4)',[c.s,c.a,snapshot,{financialCheck:{status:'eligible'}}]);
 await q('insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,$4)',[c.d,c.a,c.s,terms]);
 await q('insert into icash_text_threads(id,account_id,deal_id,recipient) values($1,$2,$3,$4)',[c.t,c.a,c.d,c.phone]);
 await q("insert into icash_sms_routes(sender,recipient,account_id) values('+15550000001',$1,$2)",[c.phone,c.a]);
 if(qualified)for(const [question,answer] of [['Are you the owner of this property?','Yes'],['Are you looking to sell?','Yes'],['What has you thinking about selling?','I am moving'],['What repairs does it need?','It needs paint'],['Is anyone living there?','It is vacant'],['When would you like to sell?','Next month'],['Is it listed with a real estate agent?','No']]){
  await q("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,'outgoing','delivered',$3,'fixture-history',$4)",[c.a,c.t,question,at()]);await incoming(c,answer);
 }
 return c;
}
const db=async(path,method,body)=>{
 if(path==='rpc/icash_outreach_voice_current')return false;
 if(path==='rpc/icash_seller_memory_context')return null;
 if(path==='rpc/icash_seller_prior_call_context')return [];
 assert(path.startsWith('rpc/'));return rpc(path.slice(4),Object.values(body));
};
const dependencies={db,dispatch:async(a,id)=>{
 assert(await rpc('icash_claim_text',[a,id,'+15550000001']),'existing final admission in the offline fixture');
 assert.equal(await rpc('icash_claim_text',[a,id,'+15550000001']),null,'duplicate final claim');
 await q("update icash_text_messages set state='delivered',provider_id=$1,created_at=$2 where id=$3",['receipt-'+id,at(),id]);return {status:'message_delivered'};
},send:async()=>{throw Error('NO SIGNING: informational replies only');},text:async()=>{throw Error('NO AGREEMENT TEXT: informational replies only');}};
const gaps=read('../config/seller-gap-recovery.sql');
await pg.exec(gaps.slice(gaps.indexOf('create table public.icash_seller_gaps('),gaps.indexOf('create function public.icash_seller_contact_stop')));
await pg.exec(`
 create schema icash_learning_policy_private;create table icash_learning_policy_private.cash_question_settings(id integer,enabled_at timestamptz);
 alter table icash_text_threads add column operational_contact_id uuid;
 alter table icash_seller_progress_settings add column voice_text_enabled_at timestamptz,add column initial_reply_enabled_at timestamptz;
 alter table icash_operation_spend add column dispatched_at timestamptz;
 create table icash_live_callbacks(account_id uuid,screening_id uuid,state text);
 create table icash_contact_suppressions(contact_key text);
 create table icash_cancellation_notices(account_id uuid,sms_id uuid);
 create table icash_live_conversations(account_id uuid,screening_id uuid,contact_key text,state text,completed_at timestamptz,conversation_id text,result jsonb);
 create function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select false$$;
 create function icash_seller_has_cash_question(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_seller_cash_identity_reply(text,text) returns text language sql as $$select null::text$$;
 create function icash_seller_post_call_identity_reply(uuid,uuid) returns text language sql as $$select null::text$$;
 create function icash_seller_voice_text_wait_call(uuid,uuid) returns uuid language sql as $$select null::uuid$$;
 create function icash_seller_voice_text_context(uuid,uuid) returns boolean language sql as $$select false$$;
 create function icash_conversation_street(text) returns text language sql as $$select $1$$;
 create function icash_seller_sms_permission_current(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
 create function icash_current_viewing_slots(uuid,uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
 drop function icash_seller_recovery_nonprice_current(uuid,uuid);
`);
await pg.exec(fn('seller-gap-recovery','icash_choose_seller_recovery'));
for(const row of JSON.parse(read('./fixtures/seller-conversion-baseline.json')))await pg.exec(row.definition+';');
await pg.exec(read('../config/seller-natural-refusals.sql')+read('../config/seller-soft-withdrawal.sql'));

await pg.exec(read('../config/seller-conversion-followthrough.sql')+read('../config/seller-conversion-inactive-compatibility.sql'));
await pg.exec(`create function icash_seller_current_cash_identity_reply(uuid,uuid,text) returns text language sql as $$select null::text$$;create function icash_seller_memory_context(uuid,uuid,text) returns jsonb language sql as $$select null::jsonb$$;create schema icash_seller_memory_private;create table icash_seller_memory_private.settings(id integer primary key,enabled boolean default false,enabled_at timestamptz);insert into icash_seller_memory_private.settings(id) values(1);
create schema icash_recorded_reception_private;create table icash_recorded_reception_private.sessions(id uuid,account_id uuid,nonce_hash text,from_phone text);create table icash_recorded_reception_private.configs(id uuid);
create function icash_reception_context_before_meta(uuid,text) returns jsonb language sql as $$select null::jsonb$$;`);
await pg.exec(fn('seller-recovery-answer-continuity','icash_seller_recovery_reply_action'));
await pg.exec(read('./fixtures/seller-shared-memory-original-functions.sql'));
await pg.exec("create function public.icash_seller_memory_enabled(uuid) returns boolean language sql stable as $$select enabled from icash_seller_memory_private.settings where id=1$$;");
await pg.exec(read('../config/seller-shared-memory-routing.sql'));
await pg.exec("update icash_seller_progress_settings set conversion_enabled_at=now()-interval '2 hours'");

// Install the exact November 17 production predecessors, not reconstructed SQL.
await pg.exec("alter table icash_seller_progress_settings add column if not exists voice_receipt_wait_enabled_at timestamptz;");
for(const row of JSON.parse(read('./fixtures/seller-purpose-response-dependencies.json')))await pg.exec(row.definition+';');
const exact=JSON.parse(read('./fixtures/seller-intent-clarity-before.json'));
for(const row of exact){
 await pg.exec(row.definition+';');
 await pg.exec(`revoke all on function public.${row.signature} from public,anon,authenticated;grant execute on function public.${row.signature} to service_role;`);
 assert.equal((await one('select md5(pg_get_functiondef(to_regprocedure($1))) hash',['public.'+row.signature])).hash,row.hash,row.signature);
}
const before=await seed({qualified:false});
const oldOwner=await incoming(before,'Who owns it?');
assert.equal((await rpc('icash_seller_dialogue_context',[before.a,oldOwner.id])).action,'clarify_question');
const oldCallback=await incoming(before,"I'll call you back.");
assert.equal((await rpc('icash_seller_dialogue_context',[before.a,oldCallback.id])).action,null);
const migration=read('../config/seller-intent-clarity.sql');
assert.equal(migration,read('../supabase/migrations/20261117184851_seller_intent_clarity.sql'));
for(const pattern of Object.values(sellerIntentClarityPatterns))assert(migration.includes('$pattern$'+pattern+'$pattern$'));
await pg.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key)');
for(const corrupt of [
 'alter function public.icash_seller_dialogue_context(uuid,uuid) security definer',
 'grant execute on function public.icash_seller_text_offer_context(uuid,uuid) to authenticated',
 "create or replace function public.icash_seller_information_action(p_action text) returns boolean language sql immutable set search_path='' as $$select false$$",
]){
 await pg.exec('begin;'+corrupt+';');await assert.rejects(pg.exec(migration),/Seller intent clarity prerequisite changed/);await pg.exec('rollback');
 assert.equal((await one("select to_regprocedure('public.icash_seller_intent_clarity(text)') value")).value,null);
}
await pg.exec('begin;'+migration+"insert into supabase_migrations.schema_migrations values('fixture');");
await assert.rejects(pg.exec("insert into supabase_migrations.schema_migrations values('fixture')"),/duplicate key/);await pg.exec('rollback');
assert.equal((await one("select to_regprocedure('public.icash_seller_intent_clarity(text)') value")).value,null,'history failure rolls back function changes');
await pg.exec('begin;'+migration+"insert into supabase_migrations.schema_migrations values('fixture');commit;");
const positives={caller_returning:["I'll call you back.",'I’ll call back later.','I will call you later.'],ownership_question:['Who owns it?','Who owns the property?','Who is the owner of the house?']};
for(const [kind,phrases] of Object.entries(positives))for(const body of phrases){
 assert.equal(sellerIntentClarity(body),kind);assert.equal(await rpc('icash_seller_intent_clarity',[body]),kind);
 const c=await seed({qualified:false}),source=await incoming(c,body);
 const dialogue=await rpc('icash_seller_dialogue_context',[c.a,source.id]);
 assert.equal(dialogue.action,kind==='caller_returning'?'intent_caller_returning':'clarify_ownership',body);
 assert.equal(dialogue.reply,sellerIntentClarityReplies[kind]);assert.equal(dialogue.question,null);
 assert.equal((await one('select count(*)::int n from icash_sms_call_requests where account_id=$1',[c.a])).n,0,'caller returning creates no outbound call request');
 const context=await rpc('icash_seller_text_offer_context',[c.a,source.id]);
 assert(context,'the original offer context admits the exact current informational source');
 assert.equal(context.intentClarity,kind);
 const plan=planSellerTextOffer(context);assert.equal(plan.kind,'message');assert.equal(plan.body,dialogue.reply);assert.equal(plan.state.acceptedPriceCents,null);
 const wrong=structuredClone(context);wrong.intentClarity=kind==='caller_returning'?'ownership_question':'caller_returning';assert.notEqual(planSellerTextOffer(wrong).body,dialogue.reply,'source classification must agree with server marker');
 const remembered=structuredClone(context);
 remembered.offerState={...plan.state,processedSource:'previous-source',proposedPriceCents:16000000,quotedPriceCents:15000000,acceptedPriceCents:15000000,quoteRevision:'prior-quote',factsPending:true,closing:{legalName:'Original Seller',date:'2026-12-31',inspection:'yes'},pendingAskingPriceCents:17000000};
 const interrupted=planSellerTextOffer(remembered);
 assert.deepEqual(interrupted.state,{...remembered.offerState,processedSource:context.sourceId,textThreadId:context.threadId},'informational interruption preserves pending facts and actual prior confirmations');
 remembered.messages.splice(remembered.messages.length-1,0,...[0,1].map(index=>({id:'delivered-'+index,direction:'outgoing',state:'delivered',providerId:'receipt-'+index,body:dialogue.reply,action:'intent_'+kind})));
 assert.equal(planSellerTextOffer(remembered).kind,'review','same informational answer cannot loop indefinitely');
 const other=await rpc('icash_seller_intent_clarity_source',[randomUUID(),source.id]);assert.equal(other,null);
 const job=await one('select * from icash_text_ai_jobs where message_id=$1',[source.id]);
 assert.equal(job.analysis.dialogueAction,dialogue.action,'actual incoming route selects the exact informational action');
 const resumed=await rpc('icash_resume_seller_text_ai',[c.a,job.id]);assert.equal(resumed.mode,'seller_offer',JSON.stringify(resumed));
 const delivered=await processSellerTextOffer(resumed.context,dependencies);assert.equal(delivered.status,'message_delivered');
 const saved=await one('select * from icash_text_ai_jobs where id=$1',[job.id]);
 const outgoing=await one('select * from icash_text_messages where id=$1',[saved.outgoing_id]);assert.equal(outgoing.body,dialogue.reply);
 assert.equal(outgoing.state,'delivered');
}
for(const body of ['Call me back.','Please call me later.',"I'll call you back if you pay more.","I'll call you back. Stop texting.",'My wife said I will call you back.','Who owns it? I accept.','Who owns it? Wire me money.','Who owns it? Stop calling.','Who owns that other house?','What is the name of the owner?','Who owns it? I want a human.']){
 assert.equal(sellerIntentClarity(body),null,body);assert.equal(await rpc('icash_seller_intent_clarity',[body]),null,body);
}
// Current explicit controls continue to govern both original routes.
for(const [sql,label] of [
 ['update icash_accounts set bot_paused=true where id=$1','account pause'],
 ['update icash_text_threads set manual_only=true where account_id=$1','manual control'],
 ['update icash_text_threads set paused=true where account_id=$1','thread pause'],
 ['update icash_text_threads set permission_until=now()-interval \'1 second\' where account_id=$1','contact expiry'],
]){
 const c=await seed({qualified:false}),source=await incoming(c,'Who owns it?');
 const context=await rpc('icash_seller_text_offer_context',[c.a,source.id]);assert(context,label);
 await q(sql,[c.a]);assert.equal(await rpc('icash_seller_text_offer_context',[c.a,source.id]),null,label);
 assert.equal((await processSellerTextOffer(context,dependencies)).status,'text_ai_context_changed',label+' remains authoritative at save');
}
for(const sql of ['update icash_accounts set bot_paused=true where id=$1','update icash_text_threads set manual_only=true where account_id=$1','update icash_text_threads set permission_until=now()-interval \'1 second\' where account_id=$1']){
 const c=await seed({qualified:false}),source=await incoming(c,"I'll call you back.");
 const context=await rpc('icash_seller_text_offer_context',[c.a,source.id]);
 const saved=await rpc('icash_save_seller_text_offer',[c.a,context.jobId,context.fingerprint,context.offerVersion,planSellerTextOffer(context)]);assert(saved.messageId);
 await q(sql,[c.a]);assert.equal(await rpc('icash_claim_text',[c.a,saved.messageId,'+15550000001']),null,'late current control blocks final claim');
}
const staleResearch=await seed({qualified:false}),staleQuestion=await incoming(staleResearch,"I'll call you back.");
await q("update icash_screening_jobs set completed_at=now()-interval '2 days' where account_id=$1",[staleResearch.a]);
assert.equal(await rpc('icash_seller_text_offer_context',[staleResearch.a,staleQuestion.id]),null,'old research remains ineligible for offer context');
const staleJob=await one('select * from icash_text_ai_jobs where message_id=$1',[staleQuestion.id]);
assert.equal(await rpc('icash_seller_dialogue_reply',[staleResearch.a,staleJob.id]),sellerIntentClarityReplies.caller_returning,'current informational reply survives independent research age');
const expired=await seed({qualified:false}),expiredSource=await incoming(expired,"I'll call you back.",{at:new Date(Date.now()-48*3600000).toISOString()});
assert.equal(await rpc('icash_seller_intent_clarity_source',[expired.a,expiredSource.id]),null,'historical source is outside original cutover gate');
const changed=await seed({qualified:false}),first=await incoming(changed,'Who owns it?');await incoming(changed,'Stop contacting me.');
assert.equal(await rpc('icash_seller_text_offer_context',[changed.a,first.id]),null,'newer reply prevents stale plan');
const human=await seed({qualified:false}),humanSource=await incoming(human,"I'll call you back.");
await q("insert into icash_text_messages(account_id,thread_id,direction,state,body,provider_id,customer_author_id,created_at) values($1,$2,'outgoing','delivered','I will handle this discussion','fixture-human',$3,$4)",[human.a,human.t,randomUUID(),at()]);
assert.equal(await rpc('icash_seller_dialogue_context',[human.a,humanSource.id]),null,'human continuation takes precedence');
await pg.exec('update icash_seller_progress_settings set conversion_enabled_at=null');
assert.equal(await rpc('icash_seller_intent_clarity_source',[before.a,oldCallback.id]),null,'existing feature disable remains authoritative');
for(const role of ['anon','authenticated'])for(const name of ['icash_seller_intent_clarity(text)','icash_seller_intent_clarity_source(uuid,uuid)'])assert.equal((await one(`select has_function_privilege('${role}','${name}','execute') allowed`)).allowed,false);
assert.equal((await one('select count(*)::int n from icash_signing_envelopes')).n,0);
console.log('PASS seller intent clarity: exact live SQL predecessors, whole-source parity, dialogue/offer routes, no fabricated callback/ownership/acceptance, existing cutoff, controls and tenant isolation.');
}finally{await pg.close();}
