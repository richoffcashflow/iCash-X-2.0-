import assert from 'node:assert/strict';
import {sellerOfferReceptionPolicyHash,sellerOfferReceptionVariables} from '../../lib/seller-offer-reception.ts';
export async function testSellerOfferInbound(f){
 const {db,q,val,rpc,read,scenario,account,reserve,trans,boundPayload,startPayload}=f;
 await db.exec("alter table public.icash_screening_jobs add state text default 'complete';create table public.icash_signing_envelopes(account_id uuid,deal_id uuid,kind text,state text);");
 await db.exec(read('config/seller-offer-reception.sql'));
 await scenario('seller offer follows the exact recorded call and current property, with private underwriting stripped',async()=>{
  const a=await reserve({context_policy:'seller_offer_v2',context_policy_hash:sellerOfferReceptionPolicyHash,context_approval_reference:'Synthetic seller proposal approval'});assert(a.allowed,JSON.stringify(a));
  let r=a.session;await trans('claim_setup');await trans('bounded',boundPayload(r));await trans('bind_call_start',startPayload(r));r=await trans('authorize_recording',{nonceHash:r.nonce_hash,policy:'direct_recorded_v1'});await trans('claim_start');await trans('started',{recordingSid:'RE'+'c'.repeat(32),providerStartedAt:r.recording_authorized_at});
  const id='11111111-1111-4111-8111-111111111111',address='45 Oak Road';
  const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90,owner_private:'PRIVATE_FIXTURE'}}};
  await q('insert into public.icash_screening_jobs(id,account_id,snapshot) values($1,$2,$3)',[id,account,snapshot]);
  await q("insert into public.icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$1,'draft',jsonb_build_object('address',$3::text))",[id,account,address]);
  await q("insert into public.icash_text_threads(id,account_id,deal_id,party,recipient,sender,paused) values($1,$2,$1,'seller',$3,'+14243948384',false)",[id,account,r.from_phone]);
  await q("insert into public.icash_text_messages(id,account_id,thread_id,direction,state,created_at,body,provider_id) values(gen_random_uuid(),$1,$2,'outgoing','delivered',now()-interval '1 minute',$3,'synthetic')",[account,id,'Is this the owner of '+address+'?']);
  const lookup=()=>rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:r.nonce_hash});
  const data=await lookup();assert.equal(data.address,address);assert.equal(data.dealStage,'draft');
  const publicVars=sellerOfferReceptionVariables(data);assert.equal(JSON.parse(publicVars.icash_property_context).sellerOffer.priceCents,10200000);assert(!JSON.stringify(publicVars).includes('PRIVATE_FIXTURE'));assert(!JSON.stringify(publicVars).includes('screeningSnapshot'));
  assert.equal(await rpc('icash_recorded_reception_property_context',{p_id:r.id,p_nonce_hash:'f'.repeat(64)}),null);
  await q("insert into public.icash_signing_envelopes values($1,$2,'purchase','awaiting_counterparty')",[account,id]);
  assert.equal(JSON.parse(sellerOfferReceptionVariables(await lookup()).icash_property_context).sellerOffer,null);
  await q('update public.icash_screening_jobs set account_id=$1',['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);assert.equal(await lookup(),null);
 });
 for(const role of ['anon','authenticated'])for(const fn of ['icash_claim_seller_offer_branch(uuid)','icash_stage_seller_offer_reception(uuid,text,text,text)','icash_recorded_reception_property_context(uuid,text)'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,'public.'+fn]),false);
 await (await import('./reception-contact-continuity-fixture.mjs')).testReceptionContactContinuity(f);
 await (await import('./seller-agreement-fixture.mjs')).testSellerAgreement(f);
}
