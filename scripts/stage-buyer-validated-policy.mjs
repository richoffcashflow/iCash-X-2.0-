import {db} from '../lib/stripe-test.ts';
import {buyerValidatedPolicy,buyerValidatedModel,buyerValidatedPrompt,buyerValidatedEntryInstructions,buyerOpeningGuardrail} from '../lib/buyer-validated-policy.ts';
import {validatedBuyerReceptionPolicyHash,answerBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {canonical} from '../lib/required-call-recording.ts';

export function buyerValidatedBranchOverrides(parent){
 const guards=structuredClone(parent.platform_settings.guardrails);
 if(guards.custom.config.configs.some(g=>g.name===buyerOpeningGuardrail.name))throw Error('BUYER_VALIDATED_NEW_GUARD_REQUIRED');
 guards.custom.config.configs.push(buyerOpeningGuardrail);
 return {conversation_config:{agent:{prompt:{...buyerValidatedModel,prompt:buyerValidatedPrompt+buyerValidatedEntryInstructions}}},platform_settings:{guardrails:guards}};
}
export async function stageBuyerValidatedPolicy(api,c){
 const marker='buyer_validated_stage_20261009_v1',name='buyer-validated-'+validatedBuyerReceptionPolicyHash.slice(0,16);
 const [prior]=await db('icash_integration_checks?provider=eq.'+marker+'&select=result');
 if(prior){if(prior.result?.status==='staged'&&prior.result.policyHash===validatedBuyerReceptionPolicyHash&&prior.result.sourceConfigId===c.id)return prior.result;throw Error('BUYER_VALIDATED_STAGE_REVIEW_REQUIRED');}
 const [audit]=await db('icash_integration_checks?provider=eq.buyer_scenario_audit_20261009_v7&select=result');
 if(audit?.result?.status!=='failed'||audit.result.code!=='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'||audit.result.fixtureHash!=='d122040ff176d09d208e77fafdc7c67f5c42024d0118ce5d76221feff1b988e0'||audit.result.tests?.length!==30||audit.result.tests.some(t=>!['passed','failed'].includes(t.status)))throw Error('BUYER_VALIDATED_COMPLETED_FAILURE_REQUIRED');
 const evidence=audit.result,path='/v1/convai/agents/'+c.agent_id;
 const [source,parent,list,workspace,stop,tool,main]=await Promise.all([api(path+'?branch_id='+c.branch_id),api(path+'?branch_id='+evidence.branchId),api(path+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api('/v1/convai/tools/'+c.agreement_tool_id),api(path)]);
 if(!Array.isArray(list.results)||list.results.length>=100||list.next_cursor||list.results.some(b=>b.name===name))throw Error('BUYER_VALIDATED_UNIQUE_BRANCH_REQUIRED');
 if(!inspectRecordedReceptionAgent(c,source,list.results.find(b=>b.id===c.branch_id),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_VALIDATED_SOURCE_CHANGED');
 const parentConfig={...c,context_policy:'automatic_offer_v16',context_policy_hash:answerBuyerReceptionPolicyHash,branch_id:evidence.branchId,reviewed_version_id:evidence.version,config_hash:evidence.configHash};
 if(!inspectRecordedReceptionAgent(parentConfig,parent,list.results.find(b=>b.id===evidence.branchId),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_VALIDATED_PARENT_CHANGED');
 const overrides=buyerValidatedBranchOverrides(parent);
 await db('icash_integration_checks','POST',{provider:marker,checked_at:new Date().toISOString(),result:{status:'creating',policyHash:validatedBuyerReceptionPolicyHash,sourceConfigId:c.id,outreach:false}});
 const created=await api(path+'/branches','POST',{name,parent_version_id:parent.version_id,description:'Isolated buyer candidate with complete-response opening validation and current-question checks.',include_draft:false,...overrides});
 const branchId=created.created_branch_id;
 if(!/^agtbrch_[A-Za-z0-9]+$/.test(branchId??'')||[c.branch_id,parent.branch_id,parent.main_branch_id].includes(branchId))throw Error('BUYER_VALIDATED_NEW_BRANCH_REQUIRED');
 const [agent,after,sourceAfter,parentAfter,mainAfter]=await Promise.all([api(path+'?branch_id='+branchId),api(path+'/branches?include_archived=true&limit=100'),api(path+'?branch_id='+c.branch_id),api(path+'?branch_id='+parent.branch_id),api(path)]);
 const stable=a=>JSON.stringify(canonical({main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null}));
 if(stable(source)!==stable(sourceAfter)||stable(parent)!==stable(parentAfter)||stable(main)!==stable(mainAfter))throw Error('BUYER_VALIDATED_EXISTING_BRANCH_MUTATED');
 if(!Array.isArray(after.results)||after.results.length>=100||after.next_cursor)throw Error('BUYER_VALIDATED_READBACK_REQUIRED');
 const candidate={...c,context_policy:buyerValidatedPolicy,context_policy_hash:validatedBuyerReceptionPolicyHash,branch_id:branchId,reviewed_version_id:agent.version_id,config_hash:''};
 const branch=after.results.find(b=>b.id===branchId),observed=inspectRecordedReceptionAgent(candidate,agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool);
 const model=Object.fromEntries(Object.keys(buyerValidatedModel).map(key=>[key,agent.conversation_config.agent.prompt[key]??null]));
 if(!inspectRecordedReceptionAgent({...candidate,config_hash:observed.hash},agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool).safe){
  const result={status:'review_required',policyHash:validatedBuyerReceptionPolicyHash,sourceConfigId:c.id,branchId,versionId:agent.version_id,configHash:observed.hash,model,checks:observed.checks,outreach:false,activated:false};
  await db('icash_integration_checks?provider=eq.'+marker,'PATCH',{checked_at:new Date().toISOString(),result});console.log('Buyer validated readback:',JSON.stringify(result));throw Error('BUYER_VALIDATED_PROVIDER_REVIEW_REQUIRED');
 }
 const configId=await db('rpc/icash_stage_buyer_validated_policy','POST',{p_source:c.id,p_branch:branchId,p_version:agent.version_id,p_hash:observed.hash});
 if(typeof configId!=='string')throw Error('BUYER_VALIDATED_STAGING_REQUIRED');
 const result={status:'staged',policyHash:validatedBuyerReceptionPolicyHash,sourceConfigId:c.id,configId,agentId:c.agent_id,branchId,versionId:agent.version_id,configHash:observed.hash,model,toolId:c.agreement_tool_id,outreach:false,activated:false};
 await db('icash_integration_checks?provider=eq.'+marker,'PATCH',{checked_at:new Date().toISOString(),result});return result;
}
