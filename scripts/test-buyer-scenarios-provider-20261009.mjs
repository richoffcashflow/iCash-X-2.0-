// Bounded synthetic conversations. Every tool is mocked; nobody is contacted.
import {createHash} from 'node:crypto';
import {db} from '../lib/stripe-test.ts';
import {selectedRoleInstructions} from '../lib/buyer-role-policy.ts';
import {automaticOfferReceptionPrompt,isolatedBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {testAutomaticOfferProvider} from './test-automatic-offer-provider.mjs';
import {buyerScenarioCases} from './buyer-scenario-cases-20261009.mjs';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')process.exit(0);
const provider='buyer_scenario_audit_20261009_v2',branch='agtbrch_8101m4h801smere91ege6f978hc7',version='agtvrsn_7001m4h801skee292g590meg3yg0';
const fixtureHash=createHash('sha256').update(JSON.stringify({cases:buyerScenarioCases,role:selectedRoleInstructions('buyer',automaticOfferReceptionPrompt),policyHash:isolatedBuyerReceptionPolicyHash})).digest('hex');
const [prior]=await db('icash_integration_checks?provider=eq.'+provider+'&select=result');
if(prior){if(prior.result?.status==='passed'&&prior.result.fixtureHash===fixtureHash&&prior.result.branchId===branch&&prior.result.version===version&&prior.result.count===buyerScenarioCases.length)process.exit(0);throw Error('BUYER_SCENARIO_AUDIT_REVIEW_REQUIRED');}
if(Date.now()>Date.parse('2026-10-10T00:00:00Z'))throw Error('BUYER_SCENARIO_AUDIT_WINDOW_REQUIRED');
// v1 remains immutable evidence. This one new run follows concrete fixes to its
// five failed conversations; it is not a retry of identical instructions.
const [failedAudit]=await db('icash_integration_checks?provider=eq.buyer_scenario_audit_20261009_v1&select=result');
if(failedAudit?.result?.status!=='failed'||failedAudit.result.fixtureHash!=='34e22433604097fa37e9d0bde16acaba5f215f323a55cf5f12b9d95dd8b0e0b7'||failedAudit.result.code!=='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'||failedAudit.result.count!==28||failedAudit.result.passedCount!==23||failedAudit.result.tests?.length!==28||failedAudit.result.branchId!==branch||failedAudit.result.version!==version)throw Error('BUYER_FAILED_AUDIT_REVIEW_REQUIRED');
const [previous]=await db('icash_integration_checks?provider=eq.buyer_confidence_title_provider_test_20261009_v4&select=result');
if(previous?.result?.status!=='passed'||previous.result.count!==9||previous.result.version!==version||previous.result.branchId!==branch)throw Error('BUYER_PRIOR_ACCEPTANCE_REQUIRED');
const config=await db('rpc/icash_get_recorded_reception_config','POST',{p_called_number:'+17816093521'});
if(config?.id!=='036a642a-2683-44b2-be50-52193aea693b'||config.context_policy!=='automatic_offer_v11'||config.context_policy_hash!==isolatedBuyerReceptionPolicyHash||config.branch_id!==branch||config.version_id!==version)throw Error('BUYER_EXACT_ACTIVE_VERSION_REQUIRED');
await db('icash_buyer_viewing_requests?select=id,viewing_quote,coordination_quote&limit=0');
if(!process.env.ELEVENLABS_API_KEY)throw Error('BUYER_PROVIDER_CONFIGURATION_REQUIRED');
const observations=new Map(),invocations=new Set();
const api=async(path,method='GET',body)=>{
 const r=await fetch('https://api.us.elevenlabs.io'+path,{method,headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('BUYER_SCENARIO_HTTP_'+r.status);
 const data=await r.json();
 if(path.startsWith('/v1/convai/test-invocations/')&&Array.isArray(data.test_runs)){
  invocations.add(path.split('/').at(-1));
  for(const t of data.test_runs)observations.set(t.test_name,{name:t.test_name,status:t.status,branch:t.branch_id,version:t.version_id,condition:t.condition_result,turns:(t.agent_responses??[]).filter(m=>typeof m.message==='string').map(m=>({role:m.role,message:m.message.slice(0,4000)}))});
 }
 return data;
};
const agent=await api('/v1/convai/agents/'+config.agent_id+'?branch_id='+branch);
if(agent.version_id!==version||!agent.conversation_config?.agent?.prompt?.tool_ids?.includes(config.agreement_tool_id))throw Error('BUYER_PROVIDER_VERSION_CHANGED');
const result=status=>({status,fixtureHash,branchId:branch,version,policyHash:isolatedBuyerReceptionPolicyHash,commit:process.env.VERCEL_GIT_COMMIT_SHA,count:buyerScenarioCases.length,passedCount:[...observations.values()].filter(t=>t.status==='passed').length,outreach:false,invocations:[...invocations],tests:[...observations.values()]});
await db('icash_integration_checks','POST',{provider,checked_at:new Date().toISOString(),result:result('started')});
try{
 for(let i=0;i<buyerScenarioCases.length;i+=6){
  try{await testAutomaticOfferProvider(api,[{...agent,agent_id:config.agent_id,branch_id:branch,version_id:version}],config.agreement_tool_id,{prefix:'buyer-scenarios-20261009-v2-',roleInstructions:status=>selectedRoleInstructions(status,automaticOfferReceptionPrompt),cases:buyerScenarioCases.slice(i,i+6)});}
  catch(e){if(e.message!=='AUTOMATIC_OFFER_PROVIDER_TESTS_REQUIRED'||observations.size!==Math.min(i+6,buyerScenarioCases.length)||[...observations.values()].some(t=>!['passed','failed'].includes(t.status)))throw e;}
  await db('icash_integration_checks?provider=eq.'+provider,'PATCH',{checked_at:new Date().toISOString(),result:result('running')});
 }
 if(observations.size!==buyerScenarioCases.length||[...observations.values()].some(t=>t.status!=='passed'||t.branch!==branch||t.version!==version))throw Error('BUYER_SCENARIO_FAILURES_REQUIRE_FIX');
 await db('icash_integration_checks?provider=eq.'+provider,'PATCH',{checked_at:new Date().toISOString(),result:result('passed')});
 console.log('Buyer scenario audit passed:',buyerScenarioCases.length);
}catch(e){
 const code=/^[A-Z0-9_]{3,100}$/.test(e.message)?e.message:'BUYER_SCENARIO_UNCONFIRMED';
 await db('icash_integration_checks?provider=eq.'+provider,'PATCH',{checked_at:new Date().toISOString(),result:{...result('failed'),code}});
 throw Error(code);
}
