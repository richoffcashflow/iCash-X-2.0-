// Authorized deployment preparation only. Creates isolated zero-traffic branches
// and a disabled database candidate. Never sends a call, SMS or signing request.
import {pathToFileURL} from 'node:url';
import {sellerAgreementToolConfig,sellerAgreementToolMatches,sellerAgreementToolName,noEmdAgreementToolConfig,noEmdAgreementToolName,automaticOfferToolConfig} from '../lib/seller-agreement-tool.ts';
import {sellerAgreementReceptionPolicy,sellerAgreementReceptionPolicyHash,sellerAgreementReceptionPrompt,noEmdReceptionPolicy,noEmdReceptionPolicyHash,noEmdReceptionPrompt,automaticOfferReceptionPolicy,automaticOfferReceptionPolicyHash,automaticOfferReceptionPrompt} from '../lib/seller-agreement-reception.ts';
import {automaticOfferPolicy,automaticOfferToolName,automaticOfferInstructions,automaticOfferGuardrails,automaticOfferGuardrailMatches} from '../lib/automatic-offer-policy.ts';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {canonical,object,readRecordingReview,recordingAgentMatches,sha} from '../lib/required-call-recording.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
import {receptionTarget,receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
import {testAutomaticOfferProvider} from './test-automatic-offer-provider.mjs';

const stable=a=>JSON.stringify(canonical({main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null}));
export async function prepareSellerAgreement(env=process.env,fetcher=fetch,noEmd=false,automatic=false,verifyProvider=testAutomaticOfferProvider){
 const name=automatic?'automatic-offer-flow-'+automaticOfferReceptionPolicyHash.slice(0,16):noEmd?'seller-agreement-no-emd-20261008':'seller-agreement-on-call-20261008';
 const policy=automatic?automaticOfferReceptionPolicy:noEmd?noEmdReceptionPolicy:sellerAgreementReceptionPolicy,policyHash=automatic?automaticOfferReceptionPolicyHash:noEmd?noEmdReceptionPolicyHash:sellerAgreementReceptionPolicyHash,prompt=automatic?automaticOfferReceptionPrompt:noEmd?noEmdReceptionPrompt:sellerAgreementReceptionPrompt;
 const toolName=automatic?automaticOfferToolName:noEmd?noEmdAgreementToolName:sellerAgreementToolName,toolConfig=automatic?automaticOfferToolConfig:noEmd?noEmdAgreementToolConfig:sellerAgreementToolConfig;
 if(env.VERCEL_ENV!=='production'||env.ICASH_DIRECT_CALLS_PREPARE!=='true')return {status:'not_requested'};
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.ELEVENLABS_API_KEY)throw Error('DEPLOYMENT_CONFIGURATION_REQUIRED');
 async function request(url,headers,method='GET',body){
  const r=await fetcher(url,{method,headers:{...headers,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!r.ok||r.redirected||r.url&&r.url!==url){
   if(!r.ok&&url.startsWith('https://api.us.elevenlabs.io/')&&method==='POST'){
    const error=await r.json().catch(()=>null),detail=object(object(error).detail);
    let message=typeof detail.message==='string'?detail.message:typeof object(error).detail==='string'?object(error).detail:'';
    for(const secret of [env.ELEVENLABS_API_KEY,env.SUPABASE_SECRET_KEY])if(secret)message=message.replaceAll(secret,'[redacted]');
    console.log('Seller agreement provider rejection:',JSON.stringify({operation:url.endsWith('/branches')?'create_branch':'create_tool',status:r.status,code:typeof detail.status==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(detail.status)?detail.status:null,message:message.replace(/[\x00-\x1f]/g,' ').slice(0,600)}));
   }
   throw Error('PROVIDER_UNCONFIRMED_'+r.status);
  }
  return JSON.parse((await boundedBytes(r,1024*1024)).toString('utf8'));
 }
 const rpc=(fn,body)=>request(env.SUPABASE_URL+'/rest/v1/rpc/'+fn,{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY},'POST',body);
 const api=(path,method,body)=>request('https://api.us.elevenlabs.io'+path,{'xi-api-key':env.ELEVENLABS_API_KEY},method,body);
 const c=await rpc('icash_get_recorded_reception_config',{p_called_number:receptionTarget.calledNumber});
 if(!automatic&&automaticOfferPolicy(c?.context_policy)||c?.context_policy===automaticOfferReceptionPolicy&&c?.context_policy_hash===automaticOfferReceptionPolicyHash||!automatic&&(c?.context_policy===noEmdReceptionPolicy&&c?.context_policy_hash===noEmdReceptionPolicyHash||!noEmd&&c?.context_policy===sellerAgreementReceptionPolicy&&c?.context_policy_hash===sellerAgreementReceptionPolicyHash))return {status:'already_active'};
 const oldReview=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON);
 if(!c||(automatic?c.context_policy!=='automatic_offer_v8':c.context_policy!==(noEmd?sellerAgreementReceptionPolicy:'seller_offer_v2'))||c.entry_policy!=='direct_recorded_v1'||!oldReview)throw Error('REVIEWED_SOURCE_REQUIRED');
 const incomingPath='/v1/convai/agents/'+c.agent_id,outgoingPath='/v1/convai/agents/'+oldReview.agentId;
 const [incoming,outgoing,workspace,stop,listedIncoming,listedOutgoing,toolList,oldAgreementTool]=await Promise.all([
  api(incomingPath+'?branch_id='+c.branch_id),api(outgoingPath+'?branch_id='+oldReview.branchId),api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api(incomingPath+'/branches?include_archived=true&limit=100'),api(outgoingPath+'/branches?include_archived=true&limit=100'),api('/v1/convai/tools?search='+toolName+'&page_size=100'),noEmd||automatic?api('/v1/convai/tools/'+c.agreement_tool_id):Promise.resolve(undefined),
 ]);
 const rows=list=>{if(!Array.isArray(list.results)||list.results.length>=100||list.next_cursor)throw Error('COMPLETE_BRANCH_LIST_REQUIRED');return list.results;};
 const inRows=rows(listedIncoming),outRows=rows(listedOutgoing);
 if(!inspectRecordedReceptionAgent(c,incoming,inRows.find(b=>b.id===c.branch_id),receptionWorkspacePostcallAbsent(workspace),stop,oldAgreementTool).safe||!recordingAgentMatches(oldReview,outgoing))throw Error('SOURCE_REVIEW_CHANGED');
 if(!Array.isArray(toolList.tools)||toolList.has_more||toolList.next_cursor)throw Error('COMPLETE_TOOL_LIST_REQUIRED');
 const matches=toolList.tools.filter(t=>object(t.tool_config).name===toolName&&(!automatic||sellerAgreementToolMatches(t))); 
 if(matches.length>1)throw Error('UNIQUE_AGREEMENT_TOOL_REQUIRED');
 let tool=matches[0];
 if(!tool){
  if(!automatic&&await rpc('icash_claim_seller_agreement_rollout',{p_source:c.id})!==true)throw Error('PRIOR_TOOL_CREATE_UNCONFIRMED');
  tool=await api('/v1/convai/tools','POST',{tool_config:toolConfig});
 }
 if(/^tool_[A-Za-z0-9]+$/.test(String(tool?.id)))tool=await api('/v1/convai/tools/'+tool.id);
 if(!sellerAgreementToolMatches(tool)){
  // Shape-only diagnostics: never log header values, tool secrets or raw payloads.
  const kind=v=>v===undefined?'absent':v===null?'null':v===''?'empty_string':typeof v==='boolean'?String(v):Array.isArray(v)?'array_'+v.length:typeof v==='object'?'object_'+Object.keys(v).length:typeof v;
  const differences=[];
  function compare(expected,actual,path){
   if(JSON.stringify(canonical(expected))===JSON.stringify(canonical(actual)))return;
   if(expected&&actual&&typeof expected==='object'&&typeof actual==='object'&&!Array.isArray(expected)&&!Array.isArray(actual)){
    for(const k of new Set([...Object.keys(expected),...Object.keys(actual)]))compare(expected[k],actual[k],path+'.'+(/^[a-zA-Z_]{1,70}$/.test(k)?k:'extra'));
   }else differences.push({path,expected:kind(expected),actual:kind(actual)});
  }
  const config=object(tool?.tool_config),schema=object(config.api_schema);
  compare(toolConfig.api_schema.request_body_schema,schema.request_body_schema,'body');
  compare(toolConfig.api_schema.request_headers,schema.request_headers,'headers');
  const compact=[...new Set(differences.map(d=>d.path.split('.').at(-1)+':'+d.expected+'>'+d.actual))];
  console.log('Seller agreement tool readback:',JSON.stringify({toolId:tool?.id,bodyDifferences:compact.slice(0,30),dynamicVariables:kind(config.dynamic_variables),dynamicPlaceholder:kind(object(config.dynamic_variables).dynamic_variable_placeholders),path:kind(schema.path_params_schema),query:kind(schema.query_params_schema),redirects:config.follow_redirects===false,authAbsent:schema.auth_connection==null,mocks:kind(tool?.response_mocks)}));
  throw Error('AGREEMENT_TOOL_READBACK_REQUIRED');
 }
 async function branch(path,source,list,conversation_config,platform_settings){
  const existing=list.filter(b=>b.name===name);if(existing.length>1)throw Error('UNIQUE_BRANCH_REQUIRED');
  let id=existing[0]?.id;
  if(!id){const made=await api(path+'/branches','POST',{name,parent_version_id:source.version_id,description:automatic?'Owner requested automatic engine prices, saved acceptance and independent blocking price validation.':noEmd?'Owner requested removal of seller purchase earnest-money requirements.':'Owner requested confirmed seller terms, contract text and verified signatures while on the call.',include_draft:false,conversation_config,...(platform_settings?{platform_settings}:{})});id=made.created_branch_id;}
  if(!/^agtbrch_[A-Za-z0-9]+$/.test(id)||id===source.branch_id||id===source.main_branch_id)throw Error('ISOLATED_BRANCH_REQUIRED');
  const [agent,branches,original]=await Promise.all([api(path+'?branch_id='+id),api(path+'/branches?include_archived=true&limit=100'),api(path+'?branch_id='+source.branch_id)]);
  if(stable(original)!==stable(source))throw Error('SOURCE_BRANCH_CHANGED');
  const selected=rows(branches).filter(b=>b.id===id);if(selected.length!==1||selected[0].current_live_percentage!==0||selected[0].is_archived||selected[0].draft_exists)throw Error('ISOLATED_BRANCH_READBACK_REQUIRED');
  return {agent,branch:selected[0]};
 }
 // Branch creation accepts overrides. Inherit audio/runtime settings from the
 // exact parent version instead of posting output-only GET configuration fields.
 const responsive=automatic?{turn:{turn_eagerness:'eager',turn_model:'turn_v3',spelling_patience:'auto',speculative_turn:false,soft_timeout_config:{timeout_seconds:2,message:'One moment.',use_llm_generated_message:false,max_soft_timeouts_per_generation:1,disable_until_first_user_message:true}}}:{};
 const quickPrompt=automatic?{llm:'gpt-4.1-mini',thinking_budget:0,enable_reasoning_summary:false,temperature:0.2,max_tokens:150,backup_llm_config:{preference:'default'},cascade_timeout_seconds:4}:{};
 const inputConfig={...responsive,agent:{first_message:'{{icash_property_greeting}}',prompt:{...quickPrompt,prompt:prompt+directRecordedInstructions,tool_ids:[c.stop_tool_id,tool.id]}}};
 const inPrepared=await branch(incomingPath,incoming,inRows,inputConfig,automatic?{guardrails:automaticOfferGuardrails(object(incoming.platform_settings).guardrails)}:undefined);
 const candidate={...c,context_policy:policy,context_policy_hash:policyHash,agreement_tool_id:tool.id,branch_id:inPrepared.branch.id,reviewed_version_id:inPrepared.agent.version_id,config_hash:''};
 const inspected=inspectRecordedReceptionAgent(candidate,inPrepared.agent,inPrepared.branch,receptionWorkspacePostcallAbsent(workspace),stop,tool);
 if(!inspectRecordedReceptionAgent({...candidate,config_hash:inspected.hash},inPrepared.agent,inPrepared.branch,receptionWorkspacePostcallAbsent(workspace),stop,tool).safe)throw Error('INBOUND_AGREEMENT_READBACK_REQUIRED');
 const outputConfig={...responsive,agent:{prompt:{...quickPrompt,tool_ids:oldReview.toolIds.map(id=>id===oldReview.contractToolId?tool.id:id),...(automatic?{prompt:automaticOfferReceptionPrompt}:{})}}};
 const outPrepared=await branch(outgoingPath,outgoing,outRows,outputConfig,automatic?{guardrails:automaticOfferGuardrails(object(outgoing.platform_settings).guardrails)}:undefined);
 const a=outPrepared.agent,newReview={...oldReview,...(automatic?{offerPolicy:automaticOfferReceptionPolicy}:{}),branchId:outPrepared.branch.id,versionId:a.version_id,contractToolId:tool.id,toolIds:outputConfig.agent.prompt.tool_ids,reviewedAt:new Date().toISOString(),configHash:sha(JSON.stringify(canonical({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null})))};
 if(!recordingAgentMatches(newReview,a)||!readRecordingReview(JSON.stringify(newReview)))throw Error('OUTBOUND_AGREEMENT_READBACK_REQUIRED');
 if(automatic&&(!automaticOfferGuardrailMatches(object(inPrepared.agent.platform_settings).guardrails)||!automaticOfferGuardrailMatches(object(outPrepared.agent.platform_settings).guardrails)))throw Error('PRICE_ENFORCEMENT_READBACK_REQUIRED');
 if(automatic)await verifyProvider(api,[inPrepared.agent,outPrepared.agent],tool.id,{prefix:'voice-offer-v9-'+policyHash.slice(0,12)+'-',closingCases:true});
 const staged=await rpc(automatic?'icash_stage_live_agreement_rollout':'icash_stage_seller_agreement_rollout',{p_source:c.id,p_tool:tool.id,p_branch:inPrepared.branch.id,p_version:inPrepared.agent.version_id,p_hash:inspected.hash,p_outbound_review:newReview});
 if(!staged?.inboundConfigId||!staged.outboundReview)throw Error('STAGING_UNCONFIRMED');
 return {status:'staged',configId:staged.inboundConfigId,toolId:tool.id,inboundBranch:inPrepared.branch.id,outboundBranch:outPrepared.branch.id};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log('Seller agreement preparation:',JSON.stringify(await prepareSellerAgreement(process.env,fetch,process.argv.includes('--no-emd'),process.argv.includes('--automatic-offers'))));}catch(error){console.error('Seller agreement preparation failed:',error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'UNCONFIRMED');process.exitCode=1;}}
