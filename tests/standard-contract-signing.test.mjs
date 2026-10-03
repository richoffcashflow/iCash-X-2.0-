import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {signingReadiness,signingFields,signingTermsHash} from '../lib/signing-policy.ts';
import {contractCapability,reviewedContractCoverage} from '../lib/contract-coverage.ts';
import {evaluateLaunch} from '../lib/launch-readiness-policy.ts';
Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',DOCUSEAL_MODE:'live',DOCUSEAL_API_KEY:'SYNTHETIC_NO_NETWORK'});
let terms=dealTermsSchema.parse({seller:'Fixture Seller',buyer:'Fixture Principal',address:'Fixture address',legalDescription:'Fixture legal description',state:'TN',priceCents:100000,priceSource:'seller_reported',earnestCents:0});
let kind='purchase',queries=[],writes=[],provider=[],reservations=[],exact=false,standard=true,duplicate=false,exactExpired=false,exactRate=true,standardRate=true,budgetBlocked=false;
const expires='2099-01-01T00:00:00Z';
const makeTemplate=scope=>({id:scope,provider_template_id:scope==='standard'?(kind==='purchase'?'6101264':'6101265'):(kind==='purchase'?'6101299':'6101300'),template_scope:scope,state_code:'TX',reviewed_until:scope==='state'&&exactExpired?'2020-01-01':expires,rate_id:scope+'-rate',max_legal_description_chars:2000,placeholder_names:['Counterparty','Customer'],field_map:Object.fromEntries(Object.keys(signingFields(terms,kind)).map(k=>[k,'mapped_'+k]))});
const signing=await loadService('lib/signing-service.ts',{z,dealTermsSchema,signingReadiness,signingFields,signingTermsHash,
 db:async(path,method='GET',body)=>{
  if(method!=='GET'){writes.push({path,method,body});if(path==='rpc/icash_begin_signing')return {id:'envelope',terms,terms_hash:signingTermsHash(terms)};return [];}
  queries.push(path);
  if(path.startsWith('icash_deal_files')){assert(path.includes('account_id=eq.account'));return [{terms,stage:kind==='purchase'?'draft':'under_contract'}];}
  if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture Principal'}];
  if(path.startsWith('icash_operation_rates'))return [{operation:'contract_signing',enabled:path.includes('id=eq.state-rate')?exactRate:standardRate,expires_at:expires}];
  if(path.startsWith('icash_signing_templates')){
   assert(path.includes(`kind=eq.${kind}`)&&path.includes('test_mode=eq.false')&&path.includes('provider=eq.docuseal')&&path.includes('enabled=eq.true')&&path.includes('reviewed_until=gt.')&&path.includes('limit=2'));
   if(!path.includes('signer_count=eq.1'))return [];
   if(path.includes('template_scope=eq.state')){assert(path.includes('state_code=eq.'+terms.state));return exact?[makeTemplate('state')]:[];}
   assert(path.includes('template_scope=eq.standard'));assert(!path.includes('state_code='));return standard?(duplicate?[makeTemplate('standard'),makeTemplate('standard')]:[makeTemplate('standard')]):[];
  }
  throw Error(path);
 },dispatchReservedOperation:async(i,send)=>{reservations.push(i);if(budgetBlocked)throw Error('Insufficient signing budget');await send();}
});
const oldFetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.docuseal.com/submissions');const body=JSON.parse(init.body);provider.push(body);return {ok:true,json:async()=>body.submitters.map((s,n)=>({...s,id:n+1,submission_id:12}))};};
const input=()=>({accountId:'account',userId:'owner',customerEmail:'principal@example.invalid',dealId:'deal',kind,signers:[{name:'Fixture Signer',email:'signer@example.invalid'}]});
try{
 for(const state of ['TN','AL','CA'])for(kind of ['purchase','assignment']){
  terms={...terms,state,assignee:'Fixture Assignee',assignmentFeeCents:10000,assignmentDepositCents:0,escrowAgent:'Fixture Escrow'};
  await signing.sendForSignatures(input());const sent=provider.at(-1);assert.equal(sent.template_id,kind==='purchase'?6101264:6101265);assert.equal(sent.submitters.length,2);assert.equal(sent.submitters[0].fields.find(f=>f.name==='mapped_state').default_value,state);assert.equal(sent.submitters[1].name,'Fixture Principal');assert.equal(sent.order,'preserved');assert(sent.submitters.every(s=>s.require_email_2fa));
 }
 exact=true;terms={...terms,state:'TX'};
 for(kind of ['purchase','assignment']){queries=[];await signing.sendForSignatures(input());assert.equal(provider.at(-1).template_id,kind==='purchase'?6101299:6101300);assert(!queries.some(q=>q.includes('template_scope=eq.standard')));}
 // An expired or cost-ineligible exact form does not mask the usable generic form.
 exactExpired=true;await signing.sendForSignatures(input());assert.equal(provider.at(-1).template_id,6101265);exactExpired=false;
 exactRate=false;await signing.sendForSignatures(input());assert.equal(provider.at(-1).template_id,6101265);exactRate=true;exact=false;
 for(const setup of [()=>{standard=false;},()=>{standard=true;duplicate=true;},()=>{duplicate=false;standardRate=false;}]){setup();const count=writes.length;await assert.rejects(()=>signing.sendForSignatures(input()),/active contract template|Duplicate contract template/);assert.equal(writes.length,count);}standardRate=true;standard=true;
 for(const signers of [[],[input().signers[0],input().signers[0]],[...input().signers,{name:'Second Owner',email:'second@example.invalid'}]]){const count=writes.length;await assert.rejects(()=>signing.sendForSignatures({...input(),signers}),/active contract template|each required signer/);assert.equal(writes.length,count);}
 const beforeProvider=provider.length;budgetBlocked=true;await assert.rejects(()=>signing.sendForSignatures(input()),/Insufficient signing budget/);assert.equal(provider.length,beforeProvider);assert.equal(writes.at(-1).body.state,'needs_review');budgetBlocked=false;
 assert.equal(provider.length,10);assert.equal(reservations.length,11);
}finally{globalThis.fetch=oldFetch;}
const capability={template_scope:'standard',state_code:'TX',signer_count:1,enabled:true,test_mode:false,provider:'docuseal',reviewed_until:expires,rate:{operation:'contract_signing',enabled:true,expires_at:expires}};
let coverage=reviewedContractCoverage(['purchase','assignment'].map(kind=>({...capability,kind}))),ready=true;
const launch=await loadService('lib/launch-readiness.ts',{contractCapability,readContractCoverage:async()=>coverage,evaluateLaunch,earlyAccessFundingEnabled:()=>false,fundingEnabled:()=>true,fundingMode:()=> 'live',db:async path=>path.startsWith('rpc/')?{cashReserve:true,discovery:true,voice:true,contactPermission:false,productionContracts:ready,unresolvedDispatches:false}:path.startsWith('icash_market_shortlist')?[{zip:'38118',state:'TN'}]:[{zip:'38118'}]});
Object.assign(process.env,{DEALMACHINE_API_KEY:'SYNTHETIC_NO_NETWORK',ELEVENLABS_API_KEY:'SYNTHETIC_NO_NETWORK',ICASH_AUTH_EMAIL_READY:'true',ICASH_DAILY_BILLING_READY:'true',CRON_SECRET:'SYNTHETIC_NO_NETWORK'});
assert.equal((await launch.launchReadiness()).ready,true);ready=false;assert.equal((await launch.launchReadiness()).ready,false);ready=true;coverage={scope:'configured_templates',states:[{state:'TX',signerCounts:[1]}],standardSignerCounts:[]};assert.equal((await launch.launchReadiness()).ready,false);
console.log('Standard signing + launch: actual service uses generic templates for TN/AL/CA, preserves dynamic state/parties/fields/budget/provider evidence, prefers exact forms, and never dispatches unsupported signer counts or ambiguous templates.');
