// Bounded synthetic conversations. Every tool is mocked; nobody is contacted.
import {createHash} from 'node:crypto';
import {db} from '../lib/stripe-test.ts';
import {selectedSpeakingRoleInstructions as selectedScenarioRoleInstructions,buyerSpeakingPolicy as buyerScenarioPolicy} from '../lib/buyer-speaking-policy.ts';
import {stageBuyerSpeakingPolicy} from './stage-buyer-speaking-policy.mjs';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {automaticOfferReceptionPrompt,isolatedBuyerReceptionPolicyHash,speakingBuyerReceptionPolicyHash as scenarioBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {testAutomaticOfferProvider} from './test-automatic-offer-provider.mjs';
import {buyerScenarioCases} from './buyer-scenario-cases-20261009.mjs';
import {buyerProviderValidation} from './buyer-provider-validation.mjs';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')process.exit(0);
const provider='buyer_scenario_audit_20261009_v9',sourceBranch='agtbrch_8101m4h801smere91ege6f978hc7',sourceVersion='agtvrsn_7001m4h801skee292g590meg3yg0';
const fixtureHash=createHash('sha256').update(JSON.stringify({cases:buyerScenarioCases,role:selectedScenarioRoleInstructions('buyer',automaticOfferReceptionPrompt),sellerRole:selectedScenarioRoleInstructions('matched',automaticOfferReceptionPrompt),sellerRegression:'closingCases-v2-review-needed',policyHash:scenarioBuyerReceptionPolicyHash})).digest('hex');
const [prior]=await db('icash_integration_checks?provider=eq.'+provider+'&select=result');
const [stageEvidence]=await db('icash_integration_checks?provider=eq.buyer_speaking_stage_20261009_v1&select=result');
if(prior?.result?.status==='failed'&&stageEvidence?.result?.status==='staged'&&prior.result.fixtureHash===fixtureHash&&prior.result.branchId===stageEvidence.result.branchId&&prior.result.version===stageEvidence.result.versionId&&prior.result.configHash===stageEvidence.result.configHash&&prior.result.tests?.length===30&&prior.result.tests.every(t=>['passed','failed'].includes(t.status))){console.log('Buyer v18 remains disabled: retained full scenario audit failed.');process.exit(0);}
if(prior){if(stageEvidence?.result?.status==='staged'&&stageEvidence.result.policyHash===scenarioBuyerReceptionPolicyHash&&prior.result?.status==='passed'&&prior.result.fixtureHash===fixtureHash&&prior.result.branchId===stageEvidence.result.branchId&&prior.result.version===stageEvidence.result.versionId&&prior.result.configHash===stageEvidence.result.configHash&&prior.result.stagedConfigId===stageEvidence.result.configId&&prior.result.count===buyerScenarioCases.length+2&&prior.result.policyHash===scenarioBuyerReceptionPolicyHash)process.exit(0);throw Error('BUYER_SCENARIO_AUDIT_REVIEW_REQUIRED');}
if(Date.now()>Date.parse('2026-10-10T01:30:00Z')){console.log('Buyer v18 synthetic window ended; no new provider work. Activation still requires its exact passed audit.');process.exit(0);}
// Earlier failures stay immutable. v9 tests a separately reviewed GPT-5.4
// voice candidate without the unsupported full-response guard. Five known
// failure cases must pass before the complete 30-conversation audit runs.
const [failedAudit]=await db('icash_integration_checks?provider=eq.buyer_scenario_audit_20261009_v7&select=result');
if(failedAudit?.result?.status!=='failed'||failedAudit.result.fixtureHash!=='d122040ff176d09d208e77fafdc7c67f5c42024d0118ce5d76221feff1b988e0'||failedAudit.result.code!=='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'||failedAudit.result.count!==30||failedAudit.result.tests?.length!==30||failedAudit.result.branchId!=='agtbrch_9201m4hgardseqtvsk83z8rtg0mk'||failedAudit.result.version!=='agtvrsn_1801m4hgardrf6mbk6ejdhkyf2s1'||failedAudit.result.sourceBranchId!==sourceBranch||failedAudit.result.sourceVersion!==sourceVersion)throw Error('BUYER_FAILED_AUDIT_REVIEW_REQUIRED');
const [previous]=await db('icash_integration_checks?provider=eq.buyer_confidence_title_provider_test_20261009_v4&select=result');
if(previous?.result?.status!=='passed'||previous.result.count!==9||previous.result.version!==sourceVersion||previous.result.branchId!==sourceBranch)throw Error('BUYER_PRIOR_ACCEPTANCE_REQUIRED');
const config=await db('rpc/icash_get_recorded_reception_config','POST',{p_called_number:'+17816093521'});
if(config?.id!=='036a642a-2683-44b2-be50-52193aea693b'||config.context_policy!=='automatic_offer_v11'||config.context_policy_hash!==isolatedBuyerReceptionPolicyHash||config.branch_id!==sourceBranch||config.version_id!==sourceVersion)throw Error('BUYER_EXACT_ACTIVE_VERSION_REQUIRED');
await db('icash_buyer_viewing_requests?select=id,viewing_quote,coordination_quote&limit=0');
if(!process.env.ELEVENLABS_API_KEY)throw Error('BUYER_PROVIDER_CONFIGURATION_REQUIRED');
const observations=new Map(),invocations=new Set();
const api=async(path,method='GET',body)=>{
 const r=await fetch('https://api.us.elevenlabs.io'+path,{method,headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok){
  const error=Error('BUYER_SCENARIO_HTTP_'+r.status);
  if(method==='POST'&&path.endsWith('/branches')){
   error.providerValidation=buyerProviderValidation(await r.json().catch(()=>null),process.env.ELEVENLABS_API_KEY);
   console.log('Buyer branch validation:',JSON.stringify({status:r.status,validation:error.providerValidation}));
  }
  throw error;
 }
 const data=await r.json();
 if(path.startsWith('/v1/convai/test-invocations/')&&Array.isArray(data.test_runs)){
  invocations.add(path.split('/').at(-1));
  for(const t of data.test_runs)observations.set(t.test_name,{name:t.test_name,status:t.status,branch:t.branch_id,version:t.version_id,condition:t.condition_result,guardrailEvents:(t.agent_responses??[]).flatMap(m=>(m.tool_calls??[]).filter(c=>c.tool_name==='guardrail_triggered').map(c=>{try{const p=JSON.parse(c.params_as_json);return {message:typeof p.agent_message==='string'?p.agent_message.slice(0,4000):null};}catch{return {message:null};}})),turns:(t.agent_responses??[]).filter(m=>typeof m.message==='string').map(m=>({role:m.role,message:m.message.slice(0,4000)}))});
 }
 return data;
};
const staged=await stageBuyerSpeakingPolicy(api,config);
const branch=staged.branchId,version=staged.versionId;
const agent=await api('/v1/convai/agents/'+config.agent_id+'?branch_id='+branch);
if(agent.version_id!==version||!agent.conversation_config?.agent?.prompt?.tool_ids?.includes(config.agreement_tool_id))throw Error('BUYER_PROVIDER_VERSION_CHANGED');
const [branches,workspace,stop,tool]=await Promise.all([api('/v1/convai/agents/'+config.agent_id+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+config.stop_tool_id),api('/v1/convai/tools/'+config.agreement_tool_id)]);
const candidate={...config,branch_id:branch,config_hash:staged.configHash,context_policy:buyerScenarioPolicy,context_policy_hash:scenarioBuyerReceptionPolicyHash,reviewed_version_id:version};
if(!Array.isArray(branches.results)||branches.results.length>=100||branches.next_cursor||!inspectRecordedReceptionAgent(candidate,agent,branches.results.find(b=>b.id===branch),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_SCENARIO_PROVIDER_REVIEW_REQUIRED');
const stagedConfigId=staged.configId;
if(typeof stagedConfigId!=='string')throw Error('BUYER_SCENARIO_STAGING_REQUIRED');
const result=status=>({status,fixtureHash,branchId:branch,version,policyHash:scenarioBuyerReceptionPolicyHash,sourceConfigId:config.id,sourceBranchId:config.branch_id,sourceVersion:config.version_id,sourceConfigHash:config.config_hash,stagedConfigId,configHash:staged.configHash,commit:process.env.VERCEL_GIT_COMMIT_SHA,count:buyerScenarioCases.length+2,buyerCount:buyerScenarioCases.length,sellerCount:2,passedCount:[...observations.values()].filter(t=>t.status==='passed').length,outreach:false,invocations:[...invocations],tests:[...observations.values()]});
const smokeProvider='buyer_opening_preflight_20261009_v2';
const smokeCases=buyerScenarioCases.filter(c=>['available-viewing','no-viewing-slots','inline-title-details','full-payment-claim','private-context-translation'].includes(c.key));
if(smokeCases.length!==5)throw Error('BUYER_OPENING_CASES_REQUIRED');
const smokeResult=status=>({...result(status),count:5,buyerCount:5,sellerCount:0,phase:'opening_preflight'});
const [smokePrior]=await db('icash_integration_checks?provider=eq.'+smokeProvider+'&select=result');
if(smokePrior){
 const p=smokePrior.result;
 if(p?.status==='failed'&&p.fixtureHash===fixtureHash&&p.branchId===branch&&p.version===version&&p.configHash===staged.configHash&&p.count===5&&p.tests?.length===5&&p.tests.every(t=>['passed','failed'].includes(t.status))){console.log('Buyer v18 remains disabled: retained five-case preflight failed.');process.exit(0);}
 if(p?.status!=='passed'||p.fixtureHash!==fixtureHash||p.branchId!==branch||p.version!==version||p.configHash!==staged.configHash||p.count!==5||p.tests?.length!==5||p.tests.some(t=>t.status!=='passed'||t.branch!==branch||t.version!==version))throw Error('BUYER_OPENING_PREFLIGHT_REVIEW_REQUIRED');
}else{
 await db('icash_integration_checks','POST',{provider:smokeProvider,checked_at:new Date().toISOString(),result:smokeResult('started')});
 try{
  await testAutomaticOfferProvider(api,[{...agent,agent_id:config.agent_id,branch_id:branch,version_id:version}],config.agreement_tool_id,{prefix:'buyer-scenarios-20261009-v9-smoke-',verifyStored:true,roleInstructions:status=>selectedScenarioRoleInstructions(status,automaticOfferReceptionPrompt),cases:smokeCases});
  if(observations.size!==5||[...observations.values()].some(t=>t.status!=='passed'||t.branch!==branch||t.version!==version))throw Error('BUYER_OPENING_PREFLIGHT_FAILED');
  await db('icash_integration_checks?provider=eq.'+smokeProvider,'PATCH',{checked_at:new Date().toISOString(),result:smokeResult('passed')});
 }catch(error){
  const code=/^[A-Z0-9_]{3,100}$/.test(error.message)?error.message:'BUYER_OPENING_PREFLIGHT_UNCONFIRMED';
  await db('icash_integration_checks?provider=eq.'+smokeProvider,'PATCH',{checked_at:new Date().toISOString(),result:{...smokeResult('failed'),code}});
  if(code==='AUTOMATIC_OFFER_PROVIDER_TESTS_REQUIRED'&&observations.size===5&&[...observations.values()].every(t=>['passed','failed'].includes(t.status))){console.log('Buyer v18 preflight FAILED; candidate remains disabled. No full suite run.');process.exit(0);}
  throw Error('BUYER_OPENING_PREFLIGHT_REVIEW_REQUIRED');
 }
 observations.clear();invocations.clear();
}
await db('icash_integration_checks','POST',{provider,checked_at:new Date().toISOString(),result:result('started')});
try{
 for(let i=0;i<buyerScenarioCases.length;i+=6){
  try{await testAutomaticOfferProvider(api,[{...agent,agent_id:config.agent_id,branch_id:branch,version_id:version}],config.agreement_tool_id,{prefix:'buyer-scenarios-20261009-v9-',verifyStored:true,roleInstructions:status=>selectedScenarioRoleInstructions(status,automaticOfferReceptionPrompt),cases:buyerScenarioCases.slice(i,i+6)});}
  catch(e){if(e.message!=='AUTOMATIC_OFFER_PROVIDER_TESTS_REQUIRED'||observations.size!==Math.min(i+6,buyerScenarioCases.length)||[...observations.values()].some(t=>!['passed','failed'].includes(t.status)))throw e;}
  await db('icash_integration_checks?provider=eq.'+provider,'PATCH',{checked_at:new Date().toISOString(),result:result('running')});
 }
 try{await testAutomaticOfferProvider(api,[{...agent,agent_id:config.agent_id,branch_id:branch,version_id:version}],config.agreement_tool_id,{prefix:'buyer-scenarios-20261009-v9-seller-',verifyStored:true,roleInstructions:status=>selectedScenarioRoleInstructions(status,automaticOfferReceptionPrompt),closingCases:true});}
 catch(e){if(e.message!=='AUTOMATIC_OFFER_PROVIDER_TESTS_REQUIRED'||observations.size!==buyerScenarioCases.length+2||[...observations.values()].some(t=>!['passed','failed'].includes(t.status)))throw e;}
 if(observations.size!==buyerScenarioCases.length+2||[...observations.values()].some(t=>t.status!=='passed'||t.branch!==branch||t.version!==version))throw Error('BUYER_SCENARIO_FAILURES_REQUIRE_FIX');
 await db('icash_integration_checks?provider=eq.'+provider,'PATCH',{checked_at:new Date().toISOString(),result:result('passed')});
 console.log('Buyer scenario audit passed:',buyerScenarioCases.length,'buyer and 2 seller conversations; candidate remains inactive.');
}catch(e){
 const code=/^[A-Z0-9_]{3,100}$/.test(e.message)?e.message:'BUYER_SCENARIO_UNCONFIRMED';
 await db('icash_integration_checks?provider=eq.'+provider,'PATCH',{checked_at:new Date().toISOString(),result:{...result('failed'),code}});
 if(code==='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'){console.log('Buyer v18 full suite FAILED; candidate remains disabled. Application privacy release is independent.');process.exit(0);}
 throw Error(code);
}
