// Bounded synthetic conversations. Every tool is mocked; nobody is contacted.
import {createHash} from 'node:crypto';
import {db} from '../lib/stripe-test.ts';
import {selectedConversationRoleInstructions as selectedScenarioRoleInstructions,buyerConversationPolicy as buyerScenarioPolicy} from '../lib/buyer-conversation-policy.ts';
import {stageBuyerConversationPolicy} from './stage-buyer-conversation-policy.mjs';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {automaticOfferReceptionPrompt,isolatedBuyerReceptionPolicyHash,conversationBuyerReceptionPolicyHash as scenarioBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {testAutomaticOfferProvider} from './test-automatic-offer-provider.mjs';
import {buyerScenarioCases} from './buyer-scenario-cases-20261009.mjs';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')process.exit(0);
const provider='buyer_scenario_audit_20261009_v6',sourceBranch='agtbrch_8101m4h801smere91ege6f978hc7',sourceVersion='agtvrsn_7001m4h801skee292g590meg3yg0';
const fixtureHash=createHash('sha256').update(JSON.stringify({cases:buyerScenarioCases,role:selectedScenarioRoleInstructions('buyer',automaticOfferReceptionPrompt),sellerRole:selectedScenarioRoleInstructions('matched',automaticOfferReceptionPrompt),sellerRegression:'closingCases-v2-review-needed',policyHash:scenarioBuyerReceptionPolicyHash})).digest('hex');
const [prior]=await db('icash_integration_checks?provider=eq.'+provider+'&select=result');
const [stageEvidence]=await db('icash_integration_checks?provider=eq.buyer_conversation_stage_20261009_v1&select=result');
if(prior){if(stageEvidence?.result?.status==='staged'&&stageEvidence.result.policyHash===scenarioBuyerReceptionPolicyHash&&prior.result?.status==='passed'&&prior.result.fixtureHash===fixtureHash&&prior.result.branchId===stageEvidence.result.branchId&&prior.result.version===stageEvidence.result.versionId&&prior.result.configHash===stageEvidence.result.configHash&&prior.result.stagedConfigId===stageEvidence.result.configId&&prior.result.count===buyerScenarioCases.length+2&&prior.result.policyHash===scenarioBuyerReceptionPolicyHash)process.exit(0);throw Error('BUYER_SCENARIO_AUDIT_REVIEW_REQUIRED');}
if(Date.now()>Date.parse('2026-10-10T00:00:00Z'))throw Error('BUYER_SCENARIO_AUDIT_WINDOW_REQUIRED');
// Earlier failures stay immutable. v6 separates factual tool data from speaking
// instructions, preserves the once-per-call opening, and makes nonnumeric privacy
// refusals explicitly valid without relaxing authorized-price validation.
const [failedAudit]=await db('icash_integration_checks?provider=eq.buyer_scenario_audit_20261009_v5&select=result');
if(failedAudit?.result?.status!=='failed'||failedAudit.result.fixtureHash!=='d1012080ea3ac92001d5467ed78c4c5e81f929131f2671b3e41ba30658a1b1ea'||failedAudit.result.code!=='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'||failedAudit.result.count!==30||failedAudit.result.tests?.length!==30||failedAudit.result.branchId!=='agtbrch_9501m4heehy0eftbhsq5za6ghzkx'||failedAudit.result.version!=='agtvrsn_0801m4heehxzedxsa4p74a39ev59'||failedAudit.result.sourceBranchId!==sourceBranch||failedAudit.result.sourceVersion!==sourceVersion)throw Error('BUYER_FAILED_AUDIT_REVIEW_REQUIRED');
const [previous]=await db('icash_integration_checks?provider=eq.buyer_confidence_title_provider_test_20261009_v4&select=result');
if(previous?.result?.status!=='passed'||previous.result.count!==9||previous.result.version!==sourceVersion||previous.result.branchId!==sourceBranch)throw Error('BUYER_PRIOR_ACCEPTANCE_REQUIRED');
const config=await db('rpc/icash_get_recorded_reception_config','POST',{p_called_number:'+17816093521'});
if(config?.id!=='036a642a-2683-44b2-be50-52193aea693b'||config.context_policy!=='automatic_offer_v11'||config.context_policy_hash!==isolatedBuyerReceptionPolicyHash||config.branch_id!==sourceBranch||config.version_id!==sourceVersion)throw Error('BUYER_EXACT_ACTIVE_VERSION_REQUIRED');
await db('icash_buyer_viewing_requests?select=id,viewing_quote,coordination_quote&limit=0');
if(!process.env.ELEVENLABS_API_KEY)throw Error('BUYER_PROVIDER_CONFIGURATION_REQUIRED');
const observations=new Map(),invocations=new Set();
const api=async(path,method='GET',body)=>{
 const r=await fetch('https://api.us.elevenlabs.io'+path,{method,headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('BUYER_SCENARIO_HTTP_'+r.status);
 const data=await r.json();
 if(path.startsWith('/v1/convai/test-invocations/')&&Array.isArray(data.test_runs)){
  invocations.add(path.split('/').at(-1));
  for(const t of data.test_runs)observations.set(t.test_name,{name:t.test_name,status:t.status,branch:t.branch_id,version:t.version_id,condition:t.condition_result,guardrailEvents:(t.agent_responses??[]).flatMap(m=>(m.tool_calls??[]).filter(c=>c.tool_name==='guardrail_triggered').map(c=>{try{const p=JSON.parse(c.params_as_json);return {message:typeof p.agent_message==='string'?p.agent_message.slice(0,4000):null};}catch{return {message:null};}})),turns:(t.agent_responses??[]).filter(m=>typeof m.message==='string').map(m=>({role:m.role,message:m.message.slice(0,4000)}))});
 }
 return data;
};
const staged=await stageBuyerConversationPolicy(api,config);
const branch=staged.branchId,version=staged.versionId;
const agent=await api('/v1/convai/agents/'+config.agent_id+'?branch_id='+branch);
if(agent.version_id!==version||!agent.conversation_config?.agent?.prompt?.tool_ids?.includes(config.agreement_tool_id))throw Error('BUYER_PROVIDER_VERSION_CHANGED');
const [branches,workspace,stop,tool]=await Promise.all([api('/v1/convai/agents/'+config.agent_id+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+config.stop_tool_id),api('/v1/convai/tools/'+config.agreement_tool_id)]);
const candidate={...config,branch_id:branch,config_hash:staged.configHash,context_policy:buyerScenarioPolicy,context_policy_hash:scenarioBuyerReceptionPolicyHash,reviewed_version_id:version};
if(!Array.isArray(branches.results)||branches.results.length>=100||branches.next_cursor||!inspectRecordedReceptionAgent(candidate,agent,branches.results.find(b=>b.id===branch),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_SCENARIO_PROVIDER_REVIEW_REQUIRED');
const stagedConfigId=staged.configId;
if(typeof stagedConfigId!=='string')throw Error('BUYER_SCENARIO_STAGING_REQUIRED');
const result=status=>({status,fixtureHash,branchId:branch,version,policyHash:scenarioBuyerReceptionPolicyHash,sourceConfigId:config.id,sourceBranchId:config.branch_id,sourceVersion:config.version_id,sourceConfigHash:config.config_hash,stagedConfigId,configHash:staged.configHash,commit:process.env.VERCEL_GIT_COMMIT_SHA,count:buyerScenarioCases.length+2,buyerCount:buyerScenarioCases.length,sellerCount:2,passedCount:[...observations.values()].filter(t=>t.status==='passed').length,outreach:false,invocations:[...invocations],tests:[...observations.values()]});
await db('icash_integration_checks','POST',{provider,checked_at:new Date().toISOString(),result:result('started')});
try{
 for(let i=0;i<buyerScenarioCases.length;i+=6){
  try{await testAutomaticOfferProvider(api,[{...agent,agent_id:config.agent_id,branch_id:branch,version_id:version}],config.agreement_tool_id,{prefix:'buyer-scenarios-20261009-v6-',roleInstructions:status=>selectedScenarioRoleInstructions(status,automaticOfferReceptionPrompt),cases:buyerScenarioCases.slice(i,i+6)});}
  catch(e){if(e.message!=='AUTOMATIC_OFFER_PROVIDER_TESTS_REQUIRED'||observations.size!==Math.min(i+6,buyerScenarioCases.length)||[...observations.values()].some(t=>!['passed','failed'].includes(t.status)))throw e;}
  await db('icash_integration_checks?provider=eq.'+provider,'PATCH',{checked_at:new Date().toISOString(),result:result('running')});
 }
 try{await testAutomaticOfferProvider(api,[{...agent,agent_id:config.agent_id,branch_id:branch,version_id:version}],config.agreement_tool_id,{prefix:'buyer-scenarios-20261009-v6-seller-',roleInstructions:status=>selectedScenarioRoleInstructions(status,automaticOfferReceptionPrompt),closingCases:true});}
 catch(e){if(e.message!=='AUTOMATIC_OFFER_PROVIDER_TESTS_REQUIRED'||observations.size!==buyerScenarioCases.length+2||[...observations.values()].some(t=>!['passed','failed'].includes(t.status)))throw e;}
 if(observations.size!==buyerScenarioCases.length+2||[...observations.values()].some(t=>t.status!=='passed'||t.branch!==branch||t.version!==version))throw Error('BUYER_SCENARIO_FAILURES_REQUIRE_FIX');
 await db('icash_integration_checks?provider=eq.'+provider,'PATCH',{checked_at:new Date().toISOString(),result:result('passed')});
 console.log('Buyer scenario audit passed:',buyerScenarioCases.length,'buyer and 2 seller conversations; candidate remains inactive.');
}catch(e){
 const code=/^[A-Z0-9_]{3,100}$/.test(e.message)?e.message:'BUYER_SCENARIO_UNCONFIRMED';
 await db('icash_integration_checks?provider=eq.'+provider,'PATCH',{checked_at:new Date().toISOString(),result:{...result('failed'),code}});
 throw Error(code);
}
