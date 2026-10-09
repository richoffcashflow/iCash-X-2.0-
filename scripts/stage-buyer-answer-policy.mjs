import {db} from '../lib/stripe-test.ts';
import {buyerAnswerPolicy,buyerAnswerModel,buyerAnswerPrompt,buyerAnswerEntryInstructions} from '../lib/buyer-answer-policy.ts';
import {answerBuyerReceptionPolicyHash,conversationBuyerReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {buyerConversationInstructions} from '../lib/buyer-conversation-policy.ts';
import {canonical} from '../lib/required-call-recording.ts';

export async function stageBuyerAnswerPolicy(api,c){
 const marker='buyer_answer_stage_20261009_v1',name='buyer-answer-'+answerBuyerReceptionPolicyHash.slice(0,16);
 const [prior]=await db('icash_integration_checks?provider=eq.'+marker+'&select=result');
 if(prior){if(prior.result?.status==='staged'&&prior.result.policyHash===answerBuyerReceptionPolicyHash&&prior.result.sourceConfigId===c.id)return prior.result;throw Error('BUYER_ANSWER_STAGE_REVIEW_REQUIRED');}
 const [audit]=await db('icash_integration_checks?provider=eq.buyer_scenario_audit_20261009_v6&select=result');
 if(audit?.result?.status!=='failed'||audit.result.code!=='BUYER_SCENARIO_FAILURES_REQUIRE_FIX'||audit.result.fixtureHash!=='6bb2dfa557991735758ecf0ac5df39c77b9012bbcdaeafab3ea8508d91d67237'||audit.result.tests?.length!==30||audit.result.tests.some(t=>!['passed','failed'].includes(t.status)))throw Error('BUYER_ANSWER_COMPLETED_FAILURE_REQUIRED');
 const evidence=audit.result,path='/v1/convai/agents/'+c.agent_id;
 const [source,parent,list,workspace,stop,tool,main]=await Promise.all([api(path+'?branch_id='+c.branch_id),api(path+'?branch_id='+evidence.branchId),api(path+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api('/v1/convai/tools/'+c.agreement_tool_id),api(path)]);
 if(!Array.isArray(list.results)||list.results.length>=100||list.next_cursor||list.results.some(b=>b.name===name))throw Error('BUYER_ANSWER_UNIQUE_BRANCH_REQUIRED');
 if(!inspectRecordedReceptionAgent(c,source,list.results.find(b=>b.id===c.branch_id),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_ANSWER_SOURCE_CHANGED');
 const parentConfig={...c,context_policy:'automatic_offer_v15',context_policy_hash:conversationBuyerReceptionPolicyHash,branch_id:evidence.branchId,reviewed_version_id:evidence.version,config_hash:evidence.configHash};
 if(!inspectRecordedReceptionAgent(parentConfig,parent,list.results.find(b=>b.id===evidence.branchId),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_ANSWER_PARENT_CHANGED');
 const tests=await api('/v1/convai/agent-testing?page_size=100&search=buyer-scenarios-20261009-v6-');
 const target='buyer-scenarios-20261009-v6-available-viewing-'+c.agreement_tool_id.slice(-8);
 if(!Array.isArray(tests.tests)||tests.has_more||tests.tests.filter(t=>t.name===target).length!==1)throw Error('BUYER_ANSWER_PRIOR_TEST_REQUIRED');
 const stored=await api('/v1/convai/agent-testing/'+tests.tests.find(t=>t.name===target).id);
 if(stored.type!=='simulation'||stored.dynamic_variables?.icash_role_instructions!==buyerConversationInstructions)throw Error('BUYER_ANSWER_PRIOR_ROLE_INPUT_REQUIRED');
 await db('icash_integration_checks','POST',{provider:marker,checked_at:new Date().toISOString(),result:{status:'creating',policyHash:answerBuyerReceptionPolicyHash,sourceConfigId:c.id,outreach:false,priorRoleInputVerified:true}});
 const created=await api(path+'/branches','POST',{name,parent_version_id:parent.version_id,description:'Isolated buyer candidate with static role-gated policy, explicit opening disclosure and concise follow-up answers.',include_draft:false,conversation_config:{agent:{prompt:{...buyerAnswerModel,prompt:buyerAnswerPrompt+buyerAnswerEntryInstructions}}}});
 const branchId=created.created_branch_id;
 if(!/^agtbrch_[A-Za-z0-9]+$/.test(branchId??'')||[c.branch_id,parent.branch_id,parent.main_branch_id].includes(branchId))throw Error('BUYER_ANSWER_NEW_BRANCH_REQUIRED');
 const [agent,after,sourceAfter,parentAfter,mainAfter]=await Promise.all([api(path+'?branch_id='+branchId),api(path+'/branches?include_archived=true&limit=100'),api(path+'?branch_id='+c.branch_id),api(path+'?branch_id='+parent.branch_id),api(path)]);
 const stable=a=>JSON.stringify(canonical({main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null}));
 if(stable(source)!==stable(sourceAfter)||stable(parent)!==stable(parentAfter)||stable(main)!==stable(mainAfter))throw Error('BUYER_ANSWER_EXISTING_BRANCH_MUTATED');
 if(!Array.isArray(after.results)||after.results.length>=100||after.next_cursor)throw Error('BUYER_ANSWER_READBACK_REQUIRED');
 const candidate={...c,context_policy:buyerAnswerPolicy,context_policy_hash:answerBuyerReceptionPolicyHash,branch_id:branchId,reviewed_version_id:agent.version_id,config_hash:''};
 const branch=after.results.find(b=>b.id===branchId),observed=inspectRecordedReceptionAgent(candidate,agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool);
 const model=Object.fromEntries(Object.keys(buyerAnswerModel).map(key=>[key,agent.conversation_config.agent.prompt[key]??null]));
 if(!inspectRecordedReceptionAgent({...candidate,config_hash:observed.hash},agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool).safe){
  const result={status:'review_required',policyHash:answerBuyerReceptionPolicyHash,sourceConfigId:c.id,branchId,versionId:agent.version_id,configHash:observed.hash,model,checks:observed.checks,outreach:false,activated:false,priorRoleInputVerified:true};
  await db('icash_integration_checks?provider=eq.'+marker,'PATCH',{checked_at:new Date().toISOString(),result});console.log('Buyer answer readback:',JSON.stringify(result));throw Error('BUYER_ANSWER_PROVIDER_REVIEW_REQUIRED');
 }
 const configId=await db('rpc/icash_stage_buyer_answer_policy','POST',{p_source:c.id,p_branch:branchId,p_version:agent.version_id,p_hash:observed.hash});
 if(typeof configId!=='string')throw Error('BUYER_ANSWER_STAGING_REQUIRED');
 const result={status:'staged',policyHash:answerBuyerReceptionPolicyHash,sourceConfigId:c.id,configId,agentId:c.agent_id,branchId,versionId:agent.version_id,configHash:observed.hash,model,toolId:c.agreement_tool_id,outreach:false,activated:false,priorRoleInputVerified:true};
 await db('icash_integration_checks?provider=eq.'+marker,'PATCH',{checked_at:new Date().toISOString(),result});return result;
}
