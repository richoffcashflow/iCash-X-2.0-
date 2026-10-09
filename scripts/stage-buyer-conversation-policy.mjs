import {db} from '../lib/stripe-test.ts';
import {buyerConversationPolicy,buyerConversationModel,buyerConversationPrompt,buyerConversationGuardrail} from '../lib/buyer-conversation-policy.ts';
import {conversationBuyerReceptionPolicyHash,turnBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
import {canonical} from '../lib/required-call-recording.ts';

export async function stageBuyerConversationPolicy(api,c){
 const marker='buyer_conversation_stage_20261009_v2',name='buyer-conversation-'+conversationBuyerReceptionPolicyHash.slice(0,16);
 const [prior]=await db('icash_integration_checks?provider=eq.'+marker+'&select=result');
 if(prior){if(prior.result?.status==='staged'&&prior.result.policyHash===conversationBuyerReceptionPolicyHash&&prior.result.sourceConfigId===c.id)return prior.result;throw Error('BUYER_CONVERSATION_STAGE_REVIEW_REQUIRED');}
 // The original create returned HTTP 400 before recording a branch ID. Retain
 // that record and allow one separately recorded recovery only after proving
 // no branch with this exact name exists. Never retry a partial/readback failure.
 const [original]=await db('icash_integration_checks?provider=eq.buyer_conversation_stage_20261009_v1&select=result');
 if(original?.result?.status!=='creating'||original.result.policyHash!==conversationBuyerReceptionPolicyHash||original.result.sourceConfigId!==c.id||original.result.outreach!==false||original.result.branchId||original.result.configId)throw Error('BUYER_CONVERSATION_EXACT_CREATE_FAILURE_REQUIRED');
 const [audit]=await db('icash_integration_checks?provider=eq.buyer_scenario_audit_20261009_v5&select=result');
 if(audit?.result?.status!=='failed'||audit.result.code!=='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'||audit.result.fixtureHash!=='d1012080ea3ac92001d5467ed78c4c5e81f929131f2671b3e41ba30658a1b1ea'||audit.result.tests?.length!==30||audit.result.tests.some(t=>!['passed','failed'].includes(t.status)))throw Error('BUYER_CONVERSATION_COMPLETED_FAILURE_REQUIRED');
 const [diagnostic]=await db('icash_integration_checks?provider=eq.buyer_scenario_guardrail_inspection_20261009_v1&select=result');
 if(diagnostic?.result?.status!=='inspected'||diagnostic.result.fixtureHash!==audit.result.fixtureHash||diagnostic.result.count!==30)throw Error('BUYER_CONVERSATION_DIAGNOSTIC_REQUIRED');
 const evidence=audit.result,path='/v1/convai/agents/'+c.agent_id;
 const [source,parent,list,workspace,stop,tool,main]=await Promise.all([api(path+'?branch_id='+c.branch_id),api(path+'?branch_id='+evidence.branchId),api(path+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api('/v1/convai/tools/'+c.agreement_tool_id),api(path)]);
 if(!Array.isArray(list.results)||list.results.length>=100||list.next_cursor||list.results.some(b=>b.name===name))throw Error('BUYER_CONVERSATION_UNIQUE_BRANCH_REQUIRED');
 if(!inspectRecordedReceptionAgent(c,source,list.results.find(b=>b.id===c.branch_id),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_CONVERSATION_SOURCE_CHANGED');
 const parentConfig={...c,context_policy:'automatic_offer_v14',context_policy_hash:turnBuyerReceptionPolicyHash,branch_id:evidence.branchId,reviewed_version_id:evidence.version,config_hash:evidence.configHash};
 if(!inspectRecordedReceptionAgent(parentConfig,parent,list.results.find(b=>b.id===evidence.branchId),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_CONVERSATION_PARENT_CHANGED');
 const creating={status:'creating',policyHash:conversationBuyerReceptionPolicyHash,sourceConfigId:c.id,recoveryOf:'buyer_conversation_stage_20261009_v1',absentBranchName:name,outreach:false,activated:false};
 await db('icash_integration_checks','POST',{provider:marker,checked_at:new Date().toISOString(),result:creating});
 const guards=structuredClone(parent.platform_settings.guardrails);guards.custom.config.configs=guards.custom.config.configs.map(g=>g.name===buyerConversationGuardrail.name?buyerConversationGuardrail:g);
 let created;
 try{
  // Branch overrides merge with the GPT-5 parent. GPT-4.1 needs an explicit
  // null here so that a parent reasoning_effort cannot survive that merge.
  created=await api(path+'/branches','POST',{name,parent_version_id:parent.version_id,description:'Isolated buyer conversation candidate: persistent state, private pricing and truthful action status.',include_draft:false,conversation_config:{agent:{prompt:{...buyerConversationModel,reasoning_effort:null,prompt:buyerConversationPrompt+directRecordedInstructions}}},platform_settings:{guardrails:guards}});
 }catch(error){
  const code=/^BUYER_SCENARIO_HTTP_\d{3}$/.test(error.message)?error.message:'BUYER_CONVERSATION_CREATE_UNCONFIRMED';
  await db('icash_integration_checks?provider=eq.'+marker,'PATCH',{checked_at:new Date().toISOString(),result:{...creating,status:'create_failed',code,validation:error.providerValidation??null}});
  throw error;
 }
 const branchId=created.created_branch_id;
 if(!/^agtbrch_[A-Za-z0-9]+$/.test(branchId??'')||[c.branch_id,parent.branch_id,parent.main_branch_id].includes(branchId))throw Error('BUYER_CONVERSATION_NEW_BRANCH_REQUIRED');
 const [agent,after,sourceAfter,parentAfter,mainAfter]=await Promise.all([api(path+'?branch_id='+branchId),api(path+'/branches?include_archived=true&limit=100'),api(path+'?branch_id='+c.branch_id),api(path+'?branch_id='+parent.branch_id),api(path)]);
 const stable=a=>JSON.stringify(canonical({main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null}));
 if(stable(source)!==stable(sourceAfter)||stable(parent)!==stable(parentAfter)||stable(main)!==stable(mainAfter))throw Error('BUYER_CONVERSATION_EXISTING_BRANCH_MUTATED');
 if(!Array.isArray(after.results)||after.results.length>=100||after.next_cursor)throw Error('BUYER_CONVERSATION_READBACK_REQUIRED');
 const candidate={...c,context_policy:buyerConversationPolicy,context_policy_hash:conversationBuyerReceptionPolicyHash,branch_id:branchId,reviewed_version_id:agent.version_id,config_hash:''};
 const branch=after.results.find(b=>b.id===branchId),observed=inspectRecordedReceptionAgent(candidate,agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool);
 const model=Object.fromEntries(Object.keys(buyerConversationModel).map(key=>[key,agent.conversation_config.agent.prompt[key]??null]));
 if(!inspectRecordedReceptionAgent({...candidate,config_hash:observed.hash},agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool).safe){
  const result={status:'review_required',policyHash:conversationBuyerReceptionPolicyHash,sourceConfigId:c.id,branchId,versionId:agent.version_id,configHash:observed.hash,model,checks:observed.checks,outreach:false,activated:false};
  await db('icash_integration_checks?provider=eq.'+marker,'PATCH',{checked_at:new Date().toISOString(),result});console.log('Buyer turn readback:',JSON.stringify(result));throw Error('BUYER_CONVERSATION_PROVIDER_REVIEW_REQUIRED');
 }
 const configId=await db('rpc/icash_stage_buyer_conversation_policy','POST',{p_source:c.id,p_branch:branchId,p_version:agent.version_id,p_hash:observed.hash});
 if(typeof configId!=='string')throw Error('BUYER_CONVERSATION_STAGING_REQUIRED');
 const result={status:'staged',policyHash:conversationBuyerReceptionPolicyHash,sourceConfigId:c.id,configId,agentId:c.agent_id,branchId,versionId:agent.version_id,configHash:observed.hash,model,toolId:c.agreement_tool_id,outreach:false,activated:false};
 await db('icash_integration_checks?provider=eq.'+marker,'PATCH',{checked_at:new Date().toISOString(),result});return result;
}
