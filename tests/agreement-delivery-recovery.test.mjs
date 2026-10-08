import assert from 'node:assert/strict';
import {recoverAgreementDelivery} from '../lib/agreement-delivery-recovery.ts';
const job={id:'job',accountId:'account',userId:'owner',customerEmail:'owner@example.test',dealId:'deal',phone:'+12125550199',sellerName:'Jane Seller',expectedTerms:{seller:'Jane Seller',buyer:'Fixture Buyer',address:'45 Fixture Lane',state:'TX',priceCents:4812800,priceSource:'seller_reported',closingDate:'2026-11-11'}};
const env={VERCEL_ENV:'production',DOCUSEAL_MODE:'live',ICASH_LIVE_WORK_READY:'true'};
let pending=true,existing=[],sends=0,texts=0,result;
const d={db:async(path,method,b)=>{
 if(path==='rpc/icash_claim_agreement_delivery_recovery'){if(!pending)return null;pending=false;return job;}
 if(path.startsWith('icash_signing_envelopes?'))return existing;
 if(path==='rpc/icash_finish_agreement_delivery_recovery'){result=b;return true;}
 throw Error(path);
},send:async i=>{sends++;assert.equal(i.phoneLinkOnly,true);assert.equal(i.autoSignature,undefined);assert.deepEqual(i.signers,[{name:job.sellerName,phone:job.phone}]);return {id:'envelope',testMode:false};},text:async(a,e,p)=>{texts++;assert.deepEqual([a,e,p],['account','envelope',job.phone]);return {sent:true,status:'accepted'};}};
assert.equal((await recoverAgreementDelivery(d,{...env,VERCEL_ENV:'preview'})).status,'disabled');assert.equal(pending,true);
assert.equal((await recoverAgreementDelivery(d,env)).status,'agreement_text_accepted');assert.equal(result.p_result.sent,true);
assert.equal((await recoverAgreementDelivery(d,env)).status,'idle');assert.equal(sends,1);assert.equal(texts,1);
pending=true;existing=[{id:'envelope',state:'needs_review'}];assert.equal((await recoverAgreementDelivery(d,env)).status,'agreement_recovery_needs_review');assert.equal(sends,1,'uncertain provider creation cannot be replayed');
pending=true;existing=[{id:'envelope',state:'awaiting_counterparty',provider_id:'1',terms:job.expectedTerms,recipients:[{name:job.sellerName,phone:job.phone},{name:'Fixture Buyer'}]}];
assert.equal((await recoverAgreementDelivery(d,env)).status,'agreement_text_accepted');assert.equal(sends,1,'matching envelope is reused');
pending=true;existing[0].recipients[0].phone='+12125550999';assert.equal((await recoverAgreementDelivery(d,env)).status,'agreement_recovery_needs_review');assert.equal(texts,2,'wrong recipient cannot receive the agreement');
console.log('PASS explicit-owner agreement recovery, exact recipient and terms, no auto-signature, one provider request and safe uncertain-send handling.');
