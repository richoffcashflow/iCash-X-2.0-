// Real PostgreSQL functions in memory. No network, providers, calls or messages.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
import {cashOfferCalculation} from '../lib/cash-offer-math.ts';
import {buyerDepositCents} from '../lib/buyer-purchase-terms.ts';
import {buyerPricingReviewMessage} from '../lib/buyer-assignment-pricing.ts';
import {renderBuyerPackage} from '../lib/buyer-disposition.ts';
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('NETWORK BLOCKED: pricing fixture only');};
const f=await createOperationalContactFixture(process.argv[2]);
const {pg,q,one,rpc,account,other,user}=f;
const snapshot=(arv,repairs)=>({propertyId:'prop_1001',propertyType:'house',fetchedAt:new Date().toISOString(),raw:{data:{city:'Dallas',zip:'75215',estimated_value:arv,estimated_repair_cost:repairs}}});
try{
 await q('alter table icash_text_threads add column if not exists retired_at timestamptz');
 await pg.exec(readFileSync('supabase/migrations/20261005215816_contract_text_delivery.sql','utf8'));
 await pg.exec(readFileSync('config/buyer-disposition-workflow.sql','utf8'));
 await pg.exec(readFileSync('config/rounded-buyer-prices.sql','utf8'));
 // Real deposit wrapper and insert guard, without unrelated receipt/viewing tables.
 await pg.exec(readFileSync('config/buyer-purchase-terms-and-reservations.sql','utf8').split('create table public.icash_buyer_deposit_receipts(')[0]+'commit;');
 const template=(await one("insert into icash_signing_templates(state_code,kind,signer_count,provider_template_id,placeholder_names,field_map,reviewed_until,review_reference,test_mode,enabled,provider,template_scope) values('TX','purchase',1,'777','[\"Seller\",\"Customer\"]','{}',now()+interval '1 day','SIMULATION only',false,true,'docuseal','standard') returning id")).id;
 let providerSequence=777;
 async function make(price,arv,repairs,fee=null){
  const provider=String(++providerSequence);
  const terms={seller:'Private fixture seller',buyer:'SIMULATION business',address:'123 Main Street',state:'TX',priceCents:price,assignmentFeeCents:fee,assignmentDepositCents:fee===null?null:buyerDepositCents(fee),priceSource:'seller_reported'};
  const screen=(await one("insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at) values($1,$2,$3,'complete','{\"financialCheck\":{\"status\":\"eligible\"}}',now()) returning id",[account,randomUUID(),snapshot(arv,repairs)])).id;
  const deal=(await one("insert into icash_deal_files(account_id,screening_id,stage,terms) values($1,$2,'draft',$3) returning id",[account,screen,terms])).id;
  const envelope=(await one("insert into icash_signing_envelopes(account_id,deal_id,kind,template_id,terms,terms_hash,recipients,test_mode,consent_version,requested_by,provider_id,state) values($1,$2,'purchase',$3,$4,$5,'[]',false,'SIMULATION',$6,$7,'awaiting_counterparty') returning id",[account,deal,template,terms,'a'.repeat(64),user,provider])).id;
  await rpc('icash_save_signing_status',{p_id:envelope,p_state:'completed',p_evidence:{id:provider,test_mode:false,status:'completed'}});
  return {deal,screen,envelope,terms};
 }
 const prep=deal=>rpc('icash_prepare_buyer_disposition',{p_account:account,p_deal:deal});
 const pricing=(price,arv,repairs,fee=null)=>rpc('icash_buyer_assignment_pricing',{p_price:price,p_snapshot:snapshot(arv,repairs),p_fee:fee});
 const saved=deal=>one('select terms from icash_deal_files where id=$1',[deal]);
 const legacy=await make(3893700,90000,20090);
 const legacyBefore=(await saved(legacy.deal)).terms;
 const legacyLink=await rpc('icash_ensure_buyer_package',{p_account:account,p_deal:legacy.deal});
 assert.equal(legacyLink.askingPriceCents,4900000);
 const migration=readFileSync('supabase/migrations/20261010220302_tiered_assignment_pricing.sql','utf8');
 assert.equal(migration,readFileSync('config/tiered-assignment-pricing.sql','utf8'));
 await pg.exec(migration);
 assert.equal(await prep(legacy.deal),true);
 assert.deepEqual((await saved(legacy.deal)).terms,legacyBefore,'existing fractional purchase/fee/deposit are unchanged');
 assert.deepEqual(await rpc('icash_ensure_buyer_package',{p_account:account,p_deal:legacy.deal}),legacyLink);
 assert.equal(await rpc('icash_unreleased_buyer_pricing',{p_account:account,p_deal:legacy.deal}),null);
 // Historical exact-price policy also remains intact.
 await f.isolated(async()=>{
  await q("update icash_disposition_authorities set pricing_policy='signed_purchase_plus_10000_v1',asking_price_cents=4893700 where deal_id=$1",[legacy.deal]);
  await q("update icash_deal_files set terms=terms||'{\"assignmentFeeCents\":1000000,\"assignmentDepositCents\":200000}' where id=$1",[legacy.deal]);
  assert.equal(await prep(legacy.deal),true);
  assert.equal((await one('select asking_price_cents from icash_disposition_authorities where deal_id=$1',[legacy.deal])).asking_price_cents,4893700);
 });
 for(const [price,arv,repairs,expectedFee,explicitFee] of [
  [11500000,203000,23905,1000000,null],
  [19000000,350000,50000,2000000,null],
  [19300000,350000,50000,1700000,null],
  [20000000,350000,50000,1000000,null],
  [30000000,600000,50000,3000000,3000000],
 ]){
  const plan=await pricing(price,arv,repairs,explicitFee);
  assert.equal(plan.ready,true);assert.equal(plan.assignmentFeeCents,expectedFee);
  assert.equal(plan.assignmentDepositCents,buyerDepositCents(expectedFee));
  assert.equal(plan.buyerCeilingCents,cashOfferCalculation(arv*100,repairs*100).buyerCeilingCents);
  assert(plan.askingPriceCents<=plan.buyerCeilingCents);assert.equal(plan.askingPriceCents%100000,0);
  const item=await make(price,arv,repairs,explicitFee);
  assert.equal(await prep(item.deal),true);
  const terms=(await saved(item.deal)).terms;
  assert.equal(terms.priceCents,price);assert.equal(terms.assignmentFeeCents,expectedFee);assert.equal(terms.assignmentDepositCents,plan.assignmentDepositCents);
  const pack=await rpc('icash_buyer_package_data',{p_account:account,p_deal:item.deal});
  assert.equal(pack.askingPriceCents,price+expectedFee);
  assert(!renderBuyerPackage(pack).includes('Private fixture seller'));
  assert.equal((await one('select terms from icash_signing_envelopes where id=$1',[item.envelope])).terms.assignmentFeeCents,explicitFee,'executed purchase is never rewritten');
  await q('update icash_screening_jobs set snapshot=$2 where id=$1',[item.screen,snapshot(10000,9000)]);
  assert.equal(await prep(item.deal),true,'published quote is stable after a later research change');
  assert.deepEqual((await saved(item.deal)).terms,terms);
  assert.equal(await rpc('icash_prepare_buyer_disposition',{p_account:other,p_deal:item.deal}),false);
 }
 for(const [price,arv,repairs,fee,reason] of [
  [20100000,350000,50000,null,'insufficient_margin'],
  [19300000,350000,50000,2000000,'fee_exceeds_buyer_budget'],
  [11536650,203000,23905,null,'rounded_purchase_required'],
  [11500000,203000,null,null,'research_required'],
  [11500000,203000,23905,1000001,'rounded_fee_required'],
 ]){
  const plan=await pricing(price,arv,repairs,fee);assert.equal(plan.ready,false);assert.equal(plan.reason,reason);
  const item=await make(price,arv,repairs,fee);
  assert.equal(await prep(item.deal),false);
  assert.equal(await rpc('icash_ensure_buyer_package',{p_account:account,p_deal:item.deal}),null);
  assert.equal((await one('select count(*) n from icash_disposition_authorities where deal_id=$1',[item.deal])).n,0);
  assert.deepEqual((await saved(item.deal)).terms,item.terms,'blocked pricing makes no term changes');
  const review=await rpc('icash_unreleased_buyer_pricing',{p_account:account,p_deal:item.deal});
  assert.equal(review.reason,reason);assert(buyerPricingReviewMessage(review));
  assert.equal(await rpc('icash_unreleased_buyer_pricing',{p_account:other,p_deal:item.deal}),null);
 }
 assert.equal((await pricing(15000000,299999.99,40000)).targetFeeCents,1000000);
 assert.equal((await pricing(15000000,300000,40000)).targetFeeCents,2000000);
 assert.equal((await pricing(30000000,600000,50000,100000000001)).ready,false);
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'public.icash_buyer_assignment_pricing(bigint,jsonb,bigint)','execute') allowed",[role])).allowed,false);
 console.log('Tiered pricing passed: supported larger fee, step-down, minimum-margin hold, rounded totals/deposits, $5k deposit cap, legacy preservation, immutable purchase, owner guidance and access isolation. No provider spend.');
}catch(error){console.error(error.message,error.detail??'',error.where??'',error.stack?.split('\n').filter(line=>line.includes('tiered-assignment')).join('\n')??'');process.exitCode=1;}finally{await pg.close();globalThis.fetch=originalFetch;}
