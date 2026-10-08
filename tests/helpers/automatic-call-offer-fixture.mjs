import assert from 'node:assert/strict';
export async function testAutomaticCallOffer(f){
 const {db,q,val,rpc,read,scenario,account,call}=f;
 await db.exec('alter table public.icash_live_conversations add operation_key text;alter table public.icash_voice_jobs add operation_key text,add permission_id uuid;');
 await db.exec(read('supabase/migrations/20261008071731_automatic_call_offer_authority.sql'));
 await db.exec(read('supabase/migrations/20261008073432_automatic_offer_voice_guardrail.sql'));
 await db.exec(read('supabase/migrations/20261008074050_automatic_offer_conversation_policy.sql'));
 await db.exec(read('supabase/migrations/20261008153612_conditional_voice_offer_contract_hold.sql'));
 await db.exec(read('supabase/migrations/20261008174508_voice_offer_streaming_policy.sql'));
 await scenario('v6 binds seller context and exact price authority',async()=>{const {scope,r}=await call('seller',true,'v6');assert.equal((await scope()).dealId,'11111111-1111-4111-8111-111111111111');assert.equal((await rpc('icash_call_offer_context',{p_hash:r.stop_token_hash,p_conversation:'conv_agreement'})).party,'seller');});
 await scenario('automatic v5 binds the current seller and stores the exact quote and acceptance across calls',async()=>{
  const {r,terms}=await call('seller',true,true),now=Date.now();
  const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:terms.address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
  await q('update public.icash_screening_jobs set snapshot=$1',[snapshot]);
  const args={p_hash:r.stop_token_hash,p_conversation:'conv_agreement'};
  assert.equal((await rpc('icash_call_offer_context',args)).party,'seller');
  assert.equal(await rpc('icash_call_offer_context',{...args,p_hash:'f'.repeat(64)}),null);
  let state={quotedPriceCents:10200000,quoteRevision:'c'.repeat(64),acceptedPriceCents:null};
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
 console.log('PASS automatic offer SQL: current call only, atomic price lock, stale-data hold, contract price equality and private ledger.');
}
