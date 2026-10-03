// No external requests: exercise the actual service boundaries with explicit fixtures.
import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {discoveryWorkEnabled,liveWorkReady} from '../lib/live-work-admission.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {signingReadiness} from '../lib/signing-policy.ts';
Object.assign(process.env,{ICASH_LIVE_WORK_READY:'true',DEALMACHINE_API_KEY:'dm_sk_live_SIMULATION_NO_NETWORK',DOCUSEAL_MODE:'live',DOCUSEAL_API_KEY:'SIMULATION_NO_NETWORK'});
let marketKnown=true,paused=false,rights='2099-01-01',calls=[],pages=0;
const discovery=await loadService('lib/discovery-service.ts',{
 discoveryWorkEnabled,liveWorkReady,propertyResearchMarketKnown:async()=>marketKnown,
 acquisitionContractCoverage:async()=>{throw Error('Property research must not query contract coverage');},
 db:async path=>{
  calls.push(path);
  if(path.startsWith('icash_discovery_configs'))return [{enabled:true,exhausted:false,zip:'38118',data_rights_until:rights,per_page:5,rate_id:'rate',property_credit_micros:10000,next_page:1,revision:'revision'}];
  if(path.startsWith('icash_bot_setups'))return [];
  if(path.startsWith('icash_accounts'))return [{bot_paused:paused}];
  if(path.startsWith('icash_wallets'))return [{balance_cents:300,reserved_cents:0}];
  if(path.startsWith('icash_operation_rates'))return [{enabled:true,operation:'property_search',expires_at:'2099-01-01',costs_micros:{dealmachine:100000}}];
  if(path.startsWith('icash_operation_spend'))return [];
  throw Error('Unexpected database call '+path);
 },
 discoverPage:async config=>{pages++;assert.equal(config.zip,'38118');assert.equal(config.perPage,5);return {status:'screening_queued',properties:5};},
});
for(const full of ['false','true']){
 process.env.ICASH_DISCOVERY_WORK_READY='true';process.env.ICASH_LIVE_WORK_READY=full;
 assert.equal((await discovery.discoverForAccount('account')).status,'screening_queued');
 paused=true;assert.equal((await discovery.discoverForAccount('account')).status,'paused');paused=false;
 marketKnown=false;assert.equal((await discovery.discoverForAccount('account')).status,'market_configuration_required');marketKnown=true;
 rights='2020-01-01';assert.equal((await discovery.discoverForAccount('account')).status,'not_ready');rights='2099-01-01';
}
assert.equal(pages,2);assert(!calls.some(path=>path.startsWith('icash_signing_templates')));
process.env.ICASH_LIVE_WORK_READY='true';
let terms=dealTermsSchema.parse({seller:'Fixture Seller',buyer:'Fixture Principal',address:'Fixture address',legalDescription:'Fixture legal description',state:'TN',priceCents:100000,priceSource:'seller_reported',earnestCents:0});
let kind='purchase',template=null,writes=0;
const signing=await loadService('lib/signing-service.ts',{z,dealTermsSchema,signingReadiness,
 db:async(path,method='GET')=>{
  assert.equal(method,'GET','Missing coverage must not create an envelope, authorization, or reservation');
  if(path.startsWith('icash_deal_files'))return [{terms,stage:kind==='purchase'?'draft':'under_contract'}];
  if(path.startsWith('icash_customer_identities'))return [{principal:'Fixture Principal'}];
  if(path.startsWith('icash_signing_templates')){assert((path.includes('template_scope=eq.standard')||path.includes('state_code=eq.'+terms.state))&&path.includes('kind=eq.'+kind)&&path.includes('signer_count=eq.1')&&path.includes('test_mode=eq.false')&&path.includes('enabled=eq.true'));return template?[template]:[];}
  writes++;throw Error('Unexpected downstream signing call');
 },dispatchReservedOperation:async()=>{writes++;throw Error('Must not reserve signing funds');}
});
const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{writes++;throw Error('No provider access allowed');};
try{
 for(const state of ['TN','AL'])for(kind of ['purchase','assignment']){
  terms={...terms,state,assignee:'Fixture Assignee',assignmentFeeCents:10000,assignmentDepositCents:0,escrowAgent:'Fixture Escrow'};
  await assert.rejects(()=>signing.sendForSignatures({accountId:'account',userId:'owner',customerEmail:'principal@example.invalid',dealId:'deal',kind,signers:[{name:'Fixture Signer',email:'signer@example.invalid'}]}),/active contract template/);
 }
 template={reviewed_until:'2020-01-01'};
 await assert.rejects(()=>signing.sendForSignatures({accountId:'account',userId:'owner',customerEmail:'principal@example.invalid',dealId:'deal',kind,signers:[{name:'Fixture Signer',email:'signer@example.invalid'}]}),/active contract template/);
 assert.equal(writes,0);
}finally{globalThis.fetch=oldFetch;}
console.log('Research/contract separation: full and independent discovery admit a configured TN market; pause, rights and unknown-market holds remain; TN/AL purchase and assignment send reject before writes without configured templates.');
