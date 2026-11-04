import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {z} from 'zod';
import {planBuyerOutreach} from '../lib/buyer-engine.ts';
import {dealTermsSchema,renderDealDocument} from '../lib/deal-documents.ts';
process.env.ICASH_LIVE_WORK_READY='true';
const terms=dealTermsSchema.parse({priceCents:10000000,assignmentFeeCents:1000000,address:'Offline fixture'});
let actions,logs,jobState,summaryWrites,summaryFailure,serviceFailure,saveFailure,signed,summary;
function reset(){actions=[];logs=[];jobState='issued';summaryWrites=0;summaryFailure=null;serviceFailure=null;saveFailure=false;signed=true;summary=null;}
const db=async(path,method,body)=>{
 if(path.startsWith('icash_fulfillment_jobs')&&method==='PATCH'){
  actions.push('summary');summaryWrites++;
  assert.match(path,/account_id=eq.account&state=eq.complete/);
  if(summaryFailure==='both'||summaryFailure===summaryWrites)throw Error('Private summary write failure');
  assert.equal(jobState,'complete');summary=body.result;return [{id:'job'}];
 }
 if(path.startsWith('icash_fulfillment_jobs'))return [{id:'job',deal_id:'deal',purchase_envelope_id:'signed',state:jobState}];
 if(path.startsWith('icash_deal_files'))return [{terms,stage:'under_contract'}];
 if(path.startsWith('icash_signing_envelopes'))return signed?[{id:'signed'}]:[];
 if(path.startsWith('icash_disposition_authorities'))return [];
 if(['rpc/icash_prepare_buyer_disposition','rpc/icash_ensure_buyer_package'].includes(path))return true;
 if(path==='rpc/icash_save_fulfillment'){
  actions.push('save documents');if(saveFailure)throw Error('Document save unavailable');
  assert.equal(body.p_documents.length,2);assert.deepEqual(body.p_matches,[]);
  jobState='complete';summary=body.p_result;return null;
 }
 throw Error('Unexpected fixture path');
};
const step=(name,result)=>async(account,deal)=>{
 assert.equal(account,'account');assert.equal(deal,'deal');actions.push(name);
 if(['network','title opening','buyer texts','buyer emails'].includes(name))assert.equal(jobState,'complete','Authoritative document preparation must precede delivery');
 if(serviceFailure===name)throw Error('Private provider failure');
 return result;
};
const {prepareFulfillment}=await loadService('lib/fulfillment-service.ts',{db,z,planBuyerOutreach,dealTermsSchema,renderDealDocument,
 discoverBuyersForDeal:step('discovery',{status:'buyer_search_saved',canContinue:false}),
 qualifyTitleCompanies:step('qualification',{status:'no_title_inquiry_pending'}),discoverTitlePlaces:step('title search',{status:'title_search_saved'}),
 processBuyerNetwork:step('network',{status:'network_checked',accepted:1,canContinue:true}),
 coordinateTitleOpening:step('title opening',{status:'title_opening_sent'}),
 sendBuyerPackageTexts:step('buyer texts',{status:'buyer_texts_processed',accepted:1,held:0,canContinue:true}),
 sendRequestedBuyerPackages:step('buyer emails',{status:'buyer_packages_processed',accepted:1,held:0,canContinue:false}),
 console:{error:(...args)=>logs.push(args)},
});
const expected=['discovery','qualification','title search','save documents','network','title opening','summary','buyer texts','buyer emails','summary'];
for(const fail of [null,1]){
 reset();summaryFailure=fail;
 assert.deepEqual(await prepareFulfillment('account','job'),{status:'fulfillment_prepared'});
 assert.deepEqual(actions,expected,'A failed optional checkpoint cannot suppress the independent buyer channels');
 assert.deepEqual(logs,fail?[['fulfillment_summary_deferred']]:[],'Only a fixed operator diagnostic is emitted');
 assert.equal(summary.buyerNetwork.canContinue,true,'The final save preserves the existing network continuation signal');
 assert.equal(summary.titleStatus,'title_opening_sent');assert.equal(summary.buyerTexts.accepted,1);assert.equal(summary.buyerEmail.accepted,1);
 assert.equal(summary.sent,false);assert.equal(summary.depositReceived,false);assert.equal(summary.closed,false,'Delivery does not invent closing progress');
 const completedActions=[...actions];assert.deepEqual(await prepareFulfillment('account','job'),{status:'held'});assert.deepEqual(actions,completedActions,'Completed preparation does not replay deliveries without a new scheduler claim');
}
for(const fail of [2,'both']){
 reset();summaryFailure=fail;
 await assert.rejects(prepareFulfillment('account','job'),/Private summary write failure/);
 assert.deepEqual(actions,expected,'Independent sends execute once before the required final summary write');
 assert.equal(actions.filter(action=>action==='buyer texts').length,1);assert.equal(actions.filter(action=>action==='buyer emails').length,1);
 assert.equal(jobState,'complete');
 const count=actions.length;assert.deepEqual(await prepareFulfillment('account','job'),{status:'held'});assert.equal(actions.length,count,'A failed final summary never rearms a provider send');
}
for(const fail of ['network','title opening','buyer texts','buyer emails']){
 reset();serviceFailure=fail;summaryFailure=1;
 assert.deepEqual(await prepareFulfillment('account','job'),{status:'fulfillment_prepared'});
 assert.deepEqual(actions,expected,'A held individual service does not prevent the other admitted services');
 if(fail==='buyer texts')assert.equal(summary.buyerTexts.status,'buyer_text_needs_review');
 if(fail==='buyer emails')assert.equal(summary.buyerEmail.status,'buyer_email_needs_review');
}
reset();saveFailure=true;await assert.rejects(prepareFulfillment('account','job'),/Document save unavailable/);
assert(!actions.includes('network')&&!actions.includes('title opening')&&!actions.includes('buyer texts')&&!actions.includes('buyer emails'),'Required document preparation remains a hard dependency');
reset();signed=false;assert.deepEqual(await prepareFulfillment('account','job'),{status:'signed_purchase_required'});assert.deepEqual(actions,[]);
console.log('Fulfillment failure isolation: summary fault does not suppress independent buyer deliveries, final persistence remains required, durable preparation and original one-use claims remain intact. Offline only.');
