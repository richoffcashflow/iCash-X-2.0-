import assert from 'node:assert/strict';
import {resendContractText,inspectContractTextResend} from '../lib/contract-text-resend.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {signingTermsHash} from '../lib/signing-policy.ts';

const terms=dealTermsSchema.parse({seller:'Fixture seller',buyer:'Fixture buyer',address:'Fixture property',legalDescription:'Fixture lot',state:'TX',priceCents:4812800,priceSource:'seller_reported',closingDate:'2030-11-11'});
const hash=signingTermsHash(terms),phone='+12025550100';
const job={id:'retry',accountId:'account',envelopeId:'envelope',signerId:'1',phone,providerId:'123',submitterId:321,termsHash:hash};
function fixture(patch={}){
 let state='ready',writes=[],audit=[];
 const recipients=[{id:'1',phone},{id:'2',email:'owner@example.invalid'}];
 const envelope={id:'envelope',account_id:'account',provider_id:'123',terms_hash:hash,test_mode:false,state:'awaiting_counterparty',kind:'purchase',terms,recipients,...patch.envelope};
 const submission={id:123,submitters_order:'preserved',completed_at:null,status:'pending',submitters:recipients.map((r,i)=>({...r,id:i===0?321:322,submission_id:123,external_id:`envelope:${r.id}`,status:'awaiting',completed_at:null,slug:'private-fixture',metadata:{terms_hash:hash}})),...patch.submission};
 if(patch.signer)Object.assign(submission.submitters[0],patch.signer);
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_claim_contract_text_resend'){
   if(state!=='ready')return null;state='dispatching';return {...job};
  }
  if(path.startsWith('icash_signing_envelopes?'))return [envelope];
  if(path.startsWith('icash_contract_text_resends?')){
   audit.push(body);
   if(patch.storageFailure&&body.state==='accepted')throw Error('fixture storage failure');
   state=body.state;return [{id:job.id}];
  }
  throw Error('Unexpected database operation '+path);
 };
 const fetcher=async(url,options)=>{
  assert.equal(options.redirect,'error');
  if(options.method==='GET'){assert.equal(url,'https://api.docuseal.com/submissions/123');return Response.json(submission);}
  writes.push({url,body:JSON.parse(options.body),method:options.method});
  if(patch.timeout)throw Error('fixture timeout after provider accepted');
  return Response.json(submission.submitters[0]);
 };
 return {deps:{db,key:'fixture-only',fetcher},writes,audit,state:()=>state};
}
const f=fixture();
const results=await Promise.all([resendContractText('a'.repeat(64),f.deps),resendContractText('a'.repeat(64),f.deps)]);
assert.deepEqual(results.map(r=>r.status).sort(),['accepted','not_authorized']);
assert.deepEqual(f.writes,[{url:'https://api.docuseal.com/submitters/321',method:'PUT',body:{send_sms:true,send_email:false}}]);
assert.equal(results.find(r=>r.status==='accepted').received,false,'provider acceptance never claims handset receipt');
for(const patch of [
 {envelope:{test_mode:true}}, {envelope:{account_id:'someone-else'}}, {envelope:{terms_hash:'b'.repeat(64)}},
 {submission:{status:'expired'}}, {submission:{archived_at:'2026-01-01'}},
 {signer:{phone:'+12025550199'}}, {signer:{id:999}}, {signer:{metadata:{terms_hash:'different'}}},
 {signer:{status:'completed',completed_at:'2026-10-08T00:00:00Z'}}
]){
 const f=fixture(patch);assert.equal((await resendContractText('a'.repeat(64),f.deps)).status,'needs_review_do_not_retry');
 assert.equal(f.writes.length,0);assert.equal(f.audit.at(-1).error_code,'PRE_SEND_CHECK_FAILED');
}
for(const patch of [{timeout:true},{storageFailure:true}]){
 const f=fixture(patch);assert.equal((await resendContractText('a'.repeat(64),f.deps)).status,'needs_review_do_not_retry');
 assert.equal((await resendContractText('a'.repeat(64),f.deps)).status,'not_authorized');
 assert.equal(f.writes.length,1);assert.equal(f.audit.at(-1).error_code,'PROVIDER_OR_STORAGE_OUTCOME_UNKNOWN');
}
console.log('PASS same-agreement SMS only, recipient/order/terms isolation, concurrent one-use claim, unknown-outcome no retry, no email/signature changes.');

const inspectorRow={id:'retry',envelope_id:'envelope',signer_id:'1',recipient:phone,expected_provider_id:'123',expected_submitter_id:321,terms_hash:hash,state:'accepted'};
let inspectorReads=0;
const inspection=await inspectContractTextResend('a'.repeat(64),{key:'fixture',db:async(path,method)=>{assert.equal(method,undefined);assert(path.includes('state=in.(dispatching,accepted,needs_review)'));return [inspectorRow];},fetcher:async(url,options)=>{
 assert.equal(options.method,'GET');assert.equal(url,'https://api.docuseal.com/submitters/321');inspectorReads++;
 return Response.json({id:321,submission_id:123,external_id:'envelope:1',phone,metadata:{terms_hash:hash},status:'sent',sent_at:'2026-10-09T01:18:27Z',opened_at:null,preferences:{send_sms:true},slug:'PRIVATE_SIGNING_CAPABILITY',submission_events:[{submitter_id:321,event_type:'send_sms',event_timestamp:'2026-10-09T01:18:27Z',data:{message:'private text https://example.invalid/private',status:'sent'}}]});
}});
assert.equal(inspectorReads,1);assert.equal(inspection.status,'inspected');assert.equal(inspection.events[0].type,'send_sms');
assert.equal(inspection.events[0].codes.status,'sent');assert(!JSON.stringify(inspection).includes('PRIVATE_SIGNING_CAPABILITY'));assert(!JSON.stringify(inspection).includes('example.invalid'));assert(!JSON.stringify(inspection).includes(phone));
assert.equal((await inspectContractTextResend('a'.repeat(64),{key:'fixture',db:async()=>[],fetcher:async()=>{throw Error('must not reach provider');}})).status,'not_authorized');
await assert.rejects(()=>inspectContractTextResend('a'.repeat(64),{key:'fixture',db:async()=>[inspectorRow],fetcher:async()=>Response.json({id:321,submission_id:123,external_id:'envelope:1',phone:'+12025550199',metadata:{terms_hash:hash}})}),/SIGNER_BINDING_MISMATCH/);
console.log('PASS read-only delivery inspection, spent authorization only, signer binding and private-link redaction.');
