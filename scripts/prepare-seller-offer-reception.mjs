// Explicit production deployment preparation, not a request/admin endpoint.
// Only a new zero-traffic branch and a disabled, fixed-account candidate may be created.
// Keys stay in the deployment environment. Never logs provider bodies or credentials.
import {sellerOfferReceptionPolicy,sellerOfferReceptionPolicyHash,sellerOfferReceptionPrompt} from '../lib/seller-offer-reception.ts';
import {pathToFileURL} from 'node:url';
import {inspectRecordedReceptionAgent} from '../lib/recorded-reception.ts';
import {receptionContextPrompt} from '../lib/reception-property-context.ts';
import {directRecordedInstructions} from '../lib/direct-call-entry.ts';
import {canonical,object} from '../lib/required-call-recording.ts';
import {receptionTarget,receptionWorkspacePostcallAbsent} from '../lib/general-reception.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
const name='qualified-seller-cash-offer-20261008';
const stable=a=>canonical({main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null});
export async function prepareSellerOfferReception(env=process.env,fetcher=fetch){
 if(env.VERCEL_ENV!=='production'||env.ICASH_DIRECT_CALLS_PREPARE!=='true')return {status:'not_requested'};
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.ELEVENLABS_API_KEY)throw Error('DEPLOYMENT_CONFIGURATION_REQUIRED');
 async function request(url,headers,method='GET',body){
  const response=await fetcher(url,{method,headers:{...headers,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok||response.redirected||response.url&&response.url!==url)throw Error('PROVIDER_READ_OR_WRITE_UNCONFIRMED_'+response.status);
  return JSON.parse((await boundedBytes(response,512*1024)).toString('utf8'));
 }
 const rpc=(name,body)=>request(env.SUPABASE_URL+'/rest/v1/rpc/'+name,{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY},'POST',body);
 const api=(path,method,body)=>request('https://api.us.elevenlabs.io'+path,{'xi-api-key':env.ELEVENLABS_API_KEY},method,body);
 const c=await rpc('icash_get_recorded_reception_config',{p_called_number:receptionTarget.calledNumber});
 if(['seller_agreement_v3','seller_agreement_v4','automatic_offer_v5','automatic_offer_v6'].includes(c?.context_policy)||c?.context_policy===sellerOfferReceptionPolicy&&c?.context_policy_hash===sellerOfferReceptionPolicyHash)return {status:'already_active'};
 if(!c||c.agent_id!==receptionTarget.agentId||c.call_profile!=='normal'||c.context_policy!=='buyer_seller_v1'||c.entry_policy!=='direct_recorded_v1')throw Error('REVIEWED_SOURCE_REQUIRED');
 const path='/v1/convai/agents/'+c.agent_id;
 const [source,listed,workspace,tool,main]=await Promise.all([api(path+'?branch_id='+c.branch_id),api(path+'/branches?include_archived=true&limit=100'),api('/v1/convai/settings'),api('/v1/convai/tools/'+c.stop_tool_id),api(path)]);
 if(!Array.isArray(listed.results)||listed.results.length>=100)throw Error('COMPLETE_BRANCH_LIST_REQUIRED');
 const before=listed.results.filter(b=>b.id===c.branch_id);
 if(before.length!==1||!inspectRecordedReceptionAgent(c,source,before[0],receptionWorkspacePostcallAbsent(workspace),tool).safe)throw Error('SOURCE_REVIEW_CHANGED');
 const matches=listed.results.filter(b=>b.name===name);
 if(matches.length>1)throw Error('UNIQUE_BRANCH_REQUIRED');
 let branch=matches[0];
 if(!branch){
  if(await rpc('icash_claim_seller_offer_branch',{p_source:c.id})!==true)throw Error('PRIOR_BRANCH_CREATE_UNCONFIRMED');
  const created=await api(path+'/branches','POST',{name,parent_version_id:source.version_id,description:'Owner-requested seller qualification and current cash proposal; direct recorded entry retained.',include_draft:false,conversation_config:{agent:{first_message:'{{icash_property_greeting}}',prompt:{prompt:sellerOfferReceptionPrompt+directRecordedInstructions}}}});
  if(!/^agtbrch_[A-Za-z0-9]+$/.test(created.created_branch_id)||created.created_branch_id===c.branch_id||created.created_branch_id===source.main_branch_id)throw Error('NEW_BRANCH_UNCONFIRMED');
  branch={id:created.created_branch_id};
 }
 const [after,branches,sourceAfter,mainAfter]=await Promise.all([api(path+'?branch_id='+branch.id),api(path+'/branches?include_archived=true&limit=100'),api(path+'?branch_id='+c.branch_id),api(path)]);
 if(JSON.stringify(stable(source))!==JSON.stringify(stable(sourceAfter))||JSON.stringify(stable(main))!==JSON.stringify(stable(mainAfter)))throw Error('EXISTING_AGENT_CHANGED');
 const rows=Array.isArray(branches.results)?branches.results.filter(b=>b.id===branch.id):[];
 if(rows.length!==1)throw Error('BRANCH_READBACK_REQUIRED');
 const candidate={...c,context_policy:sellerOfferReceptionPolicy,context_policy_hash:sellerOfferReceptionPolicyHash,entry_policy:'direct_recorded_v1',branch_id:branch.id,reviewed_version_id:after.version_id,config_hash:''};
 const observed=inspectRecordedReceptionAgent(candidate,after,rows[0],receptionWorkspacePostcallAbsent(workspace),tool);
 if(!inspectRecordedReceptionAgent({...candidate,config_hash:observed.hash},after,rows[0],receptionWorkspacePostcallAbsent(workspace),tool).safe)throw Error('DIRECT_SCRIPT_READBACK_FAILED');
 const staged=await rpc('icash_stage_seller_offer_reception',{p_source:c.id,p_branch:branch.id,p_version:after.version_id,p_hash:observed.hash});
 if(!staged||staged.enabled||staged.config_hash!==observed.hash||staged.entry_policy!=='direct_recorded_v1'||staged.context_policy!==sellerOfferReceptionPolicy||staged.context_policy_hash!==sellerOfferReceptionPolicyHash)throw Error('STAGING_UNCONFIRMED');
 return {status:'staged',configId:staged.id,branchId:staged.branch_id,versionId:staged.reviewed_version_id,hash:staged.config_hash};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('Seller offer reception preparation:',JSON.stringify(await prepareSellerOfferReception()));}
 catch(error){console.error('Seller offer reception preparation failed:',error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'UNCONFIRMED');process.exitCode=1;}
}
