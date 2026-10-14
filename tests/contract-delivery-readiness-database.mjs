import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=process.argv[2]?await import(pathToFileURL(process.argv[2]).href):await import('@electric-sql/pglite');
const db=await PGlite.create(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),screen=id(2),call=id(3),deal=id(4),thread=id(5),owner=id(6),envelope=id(7),phone='+12125550101',hash='a'.repeat(64);
const date=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
const scope={callKey:'outbound:'+call,accountId:account,ownerUserId:owner,screeningId:screen,dealId:deal,phone};
const initial={address:'45 Fixture Lane',buyer:'Fixture Buyer',seller:'',state:'TX',legalDescription:'Lot 1 Block 2',priceCents:null,priceSource:'proposed',closingDate:'',inspectionDays:10,assignmentFeeCents:null,assignmentDepositCents:null,earnestCents:null};
const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:9000000,closingDate:date,soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'no',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
const confirmed={...initial,seller:confirmation.sellerLegalName,priceCents:confirmation.agreedPriceCents,priceSource:'seller_reported',closingDate:date},fees={...confirmed,assignmentFeeCents:1000000,assignmentDepositCents:200000};
const recipients=[{id:'1',name:confirmation.sellerLegalName,phone},{id:'2',name:initial.buyer,email:'owner@example.test'}];
const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0],source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema icash_seller_agreement_private;create schema icash_call_offer_private;
 create table icash_call_offer_private.offers(account_id uuid,deal_id uuid,snapshot jsonb,state jsonb);
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean default false,work_allowed boolean default true);
 create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb);
 create table public.icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb,updated_at timestamptz default now());
 create table public.icash_signing_envelopes(id uuid primary key,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean,provider_id text,terms jsonb,recipients jsonb,unique(deal_id,kind,test_mode));
 create table public.icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,recipient text,retired_at timestamptz,paused boolean default false,manual_only boolean default false,review_current boolean default true);
 create table public.icash_property_controls(account_id uuid,property_id text,manual boolean);create table public.icash_text_suppressions(phone text);create table public.icash_contact_suppressions(contact_key text);
 create table public.icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,conversation_id text,party text);
 create table public.icash_handoffs(id uuid default gen_random_uuid(),conversation_id uuid unique,account_id uuid,screening_id uuid,party text,reason text,summary text,next_action text);
 create table public.scope_fixture(value jsonb);
 -- Authentication, membership and provider review internals have separate
 -- suites. Explicit gates here surround the real agreement and queue functions.
 create function public.icash_seller_agreement_call_context(text,text) returns jsonb language sql as $$select value from public.scope_fixture where $1=repeat('a',64) and $2='conv_fixture'$$;
 create function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select coalesce((select work_allowed from public.icash_accounts where id=$1),false)$$;
 create function public.icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select coalesce((select review_current from public.icash_text_threads where account_id=$1 and id=$2),false)$$;
 create function public.icash_open_seller_gap(uuid,uuid,text,uuid,text,text,timestamptz) returns uuid language sql as 'select $2';`);
 const old=source('config/seller-call-agreement.sql');
 await db.exec(old.slice(old.indexOf('create table icash_seller_agreement_private.confirmations('),old.indexOf('create table icash_seller_agreement_private.rollouts(')));
 await db.exec(old.slice(old.indexOf('create function public.icash_claim_seller_agreement('),old.indexOf('create function public.icash_claim_seller_agreement_rollout(')));
 await db.exec('alter function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) rename to icash_claim_seller_agreement_before_offer');
 await db.exec(source('supabase/migrations/20261008153612_conditional_voice_offer_contract_hold.sql'));
 await db.exec(source('config/owner-agreement-delivery-recovery.sql'));
 const sql=source('config/contract-delivery-readiness.sql'),base=source('supabase/migrations/20261014191304_contract_delivery_readiness.sql'),locks=source('supabase/migrations/20261014192707_contract_delivery_lock_order.sql');
 assert.equal(sql,base.slice(0,base.indexOf('create or replace function public.icash_finish_agreement_delivery_recovery('))+locks.slice('begin;\n'.length));
 await db.exec(base);await db.exec(locks);
 await db.query('insert into auth.users values($1,$2,now())',[owner,'owner@example.test']);await db.query('insert into public.icash_accounts(id,owner_user_id) values($1,$2)',[account,owner]);
 await db.query("insert into public.icash_screening_jobs values($1,$2,'complete',$3)",[screen,account,{propertyId:'fixture-property'}]);
 await db.query("insert into public.icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft',$4)",[deal,account,screen,initial]);
 await db.query("insert into public.icash_live_conversations values($1,$2,$3,'conv_fixture','seller')",[call,account,screen]);
 const reset=async()=>{
  await db.exec(`delete from icash_seller_agreement_private.delivery_recovery;delete from icash_seller_agreement_private.confirmations;delete from public.icash_signing_envelopes;delete from public.icash_text_threads;delete from public.icash_handoffs;delete from public.icash_property_controls;delete from public.icash_text_suppressions;delete from public.icash_contact_suppressions;delete from public.scope_fixture;delete from icash_call_offer_private.offers;update public.icash_accounts set bot_paused=false,work_allowed=true;update public.icash_screening_jobs set state='complete';update auth.users set email_confirmed_at=now();`);
  await db.query("update public.icash_deal_files set stage='draft',terms=$1",[initial]);await db.query('update public.icash_live_conversations set account_id=$1',[account]);await db.query('insert into public.scope_fixture values($1)',[scope]);
 };
 const addThread=()=>db.query("insert into public.icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'seller',$4)",[thread,account,deal,phone]);
 const gap=()=>one('select public.icash_record_seller_tool_gap($1,$2,$3)',[hash,'conv_fixture','agreement_text_unavailable']);
 const defer=(expected=initial,terms=confirmed,answers=confirmation,token=hash)=>one('select public.icash_defer_seller_agreement($1,$2,$3,$4,$5)',[token,'conv_fixture',answers,expected,terms]);
 const claim=()=>one('select public.icash_claim_agreement_delivery_recovery()');
 const count=table=>one(`select count(*)::int from ${table}`);
 const addEnvelope=(terms=fees)=>db.query("insert into public.icash_signing_envelopes values($1,$2,$3,'purchase','awaiting_counterparty',false,'verified-provider',$4,$5)",[envelope,account,deal,terms,recipients]);
 const finish=(queue,result,env=envelope)=>one('select public.icash_finish_agreement_delivery_recovery($1,$2,$3)',[queue,env,result]);
 assert.equal(await gap(),null);await reset();const handoff=await gap();assert(handoff);assert.equal(await gap(),handoff);assert.equal(await count('public.icash_handoffs'),1);
 await db.query('update public.icash_live_conversations set account_id=$1',[id(99)]);assert.equal(await gap(),null);await addThread();assert.equal(await gap(),thread);
 await reset();assert.equal(await defer(initial,confirmed,confirmation,'bad-token'),null);
 for(const patch of [{sendTextRequested:false},{soleOwner:false},{allDecisionMakersAgree:false},{termsConfirmed:false},{materialFactsChanged:true}])assert.equal(await defer(initial,confirmed,{...confirmation,...patch}),null);
 assert.equal(await count('icash_seller_agreement_private.confirmations'),0);
 let queued=await defer();assert.equal(queued.queued,true);assert.equal(await count('public.icash_signing_envelopes'),0);assert.deepEqual(await defer(confirmed),queued);
 assert.equal(await count('icash_seller_agreement_private.confirmations'),1);assert.equal(await count('icash_seller_agreement_private.delivery_recovery'),1);assert.equal(await claim(),null,'Missing texting waits');
 await db.query('update public.icash_deal_files set terms=$1',[fees]);assert.deepEqual(await defer(fees,fees),queued,'Fee-only refresh remains the same request');
 assert.deepEqual(await one('select terms from icash_seller_agreement_private.confirmations'),confirmed);assert.deepEqual(await one('select terms from public.icash_deal_files'),fees);
 assert.equal(await defer(fees,{...fees,priceCents:9100000}),null);
 for(const change of [{seller:'Another Seller'},{closingDate:'2099-01-01'},{inspectionDays:0},{earnestCents:10000},{address:'Different property'},{legalDescription:'Different lot'},{dealNotes:'New terms'}]){
  await db.query('update public.icash_deal_files set terms=$1',[{...fees,...change}]);assert.equal(await claim(),null);assert.equal(await defer(fees,fees),null,'Seller-facing changes cannot reuse old consent');
 }
 await db.query('update public.icash_deal_files set terms=$1',[fees]);await addThread();
 const gates=[
  ['update public.icash_accounts set bot_paused=true','update public.icash_accounts set bot_paused=false',true],
  ['update public.icash_accounts set work_allowed=false','update public.icash_accounts set work_allowed=true',true],
  ["update public.icash_screening_jobs set state='archived'","update public.icash_screening_jobs set state='complete'",true],
  [`insert into public.icash_property_controls values('${account}','fixture-property',true)`,'delete from public.icash_property_controls',true],
  [`insert into public.icash_text_suppressions values('${phone}')`,'delete from public.icash_text_suppressions',true],
  [`insert into public.icash_contact_suppressions values(encode(sha256(convert_to('${phone}','UTF8')),'hex'))`,'delete from public.icash_contact_suppressions',true],
  ['update auth.users set email_confirmed_at=null','update auth.users set email_confirmed_at=now()',true],
  ["update public.icash_deal_files set stage='cancelled'","update public.icash_deal_files set stage='draft'",true],
  ['update public.icash_text_threads set review_current=false','update public.icash_text_threads set review_current=true',false],
  ['update public.icash_text_threads set paused=true','update public.icash_text_threads set paused=false',false],
  ['update public.icash_text_threads set manual_only=true','update public.icash_text_threads set manual_only=false',false],
  ['update public.icash_text_threads set retired_at=now()','update public.icash_text_threads set retired_at=null',false],
 ];
 for(const [block,restore,deferBlocked] of gates){await db.exec(block);assert.equal(await claim(),null,block);if(deferBlocked)assert.equal(await defer(fees,fees),null,block);assert.equal(await one('select state from icash_seller_agreement_private.delivery_recovery'),'queued');await db.exec(restore);}
 const accepted={acceptedPriceCents:9000000,quotedPriceCents:9000000};
 await db.query('insert into icash_call_offer_private.offers values($1,$2,$3,$4)',[account,deal,{propertyId:'fixture-property'},accepted]);
 for(const change of [{acceptedPriceCents:null},{quotedPriceCents:9100000},...['factsPending','conditionPending','agreementRevisionRequired','contractBlocked','acceptanceConditional','payoffPending'].map(key=>({[key]:true}))]){
  await db.query('update icash_call_offer_private.offers set state=$1',[{...accepted,...change}]);
  assert.equal(await claim(),null,'Later offer withdrawal or changed facts blocks automatic delivery');assert.equal(await defer(fees,fees),null);
 }
 await db.query('update icash_call_offer_private.offers set state=$1,snapshot=$2',[accepted,{propertyId:'fixture-property',changed:true}]);assert.equal(await claim(),null,'A changed underwriting snapshot needs renewed authority');
 await db.query('update icash_call_offer_private.offers set snapshot=$1',[{propertyId:'fixture-property'}]);
 const job=await claim();assert.equal(job.id,queued.id);assert.deepEqual(job.expectedTerms,fees);assert.equal(await claim(),null);assert.deepEqual(await defer(fees,fees),queued);
 assert.deepEqual(await one('select expected_terms from icash_seller_agreement_private.delivery_recovery'),fees);
 await addEnvelope();const confirmationId=await one('select id from icash_seller_agreement_private.confirmations');
 const finishDirect=()=>one('select public.icash_finish_seller_agreement($1,$2,$3)',[confirmationId,account,envelope]);
 await db.query('update public.icash_signing_envelopes set terms=$1',[{...fees,inspectionDays:0}]);assert.equal(await finishDirect(),false);await db.query('update public.icash_signing_envelopes set terms=$1',[fees]);
 for(const [block,restore] of [["update public.icash_signing_envelopes set state='needs_review'","update public.icash_signing_envelopes set state='awaiting_counterparty'"],['update public.icash_signing_envelopes set test_mode=true','update public.icash_signing_envelopes set test_mode=false'],['update public.icash_signing_envelopes set provider_id=null',"update public.icash_signing_envelopes set provider_id='verified-provider'"]]){await db.exec(block);assert.equal(await finishDirect(),false);await db.exec(restore);}
 assert.equal(await finishDirect(),true);assert.deepEqual(await one('select terms from icash_seller_agreement_private.confirmations'),confirmed);
 await db.exec("update icash_seller_agreement_private.confirmations set state='needs_review',envelope_id=null");
 assert.equal(await finish(queued.id,{sent:false,status:'held'}),true);assert.equal(await one('select state from icash_seller_agreement_private.confirmations'),'ready');
 assert.equal(await one('select state from icash_seller_agreement_private.delivery_recovery'),'needs_review');assert.deepEqual(await one('select result from icash_seller_agreement_private.delivery_recovery'),{sent:false,status:'held'});
 for(const state of ['creating','needs_review','awaiting_counterparty']){await reset();await addEnvelope(confirmed);await db.query('update public.icash_signing_envelopes set state=$1',[state]);assert.equal(await defer(),null);assert.equal(await count('icash_seller_agreement_private.delivery_recovery'),0);}
 await reset();queued=await defer();await addThread();await claim();await addEnvelope(confirmed);
 for(const [block,restore] of [
  [`update public.icash_signing_envelopes set account_id='${id(99)}'`,`update public.icash_signing_envelopes set account_id='${account}'`],
  ["update public.icash_signing_envelopes set kind='assignment'","update public.icash_signing_envelopes set kind='purchase'"],
  ['update public.icash_signing_envelopes set test_mode=true','update public.icash_signing_envelopes set test_mode=false'],
  ["update public.icash_signing_envelopes set state='needs_review'","update public.icash_signing_envelopes set state='awaiting_counterparty'"],
  ['update public.icash_signing_envelopes set provider_id=null',"update public.icash_signing_envelopes set provider_id='verified-provider'"],
 ]){await db.exec(block);assert.equal(await finish(queued.id,{sent:true,status:'accepted'}),false);await db.exec(restore);}
 await db.query('update public.icash_signing_envelopes set terms=$1',[{...confirmed,priceCents:9100000}]);assert.equal(await finish(queued.id,{sent:true,status:'accepted'}),false);
 await db.query('update public.icash_signing_envelopes set terms=$1,recipients=$2',[confirmed,[{...recipients[0],phone:'+12125550999'},recipients[1]]]);assert.equal(await finish(queued.id,{sent:true,status:'accepted'}),false);await db.query('update public.icash_signing_envelopes set recipients=$1',[recipients]);
 assert.equal(await finish(queued.id,{sent:true,status:'accepted'},null),false);
 await db.exec("update public.icash_signing_envelopes set state='customer_signature_needed'");
 assert.equal(await finish(queued.id,{sent:true,status:'accepted'}),true,'A fast verified seller signature does not strand delivery finalization');
 assert.equal(await one('select state from icash_seller_agreement_private.confirmations'),'ready');assert.equal(await one('select state from icash_seller_agreement_private.delivery_recovery'),'sent');
 // Old already-sent recovery jobs can reconcile a stranded confirmation, but
 // replay cannot overwrite the recorded SMS status or create new provider work.
 await db.exec("update icash_seller_agreement_private.confirmations set state='needs_review',envelope_id=null;update public.icash_signing_envelopes set state='completed'");
 assert.equal(await finish(queued.id,{sent:true,status:'accepted'}),true);assert.equal(await one('select state from icash_seller_agreement_private.confirmations'),'ready');
 assert.equal(await finish(queued.id,{sent:false,status:'held'}),false);assert.deepEqual(await one('select result from icash_seller_agreement_private.delivery_recovery'),{sent:true,status:'accepted'});
 for(const fn of ['icash_record_seller_tool_gap(text,text,text)','icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb)','icash_claim_agreement_delivery_recovery()','icash_finish_seller_agreement(uuid,uuid,uuid)','icash_finish_agreement_delivery_recovery(uuid,uuid,jsonb)']){
  for(const role of ['anon','authenticated'])assert.equal(await one('select has_function_privilege($1,$2,$3)',[role,'public.'+fn,'execute']),false);
  assert.equal(await one('select has_function_privilege($1,$2,$3)',['service_role','public.'+fn,'execute']),true);
 }
 console.log('PASS PostgreSQL contract recovery: exact autoqueue, idempotency, fee-only refreshes, permission/archive/withdrawal gates, no ambiguous replay, fast-sign reconciliation and truthful receipt state.');
}finally{await db.close();}
