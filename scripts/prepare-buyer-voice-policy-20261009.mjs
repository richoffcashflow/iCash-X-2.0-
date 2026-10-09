// One isolated inbound branch; no phone call, outreach, traffic or activation.
import {db} from '../lib/stripe-test.ts';
import {buyerVoicePolicy,buyerVoiceGuardrail} from '../lib/buyer-voice-policy.ts';
import {buyerCoordinationReceptionPrompt,buyerCoordinationReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {receptionTarget,receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
import {canonical,object} from '../lib/required-call-recording.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')process.exit(0);
const marker='buyer_voice_policy_stage_20261009_v1',name='buyer-coordination-'+buyerCoordinationReceptionPolicyHash.slice(0,16);
const [prior]=await db('icash_integration_checks?provider=eq.'+marker+'&select=result');
if(prior){if(prior.result?.status==='staged'&&prior.result.policyHash===buyerCoordinationReceptionPolicyHash)process.exit(0);throw Error('BUYER_VOICE_PRIOR_STAGE_REVIEW_REQUIRED');}
if(Date.now()>Date.parse('2026-10-10T00:00:00Z'))throw Error('BUYER_VOICE_STAGE_WINDOW_REQUIRED');
const api=async(path,method='GET',body)=>{
 const r=await fetch('https://api.us.elevenlabs.io'+path,{method,headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('BUYER_VOICE_PROVIDER_HTTP_'+r.status);
 return JSON.parse((await boundedBytes(r,1024*1024)).toString('utf8'));
};
const c=await db('rpc/icash_get_recorded_reception_config','POST',{p_called_number:receptionTarget.calledNumber});
if(c?.context_policy!=='automatic_offer_v9'||c.context_policy_hash!=='24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf'||c.agent_id!==receptionTarget.agentId)throw Error('BUYER_VOICE_SOURCE_REQUIRED');
const path='/v1/convai/agents/'+c.agent_id;
const [source,list,workspace,stop,tool,main]=await Promise.all([api(path+'?branch_id='+c.branch_id),api(path+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api('/v1/convai/tools/'+c.agreement_tool_id),api(path)]);
if(!Array.isArray(list.results)||list.results.length>=100||list.next_cursor||list.results.some(b=>b.name===name))throw Error('BUYER_VOICE_UNIQUE_BRANCH_REQUIRED');
if(!inspectRecordedReceptionAgent(c,source,list.results.find(b=>b.id===c.branch_id),receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_VOICE_SOURCE_CHANGED');
await db('icash_integration_checks','POST',{provider:marker,checked_at:new Date().toISOString(),result:{status:'creating',policyHash:buyerCoordinationReceptionPolicyHash,sourceConfigId:c.id,outreach:false}});
const guards=structuredClone(source.platform_settings.guardrails),configs=object(object(guards.custom).config).configs;
guards.custom.config.configs=configs.map(g=>g.name===buyerVoiceGuardrail.name?buyerVoiceGuardrail:g);
const created=await api(path+'/branches','POST',{name,parent_version_id:source.version_id,description:'Buyer-first role routing, title preferences and explicit authorized buyer deposit validation; isolated inbound candidate.',include_draft:false,
 conversation_config:{agent:{prompt:{prompt:buyerCoordinationReceptionPrompt+directRecordedInstructions}},turn:{turn_eagerness:'eager',turn_model:'turn_v3',spelling_patience:'auto',speculative_turn:false,soft_timeout_config:{timeout_seconds:3,message:'Thanks for waiting.',use_llm_generated_message:false,max_soft_timeouts_per_generation:1,disable_until_first_user_message:true}}},platform_settings:{guardrails:guards}});
const branchId=created.created_branch_id;if(!/^agtbrch_[A-Za-z0-9]+$/.test(branchId??'')||branchId===c.branch_id||branchId===source.main_branch_id)throw Error('BUYER_VOICE_NEW_BRANCH_REQUIRED');
const [agent,after,sourceAfter,mainAfter]=await Promise.all([api(path+'?branch_id='+branchId),api(path+'/branches?include_archived=true&limit=100'),api(path+'?branch_id='+c.branch_id),api(path)]);
const stable=a=>JSON.stringify(canonical({main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null}));
if(stable(source)!==stable(sourceAfter)||stable(main)!==stable(mainAfter))throw Error('BUYER_VOICE_SOURCE_MUTATED');
if(!Array.isArray(after.results)||after.results.length>=100||after.next_cursor)throw Error('BUYER_VOICE_BRANCH_READBACK_REQUIRED');
const branch=after.results.find(b=>b.id===branchId),candidate={...c,context_policy:buyerVoicePolicy,context_policy_hash:buyerCoordinationReceptionPolicyHash,branch_id:branchId,reviewed_version_id:agent.version_id,config_hash:''};
const observed=inspectRecordedReceptionAgent(candidate,agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool);
if(!inspectRecordedReceptionAgent({...candidate,config_hash:observed.hash},agent,branch,receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('BUYER_VOICE_REVIEW_REQUIRED');
const configId=await db('rpc/icash_stage_buyer_voice_policy','POST',{p_source:c.id,p_branch:branchId,p_version:agent.version_id,p_hash:observed.hash});
if(typeof configId!=='string')throw Error('BUYER_VOICE_STAGING_REQUIRED');
await db('icash_integration_checks?provider=eq.'+marker,'PATCH',{checked_at:new Date().toISOString(),result:{status:'staged',policyHash:buyerCoordinationReceptionPolicyHash,sourceConfigId:c.id,configId,agentId:c.agent_id,branchId,versionId:agent.version_id,configHash:observed.hash,toolId:c.agreement_tool_id,outreach:false,activated:false}});
console.log('Buyer voice policy staged with zero traffic.');
