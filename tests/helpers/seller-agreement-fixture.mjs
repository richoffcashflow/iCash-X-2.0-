import assert from 'node:assert/strict';
import {sellerAgreementReceptionPolicyHash,noEmdReceptionPolicyHash,legacyAutomaticOfferReceptionPolicyHash,streamingAutomaticOfferReceptionPolicyHash,payoffAutomaticOfferReceptionPolicyHash,progressAutomaticOfferReceptionPolicyHash,automaticOfferReceptionPolicyHash,buyerCoordinationReceptionPolicyHash,isolatedBuyerReceptionPolicyHash} from '../../lib/seller-agreement-reception.ts';
export async function testSellerAgreement(f){
 const {db,q,val,rpc,read,scenario,account,reserve,trans,boundPayload,startPayload}=f;
 await db.exec(`alter table auth.users add email text default 'fixture@example.test',add email_confirmed_at timestamptz default now();
 alter table public.icash_deal_files add primary key(id),add updated_at timestamptz default now();
 alter table public.icash_text_threads add primary key(id);
 alter table public.icash_screening_jobs add result jsonb default '{}';
 alter table public.icash_signing_envelopes add id uuid primary key default gen_random_uuid(),add terms jsonb,add recipients jsonb,add test_mode boolean default false,add provider_id text;
 create table public.icash_live_conversations(id uuid,account_id uuid,screening_id uuid,contact_key text,tool_token_hash text,conversation_id text,tool_expires_at timestamptz,state text,party text);`);
 await db.exec(read('config/seller-call-agreement.sql'));
 await db.exec("create table public.icash_template_drafts(key text primary key,state text default 'claimed',result jsonb);");
 await db.exec(read('config/seller-no-emd.sql'));
 const id='11111111-1111-4111-8111-111111111111',date=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
 async function call(party='seller',noEmd=true,automatic=false,companyName){
  const admission=await reserve({context_policy:automatic==='v11'?'automatic_offer_v11':automatic==='v10'?'automatic_offer_v10':automatic==='v9'?'automatic_offer_v9':automatic==='v8'?'automatic_offer_v8':automatic==='v7'?'automatic_offer_v7':automatic==='v6'?'automatic_offer_v6':automatic?'automatic_offer_v5':noEmd?'seller_agreement_v4':'seller_agreement_v3',context_policy_hash:automatic==='v11'?isolatedBuyerReceptionPolicyHash:automatic==='v10'?buyerCoordinationReceptionPolicyHash:automatic==='v9'?automaticOfferReceptionPolicyHash:automatic==='v8'?progressAutomaticOfferReceptionPolicyHash:automatic==='v7'?payoffAutomaticOfferReceptionPolicyHash:automatic==='v6'?streamingAutomaticOfferReceptionPolicyHash:automatic?legacyAutomaticOfferReceptionPolicyHash:noEmd?noEmdReceptionPolicyHash:sellerAgreementReceptionPolicyHash,context_approval_reference:'Synthetic seller agreement approval',agreement_tool_id:'tool_agreement'});assert(admission.allowed,JSON.stringify(admission));
  let r=admission.session;await trans('claim_setup');await trans('bounded',boundPayload(r));await trans('bind_call_start',startPayload(r));r=await trans('authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'});await trans('claim_start');await trans('started',{recordingSid:'RE'+'c'.repeat(32),providerStartedAt:r.recording_authorized_at});
  await q('insert into public.icash_screening_jobs(id,account_id,snapshot,result) values($1,$2,$3,$4)',[id,account,{propertyId:'prop_123'},{property:{legalDescription:'Lot 1 block 2'}}]);
  const terms={address:'45 Oak Road',buyer:'Fixture buyer',state:'TX',inspectionDays:10};
  await q('insert into public.icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,$3,$4)',[id,account,party==='seller'?'draft':'under_contract',terms]);
  await q("insert into public.icash_text_threads(id,account_id,deal_id,party,recipient,sender,paused) values($1,$2,$1,$3,$4,'+14243948384',false)",[id,account,party,r.from_phone]);
  await q("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,created_at,body,provider_id) values(gen_random_uuid(),$1,$2,'outgoing','delivered',now()-interval '1 minute','About 45 Oak Road','synthetic')",[account,id]);
  if(companyName!==undefined)await q('insert into public.icash_customer_identities values($1,$2)',[account,companyName]);
  const context=await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash});
  await trans('claim_register');r=await trans('bind_conversation',{conversationId:'conv_agreement',agentId:r.agent_id,branchId:r.branch_id,versionId:r.version_id});
  return {r,context,terms,scope:()=>rpc('icash_seller_agreement_call_context',{p_hash:r.stop_token_hash,p_conversation:'conv_agreement'})};
 }
 await scenario('legacy v3 reception remains valid during no-EMD rollout',async()=>{const {scope}=await call('seller',false);assert.equal((await scope()).dealId,id);});
 const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:9000000,closingDate:date,soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'no',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
 await scenario('inbound agreement is bound before registration; exact confirmation prepares once and keeps a declined visit',async()=>{
  const {r,context,terms,scope}=await call();assert.equal(context.purchaseTerms.earnestCents,undefined);assert.equal(context.purchaseTerms.legalDescriptionAvailable,true);
  const c=await scope();assert.equal(c.dealId,id);assert.equal(c.phone,r.from_phone);
  const prepared={...terms,seller:confirmation.sellerLegalName,priceCents:confirmation.agreedPriceCents,priceSource:'seller_reported',closingDate:date};
  const args={p_hash:r.stop_token_hash,p_conversation:'conv_agreement',p_confirmation:confirmation,p_expected_terms:terms,p_terms:prepared};
  assert.equal(await rpc('icash_claim_seller_agreement',{...args,p_hash:'f'.repeat(64)}),null);
  assert.equal(await rpc('icash_claim_seller_agreement',{...args,p_confirmation:{...confirmation,soleOwner:false}}),null);
  const claim=await rpc('icash_claim_seller_agreement',args);assert(claim.claimed);assert.equal(claim.envelopeId,null);
  assert.equal((await rpc('icash_claim_seller_agreement',args)).claimed,false);
  assert.equal(await rpc('icash_claim_seller_agreement',{...args,p_confirmation:{...confirmation,agreedPriceCents:9100000}}),null);
  assert.deepEqual(await val('select terms from public.icash_deal_files where id=$1',[id]),prepared);
  assert.equal(await val("select confirmation->>'inspectionAccess' from icash_seller_agreement_private.confirmations"),'no');
  await q('update public.icash_text_threads set paused=true');assert.equal(await scope(),null);
 });
 await scenario('buyer calls cannot acquire seller agreement scope',async()=>{const {scope}=await call('buyer');assert.equal(await scope(),null);assert.equal(await val('select count(*) from icash_seller_agreement_private.inbound_bindings'),0);});
 await scenario('ended calls and contact stops cannot send an agreement',async()=>{
  const {r,scope}=await call();await q("insert into public.icash_text_suppressions(phone,reason) values($1,'synthetic stop')",[r.from_phone]);assert.equal(await scope(),null);
  await q('delete from public.icash_text_suppressions');const {timeLimitSeconds,...identity}=boundPayload(r);await trans('call_ended',{...identity,status:'completed'},r);assert.equal(await scope(),null);
 });
 await scenario('outbound seller agreement uses exact screening and caller token',async()=>{
  const {r}=await call();await q("insert into public.icash_live_conversations values($1,$2,$1,encode(sha256(convert_to($3,'UTF8')),'hex'),$4,'conv_outbound',now()+interval '10 minutes','waiting','seller')",[id,account,r.from_phone,'f'.repeat(64)]);
  const scope=()=>rpc('icash_seller_agreement_call_context',{p_hash:'f'.repeat(64),p_conversation:'conv_outbound'});assert.equal((await scope()).dealId,id);
  await q("update public.icash_live_conversations set party='buyer'");assert.equal(await scope(),null);
 });
 await (await import('./automatic-call-offer-fixture.mjs')).testAutomaticCallOffer({...f,call});
 for(const role of ['anon','authenticated'])for(const fn of ['icash_seller_agreement_call_context(text,text)','icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb)','icash_finish_seller_agreement(uuid,uuid,uuid)','icash_seller_agreement_recording(text)'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,'public.'+fn]),false);
}
