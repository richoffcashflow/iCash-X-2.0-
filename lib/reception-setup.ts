import {propertyReceptionEnabled,propertyReceptionGreeting,propertyReceptionPrompt} from './reception-property-context.ts';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {ownerInboundTarget} from './owner-inbound-acceptance.ts';
import {boundedBody,inspectReceptionAgent,receptionGreeting,receptionPrompt,receptionTarget,receptionUrl,resolveReceptionProfile,receptionSharedCapacityChecks,receptionWorkspacePostcallAbsent,type ReceptionConfig} from './general-reception.ts';

// Fixed owner-only deployment preparation. No credentials, calls, generic proxy,
// branch promotion, account activation or budget approval can be created here.
// Provider schemas checked 2026-10-02:
// https://elevenlabs.io/docs/api-reference/agents/branches/create
// https://elevenlabs.io/docs/api-reference/agents/update
// https://elevenlabs.io/docs/api-reference/webhooks/list
// https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource
const origin='https://api.us.elevenlabs.io',agentPath=`/v1/convai/agents/${receptionTarget.agentId}`;
const ownerBranch='agtbrch_8901m3sw5tn6fvkae4d334netswh';
export const receptionBranchName='iCash X general reception v1';
const fallbackUrl='https://www.geticashx.com/api/reception/fallback',postcallUrl='https://www.geticashx.com/api/reception/postcall';
type Obj=Record<string,unknown>;
export type SetupAction='prepare_branch'|'prepare_branch_retry'|'prepare_branch_retry_2'|'prepare_branch_retry_3'|'configure_branch'|'route'|'restore';
export type ReceptionSetupEnv={ELEVENLABS_API_KEY?:string;ELEVENLABS_INBOUND_WEBHOOK_SECRET?:string;RECEPTION_POSTCALL_SECRET?:string;ELEVENLABS_WEBHOOK_SECRET?:string;TWILIO_ACCOUNT_SID?:string;TWILIO_AUTH_TOKEN?:string;RECEPTION_ENABLED?:string};
export type ReceptionSetupDeps={fetcher?:typeof fetch;rpc:(name:string,body?:Obj)=>Promise<unknown>;now?:()=>number};
export type ReceptionSetupReview={status:'review'|'blocked'|'verified'|'outcome_unknown';message:string;blockers:string[];checks:Record<string,boolean>;actions:{action:SetupAction;reviewToken:string;expiresAt:string}[];branch?:{id:string;version:string;configHash:string};preCreateEvidence?:{action:SetupAction;fingerprint:string};branchChecks?:Record<string,boolean>;branchPolicyShape?:Record<string,string|number|boolean|string[]>;profile?:{name:string;maxDurationSeconds:number;customerChargeCapCents:number};providerFailure?:{status:number|null;validationPaths:string[]};checkedAt:string};
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const id=(v:unknown,prefix:string):v is string=>typeof v==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9]{1,160}$`).test(v);
const empty=(v:unknown)=>v==null||(Array.isArray(v)?v.length===0:typeof v==='object'&&Object.keys(obj(v)).length===0);
const goodSecret=(v:unknown):v is string=>typeof v==='string'&&v.length>=20&&v.length<=4096&&/^[\x21-\x7e]+$/.test(v);
function canonical(v:unknown):string{return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(obj(v)[k])).join(',')+'}':JSON.stringify(v)??'null';}
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function stable(v:Obj){const result={...v};for(const k of ['metadata','access_info','default_hold_audio_url','date_updated','calls_7d','commits_ahead','commits_behind'])delete result[k];return result;}
function fail(code:string):never{throw Error(code);}
const errors=new Set(['configuration_unavailable','database_unavailable','provider_unavailable','provider_receipt_invalid','provider_access_denied','configuration_changed','invalid_review','review_expired','action_not_ready','attempt_already_claimed','verification_failed','profile_configuration_invalid']);
const reason=(e:unknown)=>e instanceof Error&&errors.has(e.message)?e.message:'provider_unavailable';
function result(deps:ReceptionSetupDeps,status:ReceptionSetupReview['status'],message:string,extra:Partial<ReceptionSetupReview>={}):ReceptionSetupReview{return {status,message,blockers:[],checks:{},actions:[],checkedAt:new Date(deps.now?.()??Date.now()).toISOString(),...extra};}
function signing(env:ReceptionSetupEnv){if(typeof window!=='undefined'||!goodSecret(env.ELEVENLABS_INBOUND_WEBHOOK_SECRET))fail('configuration_unavailable');return env.ELEVENLABS_INBOUND_WEBHOOK_SECRET;}
// Provider error payloads are untrusted and can echo credentials, prompts or
// customer input. Only known structural field names and bounded array indexes
// may leave this module. Never expose msg, input, ctx, URL, or the response body.
const validationFields=new Set(['body','parent_version_id','name','description','include_draft','conversation_config','asr','user_input_audio_format','tts','voice_id','model_id','agent_output_audio_format','agent','first_message','language','max_conversation_duration_message','prompt','llm','max_tokens','tools','tool_ids','built_in_tools','transfer_to_agent','end_call','language_detection','transfer_to_number','skip_turn','play_keypad_touch_tone','voicemail_detection','params','system_tool_type','type','mcp_server_ids','native_mcp_server_ids','knowledge_base','rag','enabled','custom_llm','conversation','max_duration_seconds','language_presets','platform_settings','overrides','enable_conversation_initiation_client_data_from_webhook','enable_procedure_ids_from_client','enable_starting_workflow_node_id_from_client','conversation_config_override','workspace_overrides','conversation_initiation_client_data_webhook','webhooks','post_call_webhook_id','events','transcript_format','send_audio','data_collection','evaluation','criteria','workflow','nodes','start_node','type','position','x','y','edge_order','parent_subgraph_id','edges','subgraphs','prevent_subagent_loops']);
function validationPaths(value:unknown){
 const detail=obj(value).detail;if(!Array.isArray(detail)||detail.length>32)return [];
 const paths:string[]=[];
 for(const entry of detail){const loc=obj(entry).loc;if(!Array.isArray(loc)||!loc.length||loc.length>16||loc[0]!=='body')continue;
  if(!loc.every(part=>typeof part==='string'?validationFields.has(part):typeof part==='number'&&Number.isSafeInteger(part)&&part>=0&&part<=999))continue;
  const path=loc.join('.');if(path.length<=512&&!paths.includes(path))paths.push(path);
 }
 return paths.slice(0,16);
}
class ProviderFailure extends Error{status:number|null;validationPaths:string[];constructor(code:string,status:number|null,paths:string[]=[]){super(code);this.status=status;this.validationPaths=paths;}}
function providerFailure(e:unknown):Pick<ReceptionSetupReview,'providerFailure'>{return e instanceof ProviderFailure?{providerFailure:{status:e.status,validationPaths:e.validationPaths}}:{};}
function providers(env:ReceptionSetupEnv,deps:ReceptionSetupDeps){
 const fetcher=deps.fetcher??fetch;
 async function request(url:string,headers:Record<string,string>,method='GET',body?:string){
  let r:Response;try{r=await fetcher(url,{method,headers,body,cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000)});}catch{throw new ProviderFailure('provider_unavailable',null);}
  if(!r.ok||r.redirected||(r.url&&r.url!==url)){
   const status=Number.isSafeInteger(r.status)&&r.status>=100&&r.status<=599?r.status:null;let paths:string[]=[];
   if(status===422&&url.startsWith(origin+agentPath)&&/^application\/json(?:;|$)/i.test(r.headers.get('content-type')??''))try{paths=validationPaths(JSON.parse(await boundedBody(r,32768)));}catch{/* Keep only the verified HTTP status. */}
   else try{await r.body?.cancel();}catch{/* No provider content is retained. */}
   throw new ProviderFailure(status===401||status===403?'provider_access_denied':'provider_unavailable',status,paths);
  }
  if(!/^application\/json(?:;|$)/i.test(r!.headers.get('content-type')??''))fail('provider_receipt_invalid');
  try{const parsed=JSON.parse(await boundedBody(r!,1024*1024));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('provider_receipt_invalid');return parsed as Obj;}catch{fail('provider_receipt_invalid');}
 }
 return {
  eleven:(path:string,method='GET',body?:Obj)=>{if(!goodSecret(env.ELEVENLABS_API_KEY))fail('configuration_unavailable');return request(origin+path,{'xi-api-key':env.ELEVENLABS_API_KEY,Accept:'application/json','Content-Type':'application/json'},method,body?JSON.stringify(body):undefined);},
  twilio:(suffix:string,method='GET',body?:URLSearchParams)=>{if(!/^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID??'')||!goodSecret(env.TWILIO_AUTH_TOKEN))fail('configuration_unavailable');return request(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers${suffix}`,{Authorization:'Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64'),Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},method,body?.toString());},
 };
}
const routeKeys=['voice_url','voice_method','voice_fallback_url','voice_fallback_method'] as const;
function routing(phone:Obj){return Object.fromEntries(routeKeys.map(k=>[k,phone[k]??null]));}
const desiredRouting={voice_url:receptionUrl,voice_method:'POST',voice_fallback_url:fallbackUrl,voice_fallback_method:'POST'};
function phoneStable(phone:Obj){return stable(phone);}
function phoneOther(phone:Obj){const p=phoneStable(phone);for(const k of routeKeys)delete p[k];return p;}
async function readPhone(api:ReturnType<typeof providers>,env:ReceptionSetupEnv){
 const list=await api.twilio(`.json?PhoneNumber=${encodeURIComponent(receptionTarget.calledNumber)}&PageSize=2`),rows=list.incoming_phone_numbers;
 if(!Array.isArray(rows)||rows.length!==1||list.next_page_uri!==null)fail('provider_receipt_invalid');
 const phone=obj(rows[0]);
 if(phone.phone_number!==receptionTarget.calledNumber||phone.account_sid!==env.TWILIO_ACCOUNT_SID||typeof phone.sid!=='string'||!/^PN[0-9a-fA-F]{32}$/.test(phone.sid)||obj(phone.capabilities).voice!==true||!['POST','GET'].includes(String(phone.voice_method))||!['POST','GET'].includes(String(phone.voice_fallback_method)))fail('provider_receipt_invalid');
 for(const key of ['voice_url','voice_fallback_url'])if(phone[key]!==null&&typeof phone[key]!=='string')fail('provider_receipt_invalid');
 return phoneStable(phone);
}
function profile(config:Obj){return resolveReceptionProfile(config)??fail('profile_configuration_invalid');}
function localConfig(agent:Obj,config:Obj):ReceptionConfig{const selected=profile(config);return {...config,account_id:receptionTarget.accountId,owner_user_id:receptionTarget.ownerUserId,called_number:receptionTarget.calledNumber,enabled:false,agent_id:receptionTarget.agentId,branch_id:String(agent.branch_id),reviewed_version_id:String(agent.version_id),config_hash:'',max_duration_seconds:selected.maxDurationSeconds};}
function safeBranch(agent:Obj,branch:Obj,config:Obj,workspacePostcallAbsent:boolean){const c=localConfig(agent,config),check=inspectReceptionAgent(c,agent,branch,workspacePostcallAbsent);c.config_hash=check.hash;const reviewed=inspectReceptionAgent(c,agent,branch,workspacePostcallAbsent);return {c,safe:reviewed.safe,checks:reviewed.checks};}
// Read-only structural diagnostics. Values, arbitrary map keys, prompts, tool
// arguments, URLs, names, IDs and credentials never enter this response.
function branchPolicyShape(agent:Obj):NonNullable<ReceptionSetupReview['branchPolicyShape']>{
 const shape:NonNullable<ReceptionSetupReview['branchPolicyShape']>={};
 const type=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v;
 const record=(name:string,v:unknown)=>{shape[name+'Type']=type(v);if(Array.isArray(v))shape[name+'Count']=Math.min(v.length,1000);else if(v!==null&&typeof v==='object')shape[name+'Count']=Math.min(Object.keys(v).length,1000);};
 const keys=(name:string,v:unknown,known:string[])=>{const actual=Object.keys(obj(v));shape[name+'KnownKeys']=actual.filter(k=>known.includes(k)).sort();shape[name+'UnknownKeyCount']=Math.min(actual.filter(k=>!known.includes(k)).length,1000);};
 const conversation=obj(agent.conversation_config),a=obj(conversation.agent),prompt=obj(a.prompt),platform=obj(agent.platform_settings),workflow=obj(agent.workflow),nodes=obj(workflow.nodes),start=obj(nodes.start_node),position=obj(start.position),builtins=obj(prompt.built_in_tools),end=obj(builtins.end_call),webhooks=obj(obj(platform.workspace_overrides).webhooks);
 for(const [name,value] of Object.entries({workflow:agent.workflow,workflowNodes:workflow.nodes,workflowEdges:workflow.edges,workflowSubgraphs:workflow.subgraphs,startNode:nodes.start_node,startPosition:start.position,startEdgeOrder:start.edge_order,startParent:start.parent_subgraph_id,tools:prompt.tools,toolIds:prompt.tool_ids,builtInTools:prompt.built_in_tools,endCall:builtins.end_call,endCallParams:end.params,mcpServerIds:prompt.mcp_server_ids,nativeMcpServerIds:prompt.native_mcp_server_ids,knowledgeBase:prompt.knowledge_base,customLlm:prompt.custom_llm,procedures:agent.procedures,languagePresets:conversation.language_presets,dataCollection:platform.data_collection,evaluationCriteria:obj(platform.evaluation).criteria,postcallEvents:webhooks.events,postcallHookId:webhooks.post_call_webhook_id,duration:obj(conversation.conversation).max_duration_seconds,durationMessage:a.max_conversation_duration_message,maxTokens:prompt.max_tokens}))record(name,value);
 keys('workflow',workflow,['nodes','edges','subgraphs','prevent_subagent_loops']);keys('startNode',start,['type','position','edge_order','parent_subgraph_id']);keys('startPosition',position,['x','y']);
 keys('builtInTools',builtins,['end_call','transfer_to_agent','language_detection','transfer_to_number','skip_turn','play_keypad_touch_tone','voicemail_detection']);keys('endCall',end,['type','name','description','params','response_timeout_secs','disable_interruptions','interruption_mode','force_pre_tool_speech','assignments','tool_call_sound','tool_call_sound_behavior','execution_mode']);keys('endCallParams',end.params,['system_tool_type']);
 shape.workflowHasCanonicalStart=Object.hasOwn(nodes,'start_node');shape.startTypeIsStart=start.type==='start';shape.startParentIsNull=start.parent_subgraph_id===null;shape.startParentIsAbsent=!Object.hasOwn(start,'parent_subgraph_id');shape.startPositionXFinite=typeof position.x==='number'&&Number.isFinite(position.x);shape.startPositionYFinite=typeof position.y==='number'&&Number.isFinite(position.y);shape.preventSubagentLoopsType=type(workflow.prevent_subagent_loops);shape.nonNullBuiltInToolCount=Math.min(Object.values(builtins).filter(v=>v!==null&&v!==undefined).length,1000);shape.endCallTypeIsSystem=end.type==='system';shape.endCallNameIsEndCall=end.name==='end_call';shape.endCallParamsTypeIsEndCall=obj(end.params).system_tool_type==='end_call';
 const builtinNames=['end_call','transfer_to_agent','language_detection','transfer_to_number','skip_turn','play_keypad_touch_tone','voicemail_detection'];shape.enabledKnownBuiltInTools=builtinNames.filter(k=>builtins[k]!==null&&builtins[k]!==undefined);shape.enabledUnknownBuiltInToolCount=Math.min(Object.entries(builtins).filter(([k,v])=>!builtinNames.includes(k)&&v!==null&&v!==undefined).length,1000);
 const maxDuration=obj(conversation.conversation).max_duration_seconds,maxTokens=prompt.max_tokens;shape.durationIs60=maxDuration===60;shape.durationIs600=maxDuration===600;shape.maxTokensIs120=maxTokens===120;if(typeof a.max_conversation_duration_message==='string')shape.durationMessageLength=Math.min(a.max_conversation_duration_message.length,100000);
 if(Array.isArray(prompt.tools))shape.inlineEndCallCount=Math.min(prompt.tools.filter(v=>obj(v).type==='system'&&obj(v).name==='end_call'&&obj(obj(v).params).system_tool_type==='end_call').length,1000);
 const overrides=obj(platform.overrides);for(const [name,value] of Object.entries({enableInitiationWebhook:overrides.enable_conversation_initiation_client_data_from_webhook,enableProcedureIds:overrides.enable_procedure_ids_from_client,enableStartingWorkflowNode:overrides.enable_starting_workflow_node_id_from_client,enableDurationOverride:obj(obj(overrides.conversation_config_override).conversation).max_duration_seconds,preventSubagentLoops:workflow.prevent_subagent_loops,postcallSendAudio:webhooks.send_audio})){shape[name+'Type']=type(value);if(typeof value==='boolean')shape[name]=value;}
 return shape;
}
function sharedSettingsChecks(main:Obj){const p=obj(main.platform_settings);return {sharedAuthenticationEnabled:obj(p.auth).enable_auth===true,sharedRecordingDisabled:obj(p.privacy).record_voice===false,...receptionSharedCapacityChecks(p),noLegacyQueue:empty(p.queueing)};}
function sharedSettingsSafe(main:Obj){return Object.values(sharedSettingsChecks(main)).every(Boolean);}
function sourceSafe(main:Obj){return sharedSettingsSafe(main)&&empty(main.procedures)&&typeof obj(obj(main.conversation_config).tts).voice_id==='string'&&typeof obj(obj(obj(main.conversation_config).agent).prompt).llm==='string';}
// Only documented versioned fields are written. Auth, privacy and call limits
// are shared across branches; queueing version scope is unverified. These fields
// are read-only preconditions, never included in either provider write.
// https://elevenlabs.io/docs/eleven-agents/operate/versioning#per-agent-settings
// Explicit replacement of executable surfaces, retaining only selected voice/LLM
// settings. Executable tools and KB are cleared; merged provider state is read back.
export function receptionBranchBody(main:Obj,hookId:string|null,config:Obj){
 const selected=profile(config);
 const conversation=obj(main.conversation_config),tts=obj(conversation.tts),prompt=obj(obj(conversation.agent).prompt);
 const sourceBuiltinNames=Object.keys(obj(prompt.built_in_tools));
 if(sourceBuiltinNames.length>40||sourceBuiltinNames.some(name=>! /^[a-z][a-z0-9_]{0,79}$/.test(name)))fail('provider_receipt_invalid');
 const builtInNames=[...new Set(['transfer_to_agent','end_call','language_detection','transfer_to_number','skip_turn','play_keypad_touch_tone','voicemail_detection',...sourceBuiltinNames])];
 // Null each documented field: an empty object can deep-merge and retain tools.
 const built_in_tools:Obj=Object.fromEntries(builtInNames.map(name=>[name,null]));
 built_in_tools.end_call={type:'system',name:'end_call',description:'',params:{system_tool_type:'end_call'}};
 return {conversation_config:{asr:{user_input_audio_format:'ulaw_8000'},tts:{voice_id:tts.voice_id,model_id:tts.model_id??'eleven_turbo_v2',agent_output_audio_format:'ulaw_8000'},agent:{first_message:propertyReceptionEnabled(config)?propertyReceptionGreeting:receptionGreeting,language:'en',max_conversation_duration_message:'',prompt:{prompt:propertyReceptionEnabled(config)?propertyReceptionPrompt:receptionPrompt,llm:prompt.llm,max_tokens:120,tools:[],tool_ids:[],built_in_tools,mcp_server_ids:[],native_mcp_server_ids:[],knowledge_base:[],rag:{enabled:false},custom_llm:null}},conversation:{max_duration_seconds:selected.maxDurationSeconds},language_presets:{}},platform_settings:{overrides:{enable_conversation_initiation_client_data_from_webhook:false,enable_procedure_ids_from_client:false,enable_starting_workflow_node_id_from_client:false,conversation_config_override:{conversation:{max_duration_seconds:true}}},workspace_overrides:{conversation_initiation_client_data_webhook:null,webhooks:{post_call_webhook_id:hookId,events:hookId?['transcript']:[],transcript_format:'json',send_audio:false}},data_collection:{},evaluation:{criteria:[]}},workflow:{nodes:{start_node:{type:'start',position:{x:0,y:0},edge_order:[]}},edges:{},prevent_subagent_loops:true}};
}
type Snapshot={main:Obj;owner:Obj;branches:Obj[];branch:Obj|null;branchMeta:Obj|null;state:Obj;config:Obj;phone:Obj|null;hookId:string|null;postcallConfigured:boolean;blockers:string[];workspacePostcallAbsent:boolean};
async function snapshot(env:ReceptionSetupEnv,deps:ReceptionSetupDeps):Promise<Snapshot>{
 signing(env);const api=providers(env,deps);
 let state:Obj,config:Obj;try{state=obj(await deps.rpc('icash_get_reception_setup'));config=obj(await deps.rpc('icash_get_general_reception_config'));}catch{fail('database_unavailable');}
 if(state.schema_version!==1||config.account_id!==receptionTarget.accountId||config.owner_user_id!==receptionTarget.ownerUserId||config.called_number!==receptionTarget.calledNumber)fail('database_unavailable');
 profile(config);
 const [main,owner,listed,workspace]=await Promise.all([api.eleven(agentPath),api.eleven(agentPath+'?branch_id='+ownerBranch),api.eleven(agentPath+'/branches?include_archived=true&limit=100'),api.eleven('/v1/convai/settings')]);
 if(main.agent_id!==receptionTarget.agentId||!id(main.main_branch_id,'agtbrch')||main.branch_id!==main.main_branch_id||!id(main.version_id,'agtvrsn')||main.branch_id===ownerBranch||owner.agent_id!==receptionTarget.agentId||owner.branch_id!==ownerBranch||owner.main_branch_id!==main.main_branch_id)fail('provider_receipt_invalid');
 const rows=listed.results;if(!Array.isArray(rows)||!rows.length||rows.length>=100||(obj(listed.meta).total!==undefined&&obj(listed.meta).total!==rows.length))fail('provider_receipt_invalid');
 const branches=rows.map(obj);if(new Set(branches.map(b=>b.id)).size!==branches.length||branches.some(b=>b.agent_id!==receptionTarget.agentId||!id(b.id,'agtbrch')||b.draft_exists!==false||typeof b.is_archived!=='boolean'||b.current_live_percentage!==(b.id===main.branch_id?100:0)))fail('provider_receipt_invalid');
 if(!branches.some(b=>b.id===main.branch_id&&b.is_archived===false)||!branches.some(b=>b.id===ownerBranch))fail('provider_receipt_invalid');
 const matches=branches.filter(b=>b.name===receptionBranchName);if(matches.length>1)fail('provider_receipt_invalid');
 const branchMeta=matches[0]??null;if(branchMeta&&(branchMeta.id===main.branch_id||branchMeta.id===ownerBranch||branchMeta.is_archived!==false))fail('provider_receipt_invalid');
 const branch=branchMeta?await api.eleven(agentPath+'?branch_id='+branchMeta.id):null;
 if(branch&&(branch.agent_id!==receptionTarget.agentId||branch.branch_id!==branchMeta!.id||branch.main_branch_id!==main.branch_id||!id(branch.version_id,'agtvrsn')))fail('provider_receipt_invalid');
 const blockers:string[]=[];let phone:Obj|null=null,hookId:string|null=null;
 try{phone=await readPhone(api,env);}catch{blockers.push('twilio_readback_unavailable');}
 const postcallConfigured=goodSecret(env.RECEPTION_POSTCALL_SECRET??env.ELEVENLABS_WEBHOOK_SECRET);
 if(!postcallConfigured&&config.receipt_mode!=='provider_readback')blockers.push('existing_postcall_hmac_secret_missing');
 if(config.receipt_mode!=='provider_readback')try{const hooks=await api.eleven('/v1/workspace/webhooks?include_usages=false');if(!Array.isArray(hooks.webhooks))fail('provider_receipt_invalid');const matches=hooks.webhooks.map(obj).filter(h=>h.webhook_url===postcallUrl&&h.auth_type==='hmac'&&h.is_disabled===false&&h.is_auto_disabled===false);if(matches.length===1&&typeof matches[0].webhook_id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(matches[0].webhook_id))hookId=matches[0].webhook_id;}catch{blockers.push('postcall_webhook_readback_unavailable');}
 if(!hookId&&config.receipt_mode!=='provider_readback')blockers.push('existing_reception_postcall_webhook_missing');
 return {main:stable(main),owner:stable(owner),branches:branches.map(stable).sort((a,b)=>String(a.id).localeCompare(String(b.id))),branch:branch?stable(branch):null,branchMeta,state,config,phone,hookId,postcallConfigured,blockers,workspacePostcallAbsent:receptionWorkspacePostcallAbsent(workspace)};
}
async function restoreSnapshot(env:ReceptionSetupEnv,deps:ReceptionSetupDeps):Promise<Snapshot>{
 signing(env);let state:Obj;try{state=obj(await deps.rpc('icash_get_reception_setup'));}catch{fail('database_unavailable');}
 if(state.schema_version!==1)fail('database_unavailable');
 const phone=await readPhone(providers(env,deps),env),original=obj(state.original_phone);
 if(original.phone_number!==receptionTarget.calledNumber||original.account_sid!==env.TWILIO_ACCOUNT_SID||original.sid!==phone.sid)fail('action_not_ready');
 return {main:{},owner:{},branches:[],branch:null,branchMeta:null,state,config:{},phone,hookId:null,postcallConfigured:false,blockers:[],workspacePostcallAbsent:false};
}
function hookReady(s:Snapshot){if(s.config.receipt_mode==='provider_readback')return true;const w=obj(obj(obj(s.branch?.platform_settings).workspace_overrides).webhooks);return s.postcallConfigured&&s.hookId!==null&&w.post_call_webhook_id===s.hookId&&equal(w.events,['transcript'])&&w.transcript_format==='json'&&w.send_audio===false;}
function attempts(s:Snapshot){return obj(s.state.attempts);}
const preparationActions:SetupAction[]=['prepare_branch','prepare_branch_retry','prepare_branch_retry_2','prepare_branch_retry_3'];
function allowed(s:Snapshot,env:ReceptionSetupEnv,action:SetupAction){
 if(attempts(s)[action])return false;
 if(action!=='restore'&&!s.workspacePostcallAbsent)return false;
 if(action==='prepare_branch')return !s.branch&&s.config.enabled===false&&sourceSafe(s.main);
 if(preparationActions.includes(action)){const index=preparationActions.indexOf(action);return index>0&&preparationActions.slice(0,index).every(a=>{const prior=obj(attempts(s)[a]);return prior.state==='rejected'&&prior.provider_status===422&&typeof prior.finished_at==='string'&&Number.isFinite(Date.parse(prior.finished_at));})&&!preparationActions.slice(index).some(a=>attempts(s)[a])&&!Object.values(attempts(s)).some(v=>obj(v).state==='started')&&!s.branch&&s.config.branch_id===null&&s.config.enabled===false&&sourceSafe(s.main);}
 if(action==='configure_branch')return !!s.branch&&s.config.branch_id===s.branch.branch_id&&s.config.enabled===false&&sourceSafe(s.main)&&empty(s.branch.procedures)&&(s.config.receipt_mode==='provider_readback'||(!!s.hookId&&s.postcallConfigured));
 const phone=s.phone;if(!phone||phone.voice_application_sid||phone.trunk_sid)return false;
 if(action==='restore')return !!s.state.original_phone&&equal(phoneOther(phone),phoneOther(obj(s.state.original_phone)))&&equal(routing(phone),desiredRouting)&&typeof s.state.route_started_at==='string'&&(Date.now()-Date.parse(s.state.route_started_at))>30_000;
 if(s.state.original_phone||!s.branch||!s.branchMeta||!safeBranch(s.branch,s.branchMeta,s.config,s.workspacePostcallAbsent).safe||!hookReady(s)||s.config.enabled!==true||env.RECEPTION_ENABLED!=='true')return false;
 return inspectReceptionAgent(s.config as ReceptionConfig,s.branch,s.branchMeta,s.workspacePostcallAbsent).safe&&!equal(routing(phone),desiredRouting);
}
type Token={v:1;action:SetupAction;fingerprint:string;nonce:string;expires:number};
const actions:SetupAction[]=[...preparationActions,'configure_branch','route','restore'];
// Workspace absence is fresh policy evidence, not part of the historical create
// snapshot. Excluding only this new field preserves held-attempt reconstruction.
// Every review/apply/readback and actual admission re-fetches and validates it.
function fingerprint(s:Snapshot,action:SetupAction){const {workspacePostcallAbsent:_,...historical}=s;return digest(action==='restore'?{phone:s.phone,original:s.state.original_phone,routeStarted:s.state.route_started_at}:historical);}
function signature(raw:string,key:string){return createHmac('sha256',key).update('icash-reception-setup-v1\0'+raw).digest('base64url');}
function issue(s:Snapshot,action:SetupAction,secret:string,now:number){const t:Token={v:1,action,fingerprint:fingerprint(s,action),nonce:randomBytes(16).toString('hex'),expires:now+120_000};const encoded=Buffer.from(JSON.stringify(t)).toString('base64url');return {action,reviewToken:encoded+'.'+signature(encoded,secret),expiresAt:new Date(t.expires).toISOString()};}
function verify(raw:unknown,action:SetupAction,secret:string,now:number):Token{
 if(typeof raw!=='string'||raw.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw))fail('invalid_review');const [encoded,sig]=raw.split('.'),expected=signature(encoded,secret);
 if(sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))fail('invalid_review');
 let t:Obj;try{t=obj(JSON.parse(Buffer.from(encoded,'base64url').toString()));}catch{fail('invalid_review');}
 if(Object.keys(t!).sort().join(',')!=='action,expires,fingerprint,nonce,v'||t!.v!==1||t!.action!==action||!actions.includes(action)||typeof t!.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(t!.fingerprint)||typeof t!.nonce!=='string'||!/^[a-f0-9]{32}$/.test(t!.nonce)||!Number.isSafeInteger(t!.expires)||Number(t!.expires)>now+120_000)fail('invalid_review');if(Number(t!.expires)<=now)fail('review_expired');return t! as Token;
}
/** Read-only preparation evidence for the exact authenticated owner GET route.
 * Never a configurable phone, provider operation, profile change or authority.
 * The guarded SQL operator must recheck disabled/unused state before applying it.
 */
export async function ownerQuickTestCallerRestriction(env:ReceptionSetupEnv,deps:ReceptionSetupDeps):Promise<string|null>{
 if(typeof window!=='undefined'||!goodSecret(env.TWILIO_AUTH_TOKEN))return null;
 try{
  const [configInput,stateInput,receipt]=await Promise.all([
   deps.rpc('icash_get_general_reception_config'),deps.rpc('icash_get_reception_setup'),deps.rpc('icash_latest_general_reception_receipt'),
  ]);
  const c=obj(configInput),s=obj(stateInput),attempts=s.attempts;
  if(c.account_id!==receptionTarget.accountId||c.owner_user_id!==receptionTarget.ownerUserId||c.called_number!==receptionTarget.calledNumber||c.enabled!==false||s.schema_version!==1||!attempts||typeof attempts!=='object'||Array.isArray(attempts)||Object.keys(attempts).length!==0||s.original_phone!==null||s.route_started_at!==null||receipt!==null)return null;
  return createHmac('sha256',env.TWILIO_AUTH_TOKEN).update('reception-caller-v1\0'+ownerInboundTarget.ownerPhone).digest('hex');
 }catch{return null;}
}
function reconstructedPreCreate(s:Snapshot):Pick<ReceptionSetupReview,'preCreateEvidence'>{
 const held=Object.entries(attempts(s)).filter(([,v])=>obj(v).state==='started');
 if(held.length!==1||!preparationActions.includes(held[0][0] as SetupAction)||s.config.enabled!==false||s.config.branch_id!==null||!s.branch||!s.branchMeta||s.state.original_phone!==null||s.state.route_started_at!==null)return {};
 const action=held[0][0] as SetupAction,priorAttempts={...attempts(s)};delete priorAttempts[action];
 const before={...s,branch:null,branchMeta:null,branches:s.branches.filter(b=>b.id!==s.branchMeta!.id),state:{...s.state,attempts:priorAttempts}};
 return {preCreateEvidence:{action,fingerprint:fingerprint(before,action)}};
}
export async function reviewReceptionSetup(env:ReceptionSetupEnv,deps:ReceptionSetupDeps):Promise<ReceptionSetupReview>{
 try{const s=await snapshot(env,deps),valid=!!s.branch&&!!s.branchMeta&&safeBranch(s.branch,s.branchMeta,s.config,s.workspacePostcallAbsent).safe,offered=actions.filter(a=>allowed(s,env,a)).map(a=>issue(s,a,signing(env),deps.now?.()??Date.now()));
  const blockers=[...s.blockers];if(!s.workspacePostcallAbsent)blockers.push('workspace_postcall_destination_unverified');if(s.config.enabled!==true||env.RECEPTION_ENABLED!=='true')blockers.push('separate_funding_and_enablement_required');if(!sourceSafe(s.main))blockers.push(sharedSettingsSafe(s.main)?'source_voice_llm_or_procedures_unverified':'shared_agent_safety_settings_require_separate_review');if(s.branch&&!valid)blockers.push('branch_policy_readback_failed');if(Object.values(attempts(s)).some(v=>obj(v).state==='started'))blockers.push('prior_write_requires_read_only_reconciliation');
  const branchReview=s.branch&&s.branchMeta?safeBranch(s.branch,s.branchMeta,s.config,s.workspacePostcallAbsent):null,c=branchReview?.c;
  return result(deps,'review','Review the fixed reception setup. Preparation never enables calls or changes customer funding.',{blockers,profile:{name:String(s.config.call_profile),maxDurationSeconds:profile(s.config).maxDurationSeconds,customerChargeCapCents:profile(s.config).customerChargeCapCents},checks:{database:true,provider:true,workspacePostcallAbsent:s.workspacePostcallAbsent,...sharedSettingsChecks(s.main),sharedAgentSettingsSafe:sharedSettingsSafe(s.main),dedicatedBranch:valid,postcallSecretConfigured:s.postcallConfigured,postcallHookReady:hookReady(s),providerReadbackMode:s.config.receipt_mode==='provider_readback',twilioReadback:!!s.phone,twilioUsesReception:!!s.phone&&equal(routing(s.phone),desiredRouting),originalRoutingSaved:!!s.state.original_phone},actions:offered,...reconstructedPreCreate(s),...(c&&branchReview&&s.branch?{branch:{id:c.branch_id,version:c.reviewed_version_id,configHash:c.config_hash},branchChecks:branchReview.checks,branchPolicyShape:branchPolicyShape(s.branch)}:{})});
 }catch(e){
  // Emergency restoration must remain available during an ElevenLabs outage or
  // unrelated Main/branch drift. It only needs the fixed phone and saved state.
  try{const s=await restoreSnapshot(env,deps);if(allowed(s,env,'restore'))return result(deps,'review','Full readiness is unavailable. The saved original phone routing can still be restored.',{blockers:[reason(e)],checks:{twilioReadback:true,originalRoutingSaved:true},actions:[issue(s,'restore',signing(env),deps.now?.()??Date.now())],...providerFailure(e)});}catch{/* Preserve the original redacted readiness failure. */}
  return result(deps,'blocked','Readiness could not be verified. No change was sent.',{blockers:[reason(e)],...providerFailure(e)});}
}
export async function applyReceptionSetup(env:ReceptionSetupEnv,deps:ReceptionSetupDeps,action:SetupAction,raw:unknown):Promise<ReceptionSetupReview>{
 let dispatched=false;
 try{
  const now=deps.now?.()??Date.now(),token=verify(raw,action,signing(env),now),s=await (action==='restore'?restoreSnapshot(env,deps):snapshot(env,deps));
  if(fingerprint(s,action)!==token.fingerprint)fail('configuration_changed');if(!allowed(s,env,action))fail('action_not_ready');
  if((deps.now?.()??Date.now())>=token.expires)fail('review_expired');
  const claimed=await deps.rpc('icash_claim_reception_setup',{p_action:action,p_nonce:token.nonce,p_fingerprint:token.fingerprint,p_original_phone:action==='route'?s.phone:null});if(claimed!==true)fail('attempt_already_claimed');
  const api=providers(env,deps);let out:Obj={};dispatched=true;
  const createsBranch=preparationActions.includes(action);
  if(createsBranch||action==='configure_branch'){
   const body=receptionBranchBody(s.main,s.config.receipt_mode==='provider_readback'?null:s.postcallConfigured?s.hookId:null,s.config);
   const receipt=createsBranch?await api.eleven(agentPath+'/branches','POST',{parent_version_id:s.main.version_id,name:receptionBranchName,description:'Isolated message-only general reception. Never Main or the owner audio test. Enablement is separately gated.',...body,include_draft:false}):await api.eleven(agentPath+'?branch_id='+s.branch!.branch_id,'PATCH',body);
   const branchId=createsBranch?receipt.created_branch_id:s.branch!.branch_id;
   if(!id(branchId,'agtbrch')||branchId===s.main.branch_id||branchId===ownerBranch)fail('verification_failed');
   const after=await snapshot(env,deps);
   if(!equal(after.main,s.main)||!equal(after.owner,s.owner)||!equal(after.phone,s.phone)||!after.branch||!after.branchMeta||after.branch.branch_id!==branchId||!safeBranch(after.branch,after.branchMeta,after.config,after.workspacePostcallAbsent).safe)fail('verification_failed');
   const beforeOthers=s.branches.filter(b=>b.id!==branchId),afterOthers=after.branches.filter(b=>b.id!==branchId);if(!equal(beforeOthers,afterOthers))fail('verification_failed');
   const c=safeBranch(after.branch,after.branchMeta,after.config,after.workspacePostcallAbsent).c;out={branch_id:c.branch_id,reviewed_version_id:c.reviewed_version_id,config_hash:c.config_hash,call_profile:c.call_profile,rate_id:c.rate_id,max_duration_seconds:c.max_duration_seconds,customer_charge_cap_cents:c.customer_charge_cap_cents};
  }else{
   const original=obj(s.state.original_phone),desired=action==='route'?desiredRouting:routing(original),phone=s.phone!;
   const params=new URLSearchParams({VoiceUrl:String(desired.voice_url??''),VoiceMethod:String(desired.voice_method),VoiceFallbackUrl:String(desired.voice_fallback_url??''),VoiceFallbackMethod:String(desired.voice_fallback_method)});
   await api.twilio('/'+phone.sid+'.json','POST',params);
   const actual=await readPhone(api,env),expected={...phone,...desired};
   // Twilio may normalize an empty URL to null. Exact snapshot values are retained
   // durably; normalization is accepted only for empty URL string versus null.
   const normalized=(p:Obj)=>({...p,voice_url:p.voice_url||null,voice_fallback_url:p.voice_fallback_url||null});
   if(!equal(normalized(actual),normalized(expected)))fail('verification_failed');
  }
  if(await deps.rpc('icash_complete_reception_setup',{p_action:action,p_nonce:token.nonce,p_result:out})!==true)fail('verification_failed');
  return result(deps,'verified',createsBranch||action==='configure_branch'?'The isolated branch was prepared and read back. Main, the owner branch and phone routing were unchanged. Calls still need separate enablement.':action==='route'?'The fixed phone now uses the reception entry point and reject-only fallback. Read-back verified the change.':'The saved original voice routing was restored and read back.');
 }catch(e){return result(deps,dispatched?'outcome_unknown':'blocked',dispatched?'The write may have reached the provider. Use read-only refresh; do not repeat the write. Its durable attempt remains held for reconciliation.':'The action was held. No provider change was sent.',{blockers:[reason(e)],...providerFailure(e)});}
}
