import {db} from '../lib/stripe-test.ts';
import {buyerResponsePolicy,buyerResponseModel} from '../lib/buyer-response-policy.ts';
import {responseBuyerReceptionPolicyHash,isolatedBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {canonical} from '../lib/required-call-recording.ts';

// A provider branch with zero traffic. Existing agent branches, phone mappings,
// tools and enabled database configurations are never edited here.
export async function stageBuyerResponsePolicy(api,sourceConfig){
 const marker='buyer_response_stage_20261009_v1',name='buyer-response-'+responseBuyerReceptionPolicyHash.slice(0,16);
 const [prior]=await db('icash_integration_checks?provider=eq.'+marker+'&select=result');
 if(prior){
  if(prior.result?.status==='staged'&&prior.result.policyHash===responseBuyerReceptionPolicyHash&&prior.result.sourceConfigId===sourceConfig.id)return prior.result;
  if(prior.result?.status==='creating'&&prior.result.policyHash===responseBuyerReceptionPolicyHash&&prior.result.sourceConfigId===sourceConfig.id){
   // Read-only diagnosis of the already-created candidate. Do not retry branch
   // creation, relax inspection, stage a config or start any simulations.
   const diagnostic='buyer_response_stage_inspection_20261009_v1';
   if((await db('icash_integration_checks?provider=eq.'+diagnostic+'&select=provider')).length)throw Error('BUYER_RESPONSE_INSPECTION_REVIEW_REQUIRED');
   const path='/v1/convai/agents/'+sourceConfig.agent_id;
   const [list,workspace,stop,tool]=await Promise.all([api(path+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+sourceConfig.stop_tool_id),api('/v1/convai/tools/'+sourceConfig.agreement_tool_id)]);
   if(!Array.isArray(list.results)||list.results.length>=100||list.next_cursor||list.results.filter(b=>b.name===name).length!==1)throw Error('BUYER_RESPONSE_INSPECTION_BRANCH_REQUIRED');
   const branch=list.results.find(b=>b.name===name),agent=await api(path+'?branch_id='+branch.id);
   const c={...sourceConfig,context_policy:buyerResponsePolicy,context_policy_hash:responseBuyerReceptionPolicyHash,branch_id:branch.id,reviewed_version_id:agent.version_id,config_hash:''};
   const observed=inspectRecordedReceptionAgent(c,agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool);
   const prompt=agent.conversation_config?.agent?.prompt??{};
   const model=Object.fromEntries(Object.keys(buyerResponseModel).map(key=>[key,prompt[key]??null]));
   const result={status:'review_required',branchId:branch.id,versionId:agent.version_id,configHash:observed.hash,policyHash:responseBuyerReceptionPolicyHash,checks:observed.checks,model,expectedModel:buyerResponseModel,outreach:false,activated:false};
   await db('icash_integration_checks','POST',{provider:diagnostic,checked_at:new Date().toISOString(),result});
   console.log('Buyer candidate readback:',JSON.stringify(result));
   throw Error('BUYER_RESPONSE_INSPECTION_REVIEW_REQUIRED');
  }
  throw Error('BUYER_RESPONSE_STAGE_REVIEW_REQUIRED');
 }
 const c=sourceConfig;
 if(c.context_policy!=='automatic_offer_v11'||c.context_policy_hash!==isolatedBuyerReceptionPolicyHash)throw Error('BUYER_RESPONSE_SOURCE_REQUIRED');
 const path='/v1/convai/agents/'+c.agent_id;
 const [source,list,workspace,stop,tool,main]=await Promise.all([api(path+'?branch_id='+c.branch_id),api(path+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api('/v1/convai/tools/'+c.agreement_tool_id),api(path)]);
 if(!Array.isArray(list.results)||list.results.length>=100||list.next_cursor||list.results.some(b=>b.name===name))throw Error('BUYER_RESPONSE_UNIQUE_BRANCH_REQUIRED');
 if(!inspectRecordedReceptionAgent(c,source,list.results.find(b=>b.id===c.branch_id),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_RESPONSE_SOURCE_CHANGED');
 await db('icash_integration_checks','POST',{provider:marker,checked_at:new Date().toISOString(),result:{status:'creating',policyHash:responseBuyerReceptionPolicyHash,sourceConfigId:c.id,outreach:false}});
 const created=await api(path+'/branches','POST',{name,parent_version_id:source.version_id,description:'Isolated buyer scenario correction: exact first tool action, direct answers, private pricing, GPT-4.1 and no default personality.',include_draft:false,conversation_config:{agent:{prompt:{...buyerResponseModel}}}});
 const branchId=created.created_branch_id;
 if(!/^agtbrch_[A-Za-z0-9]+$/.test(branchId??'')||branchId===c.branch_id||branchId===source.main_branch_id)throw Error('BUYER_RESPONSE_NEW_BRANCH_REQUIRED');
 const [agent,after,sourceAfter,mainAfter]=await Promise.all([api(path+'?branch_id='+branchId),api(path+'/branches?include_archived=true&limit=100'),api(path+'?branch_id='+c.branch_id),api(path)]);
 const stable=a=>JSON.stringify(canonical({main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null}));
 if(stable(source)!==stable(sourceAfter)||stable(main)!==stable(mainAfter))throw Error('BUYER_RESPONSE_SOURCE_MUTATED');
 if(!Array.isArray(after.results)||after.results.length>=100||after.next_cursor)throw Error('BUYER_RESPONSE_BRANCH_READBACK_REQUIRED');
 const branch=after.results.find(b=>b.id===branchId),candidate={...c,context_policy:buyerResponsePolicy,context_policy_hash:responseBuyerReceptionPolicyHash,branch_id:branchId,reviewed_version_id:agent.version_id,config_hash:''};
 const observed=inspectRecordedReceptionAgent(candidate,agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool);
 if(!inspectRecordedReceptionAgent({...candidate,config_hash:observed.hash},agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool).safe){console.log('Buyer candidate checks:',JSON.stringify(observed.checks));throw Error('BUYER_RESPONSE_PROVIDER_REVIEW_REQUIRED');}
 const configId=await db('rpc/icash_stage_buyer_response_policy','POST',{p_source:c.id,p_branch:branchId,p_version:agent.version_id,p_hash:observed.hash});
 if(typeof configId!=='string')throw Error('BUYER_RESPONSE_STAGING_REQUIRED');
 const result={status:'staged',policyHash:responseBuyerReceptionPolicyHash,sourceConfigId:c.id,configId,agentId:c.agent_id,branchId,versionId:agent.version_id,configHash:observed.hash,model:buyerResponseModel,sourceModel:source.conversation_config.agent.prompt.llm,sourceDefaultPersonalityDisabled:source.conversation_config.agent.prompt.ignore_default_personality===true,toolId:c.agreement_tool_id,outreach:false,activated:false};
 await db('icash_integration_checks?provider=eq.'+marker,'PATCH',{checked_at:new Date().toISOString(),result});
 return result;
}
