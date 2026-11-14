// Explicit exact-commit staging only. Uses existing server credentials in place;
// no credential output, live branch edits, calls, tool edits or activation.
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {productionReleaseTarget} from './verify-production-release.mjs';
import {canonical,object,readRecordingReview,recordingAgentMatches,sha} from '../lib/required-call-recording.ts';
import {readRecordedOutboundReadiness,recordedOutboundTarget} from '../lib/recorded-outbound-readiness.ts';
import {inspectRecordedReceptionAgent,recordedReceptionToolMatches} from '../lib/recorded-reception.ts';
import {receptionTarget,receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
import {sellerVoiceTurnConfig,sellerVoiceTurnConfigMatches} from '../lib/seller-voice-turn-policy.ts';

const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const snapshot=a=>({conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null});
const identity=a=>({agentId:a.agent_id,branchId:a.branch_id,versionId:a.version_id});
const pins=c=>({configId:c.id,agentId:c.agent_id,branchId:c.branch_id,versionId:c.reviewed_version_id,configHash:c.config_hash,contextPolicy:c.context_policy});
const reviewPins=r=>({agentId:r.agentId,branchId:r.branchId,versionId:r.versionId,configHash:r.configHash,contextPolicy:r.offerPolicy});
const change={turn_eagerness:'normal',turn_timeout:10,soft_timeout_config:{timeout_seconds:-1}};
const markerPrefix='seller_voice_turns_20261114';
function listBranch(value,id){
 const rows=value.results,meta=object(value.meta);
 if(!Array.isArray(rows)||rows.length>=100||value.next_cursor||meta.total!==undefined&&meta.total!==rows.length)throw Error('SELLER_TURNS_COMPLETE_BRANCH_LIST_REQUIRED');
 if(id===undefined)return rows;
 const matches=rows.filter(b=>b.id===id);
 if(matches.length!==1||matches[0].is_archived!==false||matches[0].draft_exists!==false||matches[0].current_live_percentage!==0)throw Error('SELLER_TURNS_ISOLATED_BRANCH_REQUIRED');
 return matches[0];
}
function expectedSnapshot(source){return {...snapshot(source),conversation_config:{...source.conversation_config,turn:sellerVoiceTurnConfig(object(source.conversation_config.turn))}};}
export function publicSellerTurnStage(result){
 if(result.status!=='staged')return {status:result.status};
 return {status:'staged',release:result.release,activated:false,providerWrites:result.providerWrites,
  outbound:{branchId:result.outbound.branchId,versionId:result.outbound.versionId,configHash:result.outbound.configHash},
  inbound:{branchId:result.inbound.branchId,versionId:result.inbound.versionId,configHash:result.inbound.configHash}};
}

export async function stageSellerVoiceTurns(env=process.env,fetcher=fetch,now=Date.now()){
 const requested=env.ICASH_SELLER_TURN_STAGE_COMMIT;
 if(!requested||requested!==env.VERCEL_GIT_COMMIT_SHA)return {status:'not_requested'};
 const target=productionReleaseTarget(env);
 if(target?.host!=='vercel'||target.sha!==requested||!/^[a-f0-9]{40}$/.test(requested))throw Error('SELLER_TURNS_COMMIT_REQUIRED');
 let source;try{source=JSON.parse(env.ICASH_SELLER_TURN_SOURCE_JSON??'null');}catch{throw Error('SELLER_TURNS_SOURCE_PINS_REQUIRED');}
 const review=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON,now);
 if(!source||!review||review.agentId!==recordedOutboundTarget.agentId||review.offerPolicy!=='automatic_offer_v9'
  ||review.providerAccountSid!==env.TWILIO_ACCOUNT_SID||!equal(source.outbound,reviewPins(review))
  ||source.inbound?.agentId!==receptionTarget.agentId||source.inbound.contextPolicy!=='automatic_offer_v11')throw Error('SELLER_TURNS_SOURCE_PINS_REQUIRED');
 if(!env.ELEVENLABS_API_KEY||!env.SUPABASE_SECRET_KEY||env.SUPABASE_URL!=='https://ofjbbpwugyjfxbhqfguh.supabase.co')throw Error('SELLER_TURNS_CONFIGURATION_REQUIRED');
 const database=env.SUPABASE_URL+'/rest/v1/';
 async function request(url,headers,method='GET',body){
  let r;try{r=await fetcher(url,{method,headers:{...headers,Accept:'application/json','Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});}catch{throw Error('SELLER_TURNS_REQUEST_UNCONFIRMED');}
  if(!r.ok||r.redirected||r.url&&r.url!==url||!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')??'')){await r.body?.cancel().catch(()=>undefined);throw Error('SELLER_TURNS_REQUEST_UNCONFIRMED');}
  try{return JSON.parse((await boundedBytes(r,1024*1024)).toString('utf8'));}catch{throw Error('SELLER_TURNS_RESPONSE_UNCONFIRMED');}
 }
 const api=(path,method,body)=>request('https://api.elevenlabs.io'+path,{'xi-api-key':env.ELEVENLABS_API_KEY},method,body);
 const db=(path,method,body)=>request(database+path,{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY},method,body);
 const getConfig=()=>db('rpc/icash_get_recorded_reception_config','POST',{p_called_number:receptionTarget.calledNumber});
 const c=await getConfig();
 if(!equal(pins(object(c)),source.inbound)||c.enabled!==true||c.entry_policy!=='direct_recorded_v1'||c.call_profile!=='normal'||c.callback_template_id!=null)throw Error('SELLER_TURNS_INBOUND_SOURCE_CHANGED');
 let outbound;
 const readiness=await readRecordedOutboundReadiness(env,{fetcher,now:()=>now,onAgent:a=>{outbound=a;}});
 if(!readiness.providerChecksPass||!outbound)throw Error('SELLER_TURNS_OUTBOUND_SOURCE_CHANGED');
 const inPath='/v1/convai/agents/'+c.agent_id,outPath='/v1/convai/agents/'+review.agentId;
 const [incoming,inList,workspace,inStop,inAgreement]=await Promise.all([api(inPath+'?branch_id='+c.branch_id),api(inPath+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api('/v1/convai/tools/'+c.agreement_tool_id)]);
 if(!recordedReceptionToolMatches(c.stop_tool_id,inStop)||!inspectRecordedReceptionAgent(c,incoming,listBranch(inList,c.branch_id),receptionWorkspacePostcallAbsent(workspace),inStop,inAgreement).safe)throw Error('SELLER_TURNS_INBOUND_SOURCE_CHANGED');
 // Keep immutable provider tool definitions and every non-turn setting exact.
 const toolIds=[...new Set([...review.toolIds,c.stop_tool_id,c.agreement_tool_id])];
 const initialTools=await Promise.all(toolIds.map(id=>api('/v1/convai/tools/'+id)));
 if(!equal(initialTools[toolIds.indexOf(c.stop_tool_id)],inStop)||!equal(initialTools[toolIds.indexOf(c.agreement_tool_id)],inAgreement))throw Error('SELLER_TURNS_SOURCE_TOOLS_CHANGED');
 const binding={release:requested,source,change},bindingHash=sha(JSON.stringify(canonical(binding)));
 let providerWrites=0;
 async function stage(direction,parent){
  const marker=markerPrefix+'_'+requested+'_'+direction,name='icash-seller-turns-'+requested+'-'+direction;
  const path='/v1/convai/agents/'+parent.agent_id;
  const markerPath='icash_integration_checks?provider=eq.'+marker;
  let rows=await db(markerPath),receipt;
  if(!Array.isArray(rows)||rows.length>1)throw Error('SELLER_TURNS_MARKER_READ_REQUIRED');
  if(rows.length){receipt=rows[0].result;if(receipt?.bindingHash!==bindingHash||receipt.name!==name||!['creating','candidate'].includes(receipt.state)||!/^[-a-f0-9]{36}$/.test(receipt.nonce??'')||!equal(receipt.source,identity(parent)))throw Error('SELLER_TURNS_MARKER_BINDING_CHANGED');}
  const listed=listBranch(await api(path+'/branches?include_archived=true&limit=100'));
  const existing=listed.filter(b=>b.name===name);
  if(existing.length>1||!receipt&&existing.length)throw Error('SELLER_TURNS_UNEXPECTED_BRANCH');
  if(!receipt){
   receipt={state:'creating',bindingHash,release:requested,name,source:identity(parent),nonce:randomUUID(),activated:false};
   // The unique provider key is the one-use creation claim. A lost response or
   // conflict never reaches POST /branches; reruns inspect the saved intent.
   const saved=await db('icash_integration_checks','POST',{provider:marker,checked_at:new Date(now).toISOString(),result:receipt});
   if(!Array.isArray(saved)||saved.length!==1||!equal(saved[0].result,receipt))throw Error('SELLER_TURNS_CREATE_CLAIM_UNCONFIRMED');
   let created;
   try{providerWrites++;created=await api(path+'/branches','POST',{name,parent_version_id:parent.version_id,description:'Owner-requested seller turn timing only; isolated zero-traffic candidate.',include_draft:false,conversation_config:{turn:sellerVoiceTurnConfig(object(parent.conversation_config.turn))}});}catch{/* The only recovery is a GET of this exact deterministic branch name. */}
   const recovered=listBranch(await api(path+'/branches?include_archived=true&limit=100')).filter(b=>b.name===name);
   if(recovered.length!==1||created?.created_branch_id&&created.created_branch_id!==recovered[0].id)throw Error('SELLER_TURNS_CREATE_UNCONFIRMED_NO_RETRY');
   receipt={...receipt,branchId:recovered[0].id};
  }else if(existing.length!==1){throw Error('SELLER_TURNS_CREATE_UNCONFIRMED_NO_RETRY');}
  const id=receipt.branchId??existing[0]?.id;
  if(!/^agtbrch_[A-Za-z0-9]+$/.test(id??'')||id===parent.branch_id||id===parent.main_branch_id||existing.length===1&&existing[0].id!==id)throw Error('SELLER_TURNS_CANDIDATE_BINDING_CHANGED');
  const [candidate,afterList,sourceAfter]=await Promise.all([api(path+'?branch_id='+id),api(path+'/branches?include_archived=true&limit=100'),api(path+'?branch_id='+parent.branch_id)]);
  const branch=listBranch(afterList,id);
  if(branch.agent_id!==parent.agent_id||candidate.agent_id!==parent.agent_id||candidate.branch_id!==id||candidate.main_branch_id!==parent.main_branch_id||!/^agtvrsn_[A-Za-z0-9]+$/.test(candidate.version_id??'')||candidate.version_id===parent.version_id||!Array.isArray(candidate.phone_numbers)||candidate.phone_numbers.length!==0)throw Error('SELLER_TURNS_CANDIDATE_IDENTITY_CHANGED');
  if(!equal(identity(sourceAfter),identity(parent))||!equal(snapshot(sourceAfter),snapshot(parent)))throw Error('SELLER_TURNS_SOURCE_MUTATED');
  if(!equal(snapshot(candidate),expectedSnapshot(parent))||!sellerVoiceTurnConfigMatches(object(candidate.conversation_config.turn)))throw Error('SELLER_TURNS_CANDIDATE_CONFIG_CHANGED');
  let details;
  if(direction==='outbound'){
   const nextReview={...review,branchId:id,versionId:candidate.version_id,configHash:sha(JSON.stringify(canonical(snapshot(candidate)))),reviewedAt:receipt.candidate?.review?.reviewedAt??new Date(now).toISOString()};
   if(!recordingAgentMatches(nextReview,candidate))throw Error('SELLER_TURNS_OUTBOUND_CANDIDATE_INVALID');
   const checked=await readRecordedOutboundReadiness({...env,RECORDED_OUTBOUND_REVIEW_JSON:JSON.stringify(nextReview)},{fetcher,now:()=>now});
   if(!checked.providerChecksPass)throw Error('SELLER_TURNS_OUTBOUND_CANDIDATE_INVALID');
   details={...identity(candidate),configHash:nextReview.configHash,review:nextReview};
  }else{
   const nextConfig={...c,branch_id:id,version_id:candidate.version_id,reviewed_version_id:candidate.version_id,config_hash:''};
   const hash=inspectRecordedReceptionAgent(nextConfig,candidate,branch,receptionWorkspacePostcallAbsent(workspace),inStop,inAgreement).hash;
   if(!inspectRecordedReceptionAgent({...nextConfig,config_hash:hash},candidate,branch,receptionWorkspacePostcallAbsent(workspace),inStop,inAgreement).safe)throw Error('SELLER_TURNS_INBOUND_CANDIDATE_INVALID');
   details={...identity(candidate),configHash:hash,sourceConfigId:c.id};
  }
  if(receipt.state==='candidate'&&!equal(receipt.candidate,details))throw Error('SELLER_TURNS_SAVED_CANDIDATE_CHANGED');
  // Private candidate metadata is inert. No enabled flag, live review, template,
  // account config or rate is changed. Activation is a separate exact review.
  const result={...receipt,state:'candidate',branchId:id,candidate:details};
  const saved=await db(markerPath+'&result->>nonce=eq.'+encodeURIComponent(receipt.nonce),'PATCH',{checked_at:new Date(now).toISOString(),result});
  if(!Array.isArray(saved)||saved.length!==1||!equal(saved[0].result,result))throw Error('SELLER_TURNS_CANDIDATE_SAVE_UNCONFIRMED');
  return details;
 }
 const out=await stage('outbound',outbound),inside=await stage('inbound',incoming);
 const [configAfter,outAfter,inAfter,workspaceAfter,toolsAfter]=await Promise.all([getConfig(),api(outPath+'?branch_id='+review.branchId),api(inPath+'?branch_id='+c.branch_id),api('/v1/convai/settings'),Promise.all(toolIds.map(id=>api('/v1/convai/tools/'+id)))]);
 if(!equal(configAfter,c)||!equal(identity(outAfter),identity(outbound))||!equal(snapshot(outAfter),snapshot(outbound))||!equal(identity(inAfter),identity(incoming))||!equal(snapshot(inAfter),snapshot(incoming))||!equal(workspaceAfter,workspace)||!equal(toolsAfter,initialTools))throw Error('SELLER_TURNS_FINAL_SOURCE_CHANGED');
 const finalMarker=markerPrefix+'_'+requested+'_verified',verified={state:'verified',bindingHash,release:requested,source,outbound:out,inbound:inside,activated:false};
 const previous=await db('icash_integration_checks?provider=eq.'+finalMarker);
 if(!Array.isArray(previous)||previous.length>1||previous.length===1&&!equal(previous[0].result,verified))throw Error('SELLER_TURNS_FINAL_RECEIPT_CHANGED');
 if(!previous.length){
  const saved=await db('icash_integration_checks','POST',{provider:finalMarker,checked_at:new Date(now).toISOString(),result:verified});
  if(!Array.isArray(saved)||saved.length!==1||!equal(saved[0].result,verified))throw Error('SELLER_TURNS_FINAL_RECEIPT_UNCONFIRMED');
 }
 return {status:'staged',release:requested,providerWrites,outbound:out,inbound:inside,activated:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('Seller voice turn staging:',JSON.stringify(publicSellerTurnStage(await stageSellerVoiceTurns())));}
 catch(error){console.error('Seller voice turn staging:',/^SELLER_TURNS_[A-Z_]+$/.test(error?.message??'')?error.message:'SELLER_TURNS_UNCONFIRMED');process.exitCode=1;}
}
