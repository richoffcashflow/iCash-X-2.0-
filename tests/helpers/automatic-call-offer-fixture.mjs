import assert from 'node:assert/strict';
import {automaticCallOffer} from '../../lib/automatic-call-offer.ts';
import {sha} from '../../lib/required-call-recording.ts';
export async function testAutomaticCallOffer(f){
 const {db,q,val,rpc,read,scenario,account,call}=f;
 await db.exec('alter table public.icash_live_conversations add operation_key text;alter table public.icash_voice_jobs add operation_key text,add permission_id uuid;');
 await db.exec(read('supabase/migrations/20261008071731_automatic_call_offer_authority.sql'));
 await db.exec(read('supabase/migrations/20261008073432_automatic_offer_voice_guardrail.sql'));
 await db.exec(read('supabase/migrations/20261008074050_automatic_offer_conversation_policy.sql'));
 await db.exec(read('supabase/migrations/20261008153612_conditional_voice_offer_contract_hold.sql'));
 await db.exec(read('supabase/migrations/20261008174508_voice_offer_streaming_policy.sql'));
 await db.exec('create table public.icash_customer_identities(account_id uuid primary key,company_name text);');
 await db.exec(read('supabase/migrations/20261008194454_seller_payoff_conversation.sql'));
 await db.exec(`create table public.icash_call_recordings(account_id uuid,operation_key text,screening_id uuid,contact_key text,party text,conversation_id text,stop_token_hash text,call_ended_at timestamptz,end_requested_at timestamptz,to_phone text);
 create table public.icash_text_senders(phone text,enabled boolean);create table public.icash_webinar_text_senders(phone text,preferred boolean);create table public.icash_webinar_phone_suppressions(phone text);
 create function public.icash_text_role_conflict(text,text) returns boolean language sql as $$ select false $$;`);
 await db.exec(read('supabase/migrations/20261008202910_live_offer_context_continuity.sql'));
 await db.exec(read('supabase/migrations/20261008203215_voice_offer_progress_policy.sql'));
 await scenario('outbound offer API reaches real SQL when no text thread exists; paused and foreign calls stay blocked',async()=>{
  const {r,terms}=await call('seller',true,'v8'),id='22222222-2222-4222-8222-222222222222',token='c'.repeat(64),hash=sha(token),contact=sha(r.from_phone);
  await q('insert into public.icash_screening_jobs(id,account_id,snapshot,state) select $1,account_id,snapshot,state from public.icash_screening_jobs limit 1',[id]);
  await q('insert into public.icash_deal_files(id,account_id,screening_id,stage,terms) select $1,account_id,$1,stage,terms from public.icash_deal_files limit 1',[id]);
  const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:terms.address,estimated_value:127000,estimated_repair_cost:43960,is_free_and_clear:'Yes',total_estimated_loan_balance:0,estimated_equity_percentage:100}}};
  await q("update public.icash_screening_jobs set snapshot=$1,state='complete'",[snapshot]);
  await q("insert into public.icash_live_conversations(id,account_id,screening_id,contact_key,tool_token_hash,conversation_id,tool_expires_at,state,party,operation_key) values($1,$2,$1,$3,$4,'conv_outbound',now()+interval '10 minutes','waiting','seller','voice:fixture')",[id,account,contact,hash]);
  await q("insert into public.icash_call_recordings(account_id,operation_key,screening_id,contact_key,party,conversation_id,stop_token_hash,to_phone) values($1,'voice:fixture',$2,$3,'seller','conv_outbound',$4,$5)",[account,id,contact,hash,r.from_phone]);
  const deps={bind:async()=>{},db:async(path,method,body)=>rpc(path.slice(4),body),verifyInput:async()=>false};
  const offer=await automaticCallOffer(token,{action:'get_offer',conversationId:'conv_outbound'},deps);
  assert.equal(offer.quoteAllowed,true);assert.equal(offer.priceCents,4812800);
  assert.equal(await val('select count(*) from icash_call_offer_private.events'),1);
  assert.equal((await automaticCallOffer('d'.repeat(64),{action:'get_offer',conversationId:'conv_outbound'},deps)).quoteAllowed,false);
  await q("insert into public.icash_text_threads(id,account_id,deal_id,recipient,party,paused) values($1,$2,$1,$3,'seller',true)",[id,account,r.from_phone]);
  assert.equal((await automaticCallOffer(token,{action:'get_offer',conversationId:'conv_outbound'},deps)).quoteAllowed,false);
  await q('delete from public.icash_text_threads where id=$1',[id]);await q('update public.icash_call_recordings set call_ended_at=now()');
  assert.equal((await automaticCallOffer(token,{action:'get_offer',conversationId:'conv_outbound'},deps)).quoteAllowed,false);
 });
 await scenario('sender reuse supports a third property without crossing accounts or ignoring opt-outs',async()=>{
  await call('seller',true,'v8');
  const id='22222222-2222-4222-8222-222222222222',phone='+12125550199';
  await q("insert into public.icash_text_senders values('+14243948384',true)");
  const sender=()=>rpc('icash_property_text_sender',{p_account:account,p_deal:id,p_recipient:phone});
  assert.equal(await sender(),'+14243948384');
  await q('insert into public.icash_text_suppressions(phone) values($1)',[phone]);assert.equal(await sender(),null);
  await q('delete from public.icash_text_suppressions');await q("update public.icash_text_threads set account_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");assert.equal(await sender(),null);
 });
 await scenario('v6 binds seller context and exact price authority',async()=>{const {scope,r}=await call('seller',true,'v6');assert.equal((await scope()).dealId,'11111111-1111-4111-8111-111111111111');assert.equal((await rpc('icash_call_offer_context',{p_hash:r.stop_token_hash,p_conversation:'conv_agreement'})).party,'seller');});
 await scenario('v5 remains bound during the payoff rollout',async()=>{const {scope}=await call('seller',true,true);assert.equal((await scope()).dealId,'11111111-1111-4111-8111-111111111111');});
 for(const company of [undefined,'Clear Path Homes','  '])await scenario('v7 exposes only the saved company after authenticated property binding: '+(company?.trim()||'none'),async()=>{
  const {r,context,scope}=await call('seller',true,'v7',company);assert.equal(context.companyName,company?.trim()||null);
  assert.equal((await scope()).dealId,'11111111-1111-4111-8111-111111111111');
  assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:'f'.repeat(64)}),null);
 });
 await scenario('automatic v7 binds the current seller and stores the exact quote, reported payoff and acceptance across calls',async()=>{
  const {r,terms}=await call('seller',true,'v7'),now=Date.now();
  const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:terms.address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
  await q('update public.icash_screening_jobs set snapshot=$1',[snapshot]);
  const args={p_hash:r.stop_token_hash,p_conversation:'conv_agreement'};
  assert.equal((await rpc('icash_call_offer_context',args)).party,'seller');
  assert.equal(await rpc('icash_call_offer_context',{...args,p_hash:'f'.repeat(64)}),null);
  let state={quotedPriceCents:10200000,quoteRevision:'c'.repeat(64),acceptedPriceCents:null,payoffReport:{mortgageCents:5000000,otherDebtCents:0},factsPending:false,payoffPending:false,contractBlocked:false,acceptanceConditional:false};
  const save=(version,patch={},action='get_offer')=>rpc('icash_save_call_offer',{...args,p_expected_version:version,p_expected_snapshot:snapshot,p_state:{...state,...patch},p_action:action});
  assert.equal(await save(0),true);assert.equal(await save(0),false,'concurrent stale write rejected');
  assert.equal(await save(1,{acceptedPriceCents:3500000},'accept_offer'),false);
  assert.equal(await save(1,{acceptedPriceCents:10200000},'accept_offer'),true);
  assert.equal((await rpc('icash_call_offer_context',args)).offerState.acceptedPriceCents,10200000);
  const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:10200000,closingDate:new Date(now+14*86400000).toISOString().slice(0,10),soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'no',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
  const prepared={...terms,seller:'Jane Seller',priceCents:10200000,priceSource:'seller_reported',closingDate:confirmation.closingDate};
  const claim={...args,p_confirmation:confirmation,p_expected_terms:terms,p_terms:prepared};
  assert.equal(await rpc('icash_claim_seller_agreement',{...claim,p_confirmation:{...confirmation,agreedPriceCents:3500000},p_terms:{...prepared,priceCents:3500000}}),null,'contract cannot silently change the accepted amount');
  await q('update public.icash_screening_jobs set snapshot=snapshot||\'{"changed":true}\'');
  assert.equal(await rpc('icash_claim_seller_agreement',claim),null,'updated research invalidates the prior quote before contract claim');
  assert.equal(await save(2),false,'stale screening cannot overwrite quote');
  await q('update public.icash_screening_jobs set snapshot=$1',[snapshot]);
  for(const flag of ['contractBlocked','acceptanceConditional','payoffPending']){
   await q('update icash_call_offer_private.offers set state=state||$1::jsonb',[{[flag]:true}]);
   assert.equal(await rpc('icash_claim_seller_agreement',claim),null,flag+' prevents contract creation even with a matching accepted price');
   await q('update icash_call_offer_private.offers set state=state-$1',[flag]);
  }
  assert.equal((await rpc('icash_claim_seller_agreement',claim)).claimed,true);
  assert.equal(await val('select terms->>\'priceCents\' from public.icash_deal_files'),'10200000');
  await q('update public.icash_text_threads set paused=true');assert.equal(await rpc('icash_call_offer_context',args),null);
 });
 for(const role of ['anon','authenticated','service_role'])assert.equal(await val("select has_table_privilege($1,'icash_call_offer_private.offers','SELECT,INSERT,UPDATE,DELETE')",[role]),false);
 for(const role of ['anon','authenticated'])for(const name of ['icash_call_offer_context(text,text)','icash_save_call_offer(text,text,bigint,jsonb,jsonb,text)'])assert.equal(await val("select has_function_privilege($1,$2,'execute')",[role,'public.'+name]),false);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await val("select has_function_privilege($1,'public.icash_reception_context_before_payoff(uuid,text)','execute')",[role]),false);
 console.log('PASS automatic offer SQL: current call only, atomic price lock, stale-data hold, contract price equality and private ledger.');
}
