// Read-only production setup check. Never retrieves leads or creates test leads,
// subscriptions, conversions, calls, texts, or property lookups.
import {createHash,createHmac} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {metaLeadAccessToken} from '../lib/meta-instant-leads.ts';
import {canSaveSharedIntegrationCheck} from './integration-check-write-policy.mjs';

const numericId=value=>typeof value==='string'&&/^[0-9]{5,40}$/.test(value);
const production=env=>env.VERCEL_ENV==='production'&&canSaveSharedIntegrationCheck(env);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const relevantScopes=['ads_read','ads_management','leads_retrieval','pages_show_list','pages_read_engagement','pages_manage_ads','pages_manage_metadata'];

// Classify provider failures without persisting their messages, which may echo
// credentials. Error 100 alone cannot distinguish a bad field from missing access.
function graphFailure(data,httpStatus){
 const error=object(object(data).error),message=typeof error.message==='string'?error.message:'';
 const code=Number(error.code)||0,subcode=Number(error.error_subcode)||0;
 const reason=code===190?'invalid_access_token':/appsecret[_ ]?proof/i.test(message)?'invalid_appsecret_proof':
  /non.?existing field/i.test(message)?'unsupported_field':
  /unsupported get request|does not exist|cannot be loaded/i.test(message)?'object_unavailable':
  code===10||code===200||/permission/i.test(message)?'permission_required':'request_rejected';
 return {ok:false,httpStatus,code,subcode,reason,permissions:relevantScopes.filter(scope=>message.includes(scope))};
}

// Only explicitly requested form metadata is persisted. Even provider error
// messages and pagination URLs are excluded: they can echo access credentials.
function publicMetadata(value,secrets,depth=0){
 if(depth>8)return '[truncated]';
 if(typeof value==='string'){
  let result=value.slice(0,12000);
  for(const secret of secrets.filter(Boolean))result=result.split(secret).join('[redacted]');
  return result.replace(/([?&](?:access_token|appsecret_proof|client_secret)=)[^&#\s]*/gi,'$1[redacted]');
 }
 if(value===null||typeof value==='boolean'||typeof value==='number')return value;
 if(Array.isArray(value))return value.slice(0,100).map(item=>publicMetadata(item,secrets,depth+1));
 return Object.fromEntries(Object.entries(object(value)).slice(0,100).filter(([key])=>!/token|secret|password|authorization|cookie/i.test(key)).map(([key,item])=>[key,publicMetadata(item,secrets,depth+1)]));
}

export async function checkMetaLeadConnection(env=process.env,fetcher=fetch){
 const result={checkedAt:new Date().toISOString(),status:'not_configured',providerWrites:false,leadReads:false,
  formId:env.META_LEAD_SETUP_FORM_ID??null,pageId:env.META_LEAD_SETUP_PAGE_ID??null,appId:env.META_LEAD_SETUP_APP_ID??null};
 if(!production(env))return {...result,status:'not_production'};
 const {formId,pageId,appId}=result;
 if(![formId,pageId,appId].every(numericId)||!/^v\d{1,3}\.0$/.test(env.META_GRAPH_VERSION??'')||!env.META_LEAD_APP_SECRET)return result;
 let token;
 try{token=metaLeadAccessToken(pageId,env);}catch{return {...result,status:'page_token_required'};}
 const appToken=appId+'|'+env.META_LEAD_APP_SECRET;
 const proof=createHmac('sha256',env.META_LEAD_APP_SECRET).update(token).digest('hex');
 const secrets=[token,appToken,env.META_LEAD_APP_SECRET,proof];
 const get=async(path,fields,accessToken,withProof=false,params={})=>{
  const url=new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`);
  if(fields)url.searchParams.set('fields',fields);
  if(withProof)url.searchParams.set('appsecret_proof',proof);
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  try{
   const response=await fetcher(url,{method:'GET',headers:{Authorization:'Bearer '+accessToken},redirect:'error',signal:AbortSignal.timeout(8000)});
   const body=await response.text();
   if(body.length>100000)return {ok:false,httpStatus:response.status,reason:'response_too_large'};
   let data;try{data=JSON.parse(body);}catch{return {ok:false,httpStatus:response.status,reason:'invalid_response'};}
   if(!response.ok)return graphFailure(data,response.status);
   return {ok:true,data:object(data)};
  }catch{return {ok:false,reason:'request_unavailable'};}
 };
 const [form,page,app,debug]=await Promise.all([
  get(formId,'id,name,status,page_id,questions,legal_content,privacy_policy_url,follow_up_action_url,thank_you_page',token,true),
  get(pageId+'/subscribed_apps','id,subscribed_fields',token,true),
  get(appId+'/subscriptions',null,appToken),
  get('debug_token',null,appToken,false,{input_token:token}),
 ]);
 // Only the selected app/Page and relevant permission names enter the private
 // receipt. Token identity, other assets and the input-token URL never do.
 const tokenInfo=object(debug.data?.data);
 result.accessToken=debug.ok?{readable:true,valid:tokenInfo.is_valid===true,appMatches:String(tokenInfo.app_id)===appId,
  scopes:relevantScopes.filter(scope=>Array.isArray(tokenInfo.scopes)&&tokenInfo.scopes.includes(scope))}:{readable:false,...debug};
 result.pageSubscription=page.ok?{readable:true,subscribed:Array.isArray(page.data.data)&&page.data.data.some(entry=>entry.id===appId&&Array.isArray(entry.subscribed_fields)&&entry.subscribed_fields.includes('leadgen'))}:{readable:false,...page};
 result.appSubscription=app.ok?{readable:true,active:Array.isArray(app.data.data)&&app.data.data.some(entry=>entry.object==='page'&&entry.active===true&&entry.callback_url==='https://homeoffernetwork.com/api/webhooks/meta-leads'&&Array.isArray(entry.fields)&&entry.fields.some(field=>(typeof field==='string'?field:field?.name)==='leadgen'))}:{readable:false,...app};
 if(!form.ok)return {...result,status:'form_access_unverified',form};
 if(form.data.id!==formId||String(form.data.page_id)!==pageId)return {...result,status:'form_page_mismatch'};
 const snapshot=Object.fromEntries(['id','name','status','page_id','questions','legal_content','privacy_policy_url','follow_up_action_url','thank_you_page'].filter(key=>Object.hasOwn(form.data,key)).map(key=>[key,form.data[key]]));
 result.form=publicMetadata(snapshot,secrets);
 result.formHash=hash(snapshot);
 result.formAccessVerified=true;
 result.status=result.pageSubscription.subscribed&&result.appSubscription.active?'metadata_verified':'webhook_setup_required';
 // Form access alone never enables intake or certifies contact permission.
 return result;
}

export async function saveMetaLeadCheck(result,env=process.env,fetcher=fetch){
 if(!production(env)||!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||result.status==='not_production')return false;
 const response=await fetcher(env.SUPABASE_URL+'/rest/v1/icash_integration_checks?on_conflict=provider',{
  method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},
  body:JSON.stringify({provider:'meta_lead_setup',checked_at:result.checkedAt,result}),redirect:'error',signal:AbortSignal.timeout(10000),
 });
 return response.ok;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await checkMetaLeadConnection();
  const saved=await saveMetaLeadCheck(result).catch(()=>false);
  console.log(`Meta lead setup: ${result.status}; diagnostic_saved=${saved}. No outreach or provider changes.`);
 }catch{console.log('Meta lead setup: diagnostic unavailable. No outreach or provider changes.');}
}
