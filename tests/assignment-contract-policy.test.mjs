import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {signatureRequestMessage} from '../lib/signing-invitation.ts';
import {originalContractProfile,originalContractFieldsForRole} from '../lib/original-contracts.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {buyerDepositCents} from '../lib/buyer-purchase-terms.ts';
import {normalizeDocuseal as normalize} from '../lib/docuseal-policy.ts';
import {signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus} from '../lib/signing-policy.ts';

// Actual service entry points; every database/provider operation is an in-memory fixture.
let terms=dealTermsSchema.parse({seller:'Fixture Seller',buyer:'Fixture Principal',assignee:'Fixture Buyer',address:'123 MAIN ST, DALLAS, TX 75215',legalDescription:'LOT 1 BLOCK 2',state:'TX',priceCents:15227050,priceSource:'seller_reported',closingDate:'2030-11-07',assignmentFeeCents:1000000,assignmentDepositCents:200000});
let profile=originalContractProfile,includeAcquisitionPrice=false,claims=0,reservations=0,providerWrites=0,payload=null,recipients=[];
const buyerPhone='+12025550100',customerEmail='principal@example.invalid';
const template=()=>({id:'original-assignment',form_profile:profile,provider:'docuseal',provider_template_id:'901',placeholder_names:['Cash Buyer','Customer'],field_map:{...Object.fromEntries(Object.keys(signingFields(terms,'assignment',false,originalContractProfile)).map(k=>[k,k])),...(includeAcquisitionPrice?{priceCents:'priceCents'}:{})},test_mode:false,rate_id:'rate',reviewed_until:'2099-01-01T00:00:00Z',max_legal_description_chars:180,automated_signing_reviewed:false,customer_signature_field:'Customer Signature',customer_consent_field:null});
const envelope=()=>({id:'envelope',account_id:'account',deal_id:'deal',kind:'assignment',template_id:'original-assignment',provider_id:'901',test_mode:false,state:'awaiting_counterparty',terms,terms_hash:signingTermsHash(terms),recipients});
const db=async(path,method='GET',body)=>{
 if(path.startsWith('icash_deal_files'))return [{terms,stage:'under_contract'}];
 if(path.startsWith('icash_customer_identities'))return [{principal:terms.buyer}];
 if(path.startsWith('icash_text_threads'))return [{id:'buyer-thread'}];
 if(path==='rpc/icash_sms_thread_review_current')return true;
 if(path.startsWith('icash_text_suppressions'))return [];
 if(path.startsWith('icash_signing_templates'))return path.includes('template_scope=eq.state')?[]:[template()];
 if(path.startsWith('icash_operation_rates'))return [{operation:'contract_signing',enabled:true,expires_at:'2099-01-01T00:00:00Z',costs_micros:{messaging:400000}}];
 if(path==='rpc/icash_begin_signing'){claims++;recipients=body.p_recipients;assert.equal(body.p_hash,signingTermsHash(terms));return envelope();}
 if(path==='rpc/icash_signing_action_allowed')return true;
 if(path.startsWith('icash_signing_envelopes'))return method==='PATCH'?[]:[envelope()];
 throw Error('Unexpected fixture database request: '+path);
};
const signing=await loadService('lib/signing-service.ts',{signatureRequestMessage,originalContractProfile,originalContractFieldsForRole,normalize,z,db,dealTermsSchema,signingReadiness,signingDocumentReadiness,signingTermsHash,signingFields,verifiedSigningStatus,dispatchReservedOperation:async(_i,send)=>{reservations++;await send();}});
const input={accountId:'account',userId:'owner',customerEmail,dealId:'deal',kind:'assignment',signers:[{name:'Fixture Buyer',phone:buyerPhone}]};
const oldFetch=globalThis.fetch,keys=['ICASH_LIVE_WORK_READY','DOCUSEAL_MODE','DOCUSEAL_API_KEY'],oldEnv=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',DOCUSEAL_MODE:'live',DOCUSEAL_API_KEY:'SYNTHETIC_NO_NETWORK'});
globalThis.fetch=async(url,options)=>{
 if(options.method==='POST'){
  assert.equal(url,'https://api.docuseal.com/submissions');providerWrites++;payload=JSON.parse(options.body);
  return Response.json(payload.submitters.map((s,i)=>({...s,id:i+1,submission_id:901})));
 }
 assert.equal(options.method,'GET');assert.equal(url,'https://api.docuseal.com/submissions/901');
 return Response.json({id:901,submitters_order:'preserved',completed_at:null,submitters:recipients.map((r,i)=>({id:i+1,submission_id:901,email:r.email,phone:r.phone,external_id:`envelope:${r.id}`,status:'awaiting',completed_at:null,slug:i===0?'fixture_buyer':'fixture_owner',metadata:{terms_hash:signingTermsHash(terms)}}))});
};
try{
 for(const [fee,deposit] of [[1000000,200000],[3000000,500000]]){
  terms={...terms,assignmentFeeCents:fee,assignmentDepositCents:buyerDepositCents(fee)};
  assert.equal(terms.assignmentDepositCents,deposit);
  await signing.sendForSignatures(input);
  assert.equal(payload.template_id,901);assert.equal(payload.order,'preserved');
  const [buyer,owner]=payload.submitters;
  assert.equal(buyer.role,'Cash Buyer');assert.equal(buyer.phone,buyerPhone);assert.equal(buyer.require_phone_2fa,true);
  assert.equal(owner.role,'Customer');assert.equal(owner.email,customerEmail);assert.equal(owner.require_email_2fa,true);
  assert.equal(buyer.fields.find(f=>f.name==='assignmentFeeCents').default_value,(fee/100).toFixed(2));
  assert.equal(buyer.fields.find(f=>f.name==='assignmentDepositCents').default_value,(deposit/100).toFixed(2));
  assert(buyer.fields.every(f=>f.readonly));assert.equal(owner.fields.length,0);
  assert(!buyer.fields.some(f=>f.name==='priceCents'||f.default_value==='152270.50'),'acquisition price is never sent as a buyer contract field');
  assert(!JSON.stringify(payload).includes('20%'),'deposit formula is not inserted into the contract');
  assert.deepEqual(await signing.pendingCounterpartySigningLink('account','envelope',buyerPhone),{signerId:'1',url:'https://docuseal.com/s/fixture_buyer'});
 }
 assert.equal(providerWrites,2);assert.equal(claims,2);assert.equal(reservations,2);
 await assert.rejects(()=>signing.pendingCounterpartySigningLink('account','envelope','+12025550101'),/not the next signer/);
 for(const [nextProfile,acquisition,error] of [[originalContractProfile,true,/private acquisition pricing/],['legacy',false,/approved only on the original/],['unreviewed',false,/approved only on the original/]]){
  profile=nextProfile;includeAcquisitionPrice=acquisition;
  const before=[claims,reservations,providerWrites];
  await assert.rejects(()=>signing.sendForSignatures(input),error);
  assert.deepEqual([claims,reservations,providerWrites],before,'unapproved disclosure must fail before an envelope, usage or provider write');
  await assert.rejects(()=>signing.pendingCounterpartySigningLink('account','envelope',buyerPhone),error);
 }
}finally{
 globalThis.fetch=oldFetch;
 for(const key of keys){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}
}
console.log('PASS approved original assignment: fee and capped EMD on the contract, no acquisition price, correct phone-bound link, and unapproved disclosures blocked before send. Local fixtures only.');
