import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {planBuyerOutreach} from '../lib/buyer-engine.ts';
import {dealTermsSchema,renderDealDocument} from '../lib/deal-documents.ts';
let writes=[],signed=true,authority=true;
const now=Date.now();const terms=dealTermsSchema.parse({priceCents:10000000,assignmentFeeCents:1000000,address:'Fixture only'});
const criteria={markets:['Dallas'],propertyTypes:['house'],maxPriceCents:12000000,maxRepairCents:6000000,criteriaConfirmedAt:now-1000,permitted:true,proofOfFundsVerifiedAt:now-1000,authorityVerified:true,completedDeals:5,failedDeals:0,estimatedContactChargeCents:100};
const db=async(path,method,body)=>{
 if(path.startsWith('icash_fulfillment_jobs'))return [{id:'job',deal_id:'deal',purchase_envelope_id:'envelope',state:'issued'}];
 if(path.startsWith('icash_deal_files'))return [{terms,stage:'under_contract'}];
 if(path.startsWith('icash_signing_envelopes'))return signed?[{id:'envelope'}]:[];
 if(path.startsWith('icash_disposition_authorities'))return authority?[{purchase_envelope_id:'envelope',expires_at:new Date(now+100000).toISOString(),market:'Dallas',property_type:'house',asking_price_cents:11000000,repairs_cents:4000000,retain_credit_cents:100}]:[];
 if(path.startsWith('icash_wallets'))return [{balance_cents:1000,reserved_cents:0}];
 if(path.startsWith('icash_buyer_profiles'))return [{id:'buyer1',entity_key:'same',criteria,source_ref:'fixture:buyer-record'},{id:'buyer2',entity_key:'same',criteria,source_ref:'fixture:duplicate-record'},{id:'buyer3',entity_key:'invalid',criteria:{...criteria,authorityVerified:'false'},source_ref:'fixture:invalid'}];
 if(path==='rpc/icash_save_fulfillment'){writes.push(body);return null;}
 throw Error('Unexpected call: '+path);
};
globalThis.__fulfillment={z,db,planBuyerOutreach,dealTermsSchema,renderDealDocument};
let source=ts.transpileModule(readFileSync(new URL('../lib/fulfillment-service.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {prepareFulfillment}=await import('data:text/javascript;base64,'+Buffer.from('const {z,db,planBuyerOutreach,dealTermsSchema,renderDealDocument}=globalThis.__fulfillment;\n'+source).toString('base64'));
assert.equal((await prepareFulfillment('account','job')).status,'fulfillment_prepared');assert.equal(writes[0].p_matches.length,1);assert.equal(writes[0].p_documents.length,2);assert.equal(writes[0].p_result.sent,false);assert.equal(writes[0].p_result.closed,false);
writes=[];signed=false;assert.equal((await prepareFulfillment('account','job')).status,'signed_purchase_required');assert.equal(writes.length,0);
signed=true;authority=false;await prepareFulfillment('account','job');assert.equal(writes[0].p_matches.length,0);assert.equal(writes[0].p_result.buyerStatus,'marketing_review_required');
delete globalThis.__fulfillment;
console.log('Post-contract preparation: verified signatures, marketing authority, entity deduplication, malformed buyer rejection and truthful states passed. No outbound messages.');
