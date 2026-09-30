import {createHash} from 'node:crypto';
export type OwnerVoiceConfig={id:number;account_id:string;owner_user_id:string;phone:string;agent_id:string;phone_number_id:string;branch_id:string;branch_name:string;reviewed_config_hash:string|null;reviewed_version_id:string|null;enabled:boolean;expires_at:string};
export const ownerVoiceConfirmation='Call my configured phone once for a 60-second AI test';
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const empty=(v:unknown)=>v===undefined||v===null||(Array.isArray(v)&&v.length===0)||(typeof v==='object'&&!Array.isArray(v)&&Object.keys(object(v)).length===0);
function canonical(v:unknown):unknown{return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;}
/** Provider UI's unconnected Start scaffold cannot execute a workflow. Unknown
 * fields, any edge/subgraph, or any executable node remain rejected. */
export function ownerWorkflowIsInert(value:unknown){
 if(value===null||value===undefined)return true;
 if(typeof value!=='object'||Array.isArray(value))return false;
 const w=object(value),plainEmpty=(v:unknown)=>v===undefined||(v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===0);
 if(Object.keys(w).some(k=>!['nodes','edges','subgraphs','prevent_subagent_loops'].includes(k))||!plainEmpty(w.edges)||!plainEmpty(w.subgraphs)||(w.prevent_subagent_loops!==undefined&&typeof w.prevent_subagent_loops!=='boolean'))return false;
 if(plainEmpty(w.nodes))return true;
 if(!w.nodes||typeof w.nodes!=='object'||Array.isArray(w.nodes))return false;
 const nodes=object(w.nodes);if(Object.keys(nodes).length!==1||!Object.hasOwn(nodes,'start_node'))return false;
 const n=object(nodes.start_node),position=object(n.position);
 return Object.keys(n).every(k=>['type','position','edge_order','parent_subgraph_id'].includes(k))&&n.type==='start'&&n.parent_subgraph_id===null&&Array.isArray(n.edge_order)&&n.edge_order.length===0&&Object.keys(position).length===2&&typeof position.x==='number'&&Number.isFinite(position.x)&&typeof position.y==='number'&&Number.isFinite(position.y);
}
/** Mechanical preflight. A matching reviewed hash is still required before claim. */
export function inspectOwnerVoice(config:OwnerVoiceConfig,agentInput:unknown,branchInput:unknown,phoneInput:unknown,businessNumber:string|undefined){
 const a=object(agentInput),b=object(branchInput),phone=object(phoneInput),conversation=object(a.conversation_config),agent=object(conversation.agent),prompt=object(agent.prompt),platform=object(a.platform_settings),privacy=object(platform.privacy);
 const tools=prompt.tools;
 const safeBuiltins=empty(tools)||(Array.isArray(tools)&&tools.every(t=>{const x=object(t);return x.type==='system'&&x.name==='end_call';}));
 const noWorkflow=ownerWorkflowIsInert(a.workflow);
 const checks={
  agentIdentity:a.agent_id===config.agent_id,
  branchConfigIdentity:a.branch_id===config.branch_id,
  versionPresent:typeof a.version_id==='string'&&a.version_id.length>0,
  branchIdentity:b.id===config.branch_id&&b.agent_id===config.agent_id,
  branchName:b.name===config.branch_name,
  branchNotArchived:b.is_archived===false,
  branchHasNoLiveTraffic:b.current_live_percentage===0,
  durationExactly60:object(conversation.conversation).max_duration_seconds===60,
  authenticationEnabled:object(platform.auth).enable_auth===true,
  audioRecordingDisabled:privacy.record_voice===false,
  noExternalToolIds:empty(prompt.tool_ids),
  onlyEndCallBuiltin:safeBuiltins,
  noMcpServers:empty(prompt.mcp_server_ids),
  noKnowledgeBase:empty(prompt.knowledge_base),
  noProcedures:empty(a.procedures),
  noWorkflow:noWorkflow,
  phoneIdentity:phone.phone_number_id===config.phone_number_id,
  phoneProviderTwilio:phone.provider==='twilio',
  callerMatches:typeof businessNumber==='string'&&phone.phone_number===businessNumber,
 };
 const guarded=Object.values(checks).every(v=>v===true);
 const reviewed={conversation_config:conversation,auth:platform.auth,privacy:platform.privacy,overrides:platform.overrides,workspace_overrides:platform.workspace_overrides,workflow:a.workflow??null,procedures:a.procedures??null};
 const hash=createHash('sha256').update(JSON.stringify(canonical(reviewed))).digest('hex');
 return {guarded,checks,hash,version:typeof a.version_id==='string'?a.version_id:null,reviewed:guarded&&hash===config.reviewed_config_hash&&a.version_id===config.reviewed_version_id};
}
export function ownerVoiceBody(config:OwnerVoiceConfig){return {agent_id:config.agent_id,agent_phone_number_id:config.phone_number_id,to_number:config.phone,call_recording_enabled:false,telephony_call_config:{ringing_timeout_secs:20,twilio_call_recording_enabled:false},conversation_initiation_client_data:{branch_id:config.branch_id,user_id:'icash-owner-provider-acceptance',conversation_config_override:{conversation:{max_duration_seconds:60}}}};}
