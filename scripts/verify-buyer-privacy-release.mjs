// Application-only privacy release. Read-only provider checks; no voice staging,
// candidate activation, synthetic conversations, outbound messages or calls.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {db} from '../lib/stripe-test.ts';
import {renderBuyerPackage} from '../lib/buyer-disposition.ts';
import {calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
import {receptionContextVariables} from '../lib/reception-property-context.ts';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {isolatedBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
import {diagnoseReceptionFingerprint,receptionFingerprintSettings} from './reception-fingerprint-diagnostic.mjs';

if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')process.exit(0);
const commit=process.env.VERCEL_GIT_COMMIT_SHA;
if(!/^[a-f0-9]{40}$/.test(commit??''))throw Error('BUYER_PRIVACY_RELEASE_COMMIT_REQUIRED');
const test=spawnSync(process.execPath,['--experimental-strip-types','--test',
 'tests/buyer-package-photos.test.mjs','tests/buyer-package-email.test.mjs',
 'tests/deal-documents.test.mjs','tests/signing-service-validation.test.mjs','tests/assignment-contract-policy.test.mjs',
 'tests/buyer-scenarios.test.mjs'],{stdio:'inherit'});
if(test.status!==0)throw Error('BUYER_PRIVACY_APPLICATION_TESTS_REQUIRED');
const account='48dfb798-8c1a-404f-88c0-c396cc067062',deal='f50f5183-9b83-4cb3-b099-76f246e7ac9b';
const [c,held,p,failed]=await Promise.all([
 db('rpc/icash_get_recorded_reception_config','POST',{p_called_number:'+17816093521'}),
 db('rpc/icash_buyer_outreach_held','POST',{p_account:account,p_deal:deal}),
 db('rpc/icash_buyer_package_data','POST',{p_account:account,p_deal:deal}),
 db('icash_integration_checks?provider=eq.buyer_scenario_audit_20261009_v7&select=result'),
]);
if(c?.id!=='036a642a-2683-44b2-be50-52193aea693b'||c.context_policy!=='automatic_offer_v11'||c.context_policy_hash!==isolatedBuyerReceptionPolicyHash||c.branch_id!=='agtbrch_8101m4h801smere91ege6f978hc7'||c.version_id!=='agtvrsn_7001m4h801skee292g590meg3yg0'||c.config_hash!=='b1a4c75ebac9890933189d3b98f68c34774e9cbbd79b72a62756c70e3ebcc060')throw Error('BUYER_PRIVACY_UNCHANGED_ACTIVE_SOURCE_REQUIRED');
if(held!==true)throw Error('BUYER_PRIVACY_OUTREACH_HOLD_REQUIRED');
const audit=failed[0]?.result;
if(audit?.status!=='failed'||audit.code!=='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'||audit.fixtureHash!=='d122040ff176d09d208e77fafdc7c67f5c42024d0118ce5d76221feff1b988e0'||audit.count!==30||audit.tests?.length!==30||audit.tests.some(t=>!['passed','failed'].includes(t.status)))throw Error('BUYER_PRIVACY_FAILED_VOICE_EVIDENCE_REQUIRED');
if(!process.env.ELEVENLABS_API_KEY)throw Error('BUYER_PRIVACY_PROVIDER_CONFIGURATION_REQUIRED');
const api=async path=>{
 const r=await fetch('https://api.us.elevenlabs.io'+path,{headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('BUYER_PRIVACY_PROVIDER_READBACK_REQUIRED');
 return JSON.parse((await boundedBytes(r,1024*1024)).toString('utf8'));
};
const path='/v1/convai/agents/'+c.agent_id;
const [agent,branches,workspace,stop,tool]=await Promise.all([
 api(path+'?branch_id='+c.branch_id),api(path+'/branches?include_archived=true&limit=100'),
 api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api('/v1/convai/tools/'+c.agreement_tool_id),
]);
if(!Array.isArray(branches.results)||branches.results.length>=100||branches.next_cursor||branches.results.some(b=>b.name==='buyer-validated-b3f477756bc851a6a'))throw Error('BUYER_PRIVACY_REJECTED_BRANCH_REVIEW_REQUIRED');
const observed=inspectRecordedReceptionAgent(c,agent,branches.results.find(b=>b.id===c.branch_id),receptionWorkspacePostcallAbsent(workspace),stop,tool);
if(!observed.safe){
 // Only internal check names, booleans and bounded tool-shape evidence. Never
 // log provider configuration, prompt text, webhook headers or credentials.
 console.error('Buyer provider verification mismatch',JSON.stringify({failedChecks:Object.entries(observed.checks).filter(([,passed])=>!passed).map(([name])=>name),hashMatches:observed.hash===c.config_hash,versionMatches:agent.version_id===c.reviewed_version_id,inlineTools:observed.inlineTools}));
 if(observed.hash!==c.config_hash)console.error('Buyer provider fingerprint diagnostic',JSON.stringify(diagnoseReceptionFingerprint(agent,c.config_hash)));
 console.error('Buyer provider fixed settings diagnostic',JSON.stringify(receptionFingerprintSettings(agent)));
 // Compare the provider's explicitly version-pinned read, without accepting it
 // in place of the active branch or exposing either response in logs.
 try{
  const pinned=await api(path+'?branch_id='+c.branch_id+'&version_id='+c.reviewed_version_id);
  const pinnedObservation=inspectRecordedReceptionAgent(c,pinned,branches.results.find(b=>b.id===c.branch_id),receptionWorkspacePostcallAbsent(workspace),stop,tool);
  console.error('Buyer provider version-pinned diagnostic',JSON.stringify({safe:pinnedObservation.safe,hashMatches:pinnedObservation.hash===c.config_hash,sameAsBranch:pinnedObservation.hash===observed.hash,versionMatches:pinned.version_id===c.reviewed_version_id,failedChecks:Object.entries(pinnedObservation.checks).filter(([,passed])=>!passed).map(([name])=>name)}));
 }catch{console.error('Buyer provider version-pinned diagnostic unavailable');}
 throw Error('BUYER_PRIVACY_PROVIDER_SOURCE_CHANGED');
}
if(!p||p.askingPriceCents!==16227050||p.depositCents!==200000||p.closingDate!=='2026-11-07')throw Error('BUYER_PRIVACY_CURRENT_PACKAGE_REQUIRED');
const offer=calculateAutomaticCallOffer({party:'buyer',buyer:p},{});
const variables=receptionContextVariables(c,{...p,status:'buyer'});
const context=JSON.parse(variables.icash_property_context);
assert.equal(context?.status,'buyer');assert.equal(context.askingPriceCents,p.askingPriceCents);
assert.equal(offer.quoteAllowed,true);assert.equal(offer.priceCents,p.askingPriceCents);
assert.equal(offer.depositCents,p.depositCents);assert.equal(offer.propertyPhotoCount,1);
assert.equal(offer.sellerPhotoCount,0);assert.equal(offer.paymentAuthorized,false);
const privateKeys=new Set(['purchasePriceCents','assignmentFeeCents','spread','margin']);
function publicKeys(value){if(!value||typeof value!=='object')return;for(const [key,v] of Object.entries(value)){if(privateKeys.has(key))throw Error('BUYER_PRIVACY_PRIVATE_FIELD');publicKeys(v);}}
publicKeys(context);publicKeys(offer);
const html=renderBuyerPackage(p),outputs=[html,JSON.stringify(context),JSON.stringify(offer)];
for(const value of [p.purchasePriceCents,p.assignmentFeeCents].filter(Number.isSafeInteger)){
 if([p.askingPriceCents,p.depositCents,p.arvCents,p.repairsCents].includes(value))continue;
 const formatted=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
 for(const output of outputs)if(output.includes(formatted)||output.includes(String(value)))throw Error('BUYER_PRIVACY_PRIVATE_AMOUNT');
}
if(!html.includes('$162,270.50')||!html.includes('$2,000.00')||!html.includes('Property photos')||/Underlying purchase price|Assignment fee:/.test(html))throw Error('BUYER_PRIVACY_RENDER_REQUIRED');
// Catalog inspection informs a later inactive voice revision. Its availability
// does not determine whether the application protects private prices.
let models=[];
try{const catalog=await api('/v1/convai/llm/list');models=(catalog.llms??[]).map(m=>m.llm).filter(m=>typeof m==='string'&&/^[a-zA-Z0-9._:/-]{1,100}$/.test(m));}catch{/* No provider writes or retry. */}
const result={status:'verified',scope:'application_price_privacy_only',commit,sourceConfigId:c.id,sourceBranchId:c.branch_id,sourceVersion:c.version_id,sourceConfigHash:observed.hash,sourcePolicy:c.context_policy,packageProjectionVerified:true,voiceDataProjectionVerified:true,signingPrivacyTestsPassed:true,providerWrites:false,outreach:false,candidateActivationAllowed:false,failedVoiceAuditPreserved:'buyer_scenario_audit_20261009_v7',pendingDatabasePrivacy:p.privacyPolicy!=='buyer_price_only_v1',availableModels:models};
const marker='buyer_privacy_release_20261009_'+commit.slice(0,12);
const [prior]=await db('icash_integration_checks?provider=eq.'+marker+'&select=result');
if(prior){if(prior.result?.status!=='verified'||prior.result.commit!==commit||prior.result.sourceConfigHash!==observed.hash||prior.result.candidateActivationAllowed!==false)throw Error('BUYER_PRIVACY_RELEASE_EVIDENCE_CHANGED');}
else await db('icash_integration_checks','POST',{provider:marker,checked_at:new Date().toISOString(),result});
console.log('Buyer application privacy verified against unchanged active v11. Candidate activation remains blocked. Database privacy migration follows READY application deployment.');
console.log('Available voice models:',JSON.stringify(models));
