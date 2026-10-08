// Authorized deployment preparation only. Creates isolated zero-traffic branches
// and a disabled database candidate. Never sends a call, SMS or signing request.
import {pathToFileURL} from 'node:url';
import {sellerAgreementToolConfig,sellerAgreementToolMatches,sellerAgreementToolName} from '../lib/seller-agreement-tool.ts';
import {sellerAgreementReceptionPolicy,sellerAgreementReceptionPolicyHash,sellerAgreementReceptionPrompt} from '../lib/seller-agreement-reception.ts';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {canonical,object,readRecordingReview,recordingAgentMatches,sha} from '../lib/required-call-recording.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
import {receptionTarget,receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
const name='seller-agreement-on-call-20261008';
const stable=a=>JSON.stringify(canonical({main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null}));
export async function prepareSellerAgreement(env=process.env,fetcher=fetch){
 if(env.VERCEL_ENV!=='production'||env.ICASH_DIRECT_CALLS_PREPARE!=='true')return {status:'not_requested'};
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.ELEVENLABS_API_KEY)throw Error('DEPLOYMENT_CONFIGURATION_REQUIRED');
 async function request(url,headers,method='GET',body){
  const r=await fetcher(url,{method,headers:{...headers,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!r.ok||r.redirected||r.url&&r.url!==url)throw Error('PROVIDER_UNCONFIRMED_'+r.status);
  return JSON.parse((await boundedBytes(r,1024*1024)).toString('utf8'));
 }
 const rpc=(fn,body)=>request(env.SUPABASE_URL+'/rest/v1/rpc/'+fn,{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY},'POST',body);
 const api=(path,method,body)=>request('https://api.us.elevenlabs.io'+path,{'xi-api-key':env.ELEVENLABS_API_KEY},method,body);
 const c=await rpc('icash_get_recorded_reception_config',{p_called_number:receptionTarget.calledNumber});
 if(c?.context_policy===sellerAgreementReceptionPolicy&&c?.context_policy_hash===sellerAgreementReceptionPolicyHash)return {status:'already_active'};
 const oldReview=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON);
 if(!c||c.context_policy!=='seller_offer_v2'||c.entry_policy!=='direct_recorded_v1'||!oldReview)throw Error('REVIEWED_SOURCE_REQUIRED');
 const incomingPath='/v1/convai/agents/'+c.agent_id,outgoingPath='/v1/convai/agents/'+oldReview.agentId;
 const [incoming,outgoing,workspace,stop,listedIncoming,listedOutgoing,toolList]=await Promise.all([
  api(incomingPath+'?branch_id='+c.branch_id),api(outgoingPath+'?branch_id='+oldReview.branchId),api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api(incomingPath+'/branches?include_archived=true&limit=100'),api(outgoingPath+'/branches?include_archived=true&limit=100'),api('/v1/convai/tools?search='+sellerAgreementToolName+'&page_size=100'),
 ]);
 const rows=list=>{if(!Array.isArray(list.results)||list.results.length>=100||list.next_cursor)throw Error('COMPLETE_BRANCH_LIST_REQUIRED');return list.results;};
 const inRows=rows(listedIncoming),outRows=rows(listedOutgoing);
 if(!inspectRecordedReceptionAgent(c,incoming,inRows.find(b=>b.id===c.branch_id),receptionWorkspacePostcallAbsent(workspace),stop).safe||!recordingAgentMatches(oldReview,outgoing))throw Error('SOURCE_REVIEW_CHANGED');
 if(!Array.isArray(toolList.tools)||toolList.has_more||toolList.next_cursor)throw Error('COMPLETE_TOOL_LIST_REQUIRED');
 const matches=toolList.tools.filter(t=>object(t.tool_config).name===sellerAgreementToolName);
 if(matches.length>1)throw Error('UNIQUE_AGREEMENT_TOOL_REQUIRED');
 let tool=matches[0];
 if(!tool){
  if(await rpc('icash_claim_seller_agreement_rollout',{p_source:c.id})!==true)throw Error('PRIOR_TOOL_CREATE_UNCONFIRMED');
  tool=await api('/v1/convai/tools','POST',{tool_config:sellerAgreementToolConfig});
 }
 if(/^tool_[A-Za-z0-9]+$/.test(String(tool?.id)))tool=await api('/v1/convai/tools/'+tool.id);
 if(!sellerAgreementToolMatches(tool)){
  // Shape-only diagnostics: never log header values, tool secrets or raw payloads.
  const kind=v=>v===undefined?'absent':v===null?'null':v===''?'empty_string':Array.isArray(v)?'array_'+v.length:typeof v==='object'?'object_'+Object.keys(v).length:typeof v;
  const differences=[];
  function compare(expected,actual,path){
   if(JSON.stringify(canonical(expected))===JSON.stringify(canonical(actual)))return;
   if(expected&&actual&&typeof expected==='object'&&typeof actual==='object'&&!Array.isArray(expected)&&!Array.isArray(actual)){
    for(const k of new Set([...Object.keys(expected),...Object.keys(actual)]))compare(expected[k],actual[k],path+'.'+(Object.hasOwn(expected,k)||['dynamic_variable','constant_value','enum','items','description','dynamic_variable_placeholders','properties','required'].includes(k)?k:'extra'));
   }else differences.push({path,expected:kind(expected),actual:kind(actual)});
  }
  const config=object(tool?.tool_config),schema=object(config.api_schema);
  compare(sellerAgreementToolConfig.api_schema.request_body_schema,schema.request_body_schema,'body');
  compare(sellerAgreementToolConfig.api_schema.request_headers,schema.request_headers,'headers');
  console.log('Seller agreement tool readback:',JSON.stringify({toolId:tool?.id,bodyDifferences:differences.slice(0,70),dynamicVariables:kind(config.dynamic_variables),dynamicPlaceholder:kind(object(config.dynamic_variables).dynamic_variable_placeholders),path:kind(schema.path_params_schema),query:kind(schema.query_params_schema),redirects:config.follow_redirects===false,authAbsent:schema.auth_connection==null,mocks:kind(tool?.response_mocks)}));
  throw Error('AGREEMENT_TOOL_READBACK_REQUIRED');
 }
 async function branch(path,source,list,conversation_config){
  const existing=list.filter(b=>b.name===name);if(existing.length>1)throw Error('UNIQUE_BRANCH_REQUIRED');
  let id=existing[0]?.id;
  if(!id){const made=await api(path+'/branches','POST',{name,parent_version_id:source.version_id,description:'Owner requested confirmed seller terms, contract text and verified signatures while on the call.',include_draft:false,conversation_config});id=made.created_branch_id;}
  if(!/^agtbrch_[A-Za-z0-9]+$/.test(id)||id===source.branch_id||id===source.main_branch_id)throw Error('ISOLATED_BRANCH_REQUIRED');
  const [agent,branches,original]=await Promise.all([api(path+'?branch_id='+id),api(path+'/branches?include_archived=true&limit=100'),api(path+'?branch_id='+source.branch_id)]);
  if(stable(original)!==stable(source))throw Error('SOURCE_BRANCH_CHANGED');
  const selected=rows(branches).filter(b=>b.id===id);if(selected.length!==1||selected[0].current_live_percentage!==0||selected[0].is_archived||selected[0].draft_exists)throw Error('ISOLATED_BRANCH_READBACK_REQUIRED');
  return {agent,branch:selected[0]};
 }
 const inputConfig=structuredClone(incoming.conversation_config);inputConfig.agent.first_message='{{icash_property_greeting}}';inputConfig.agent.prompt.prompt=sellerAgreementReceptionPrompt+directRecordedInstructions;inputConfig.agent.prompt.tool_ids=[c.stop_tool_id,tool.id];
 // Tool IDs are canonical references. Omit expanded webhook definitions inherited by GET.
 inputConfig.agent.prompt.tools=(inputConfig.agent.prompt.tools??[]).filter(t=>t.type==='system');
 const inPrepared=await branch(incomingPath,incoming,inRows,inputConfig);
 const candidate={...c,context_policy:sellerAgreementReceptionPolicy,context_policy_hash:sellerAgreementReceptionPolicyHash,agreement_tool_id:tool.id,branch_id:inPrepared.branch.id,reviewed_version_id:inPrepared.agent.version_id,config_hash:''};
 const inspected=inspectRecordedReceptionAgent(candidate,inPrepared.agent,inPrepared.branch,receptionWorkspacePostcallAbsent(workspace),stop,tool);
 if(!inspectRecordedReceptionAgent({...candidate,config_hash:inspected.hash},inPrepared.agent,inPrepared.branch,receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('INBOUND_AGREEMENT_READBACK_REQUIRED');
 const outputConfig=structuredClone(outgoing.conversation_config);outputConfig.agent.prompt.tool_ids=oldReview.toolIds.map(id=>id===oldReview.contractToolId?tool.id:id);outputConfig.agent.prompt.tools=(outputConfig.agent.prompt.tools??[]).filter(t=>t.type==='system');
 const outPrepared=await branch(outgoingPath,outgoing,outRows,outputConfig);
 const a=outPrepared.agent,newReview={...oldReview,branchId:outPrepared.branch.id,versionId:a.version_id,contractToolId:tool.id,toolIds:outputConfig.agent.prompt.tool_ids,reviewedAt:new Date().toISOString(),configHash:sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null})))};
 if(!recordingAgentMatches(newReview,a)||!readRecordingReview(JSON.stringify(newReview)))throw Error('OUTBOUND_AGREEMENT_READBACK_REQUIRED');
 const staged=await rpc('icash_stage_seller_agreement_rollout',{p_source:c.id,p_tool:tool.id,p_branch:inPrepared.branch.id,p_version:inPrepared.agent.version_id,p_hash:inspected.hash,p_outbound_review:newReview});
 if(!staged?.inboundConfigId||!staged.outboundReview)throw Error('STAGING_UNCONFIRMED');
 return {status:'staged',configId:staged.inboundConfigId,toolId:tool.id,inboundBranch:inPrepared.branch.id,outboundBranch:outPrepared.branch.id};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log('Seller agreement preparation:',JSON.stringify(await prepareSellerAgreement()));}catch(error){console.error('Seller agreement preparation failed:',error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'UNCONFIRMED');process.exitCode=1;}}
