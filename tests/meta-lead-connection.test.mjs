import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {checkMetaLeadConnection,saveMetaLeadCheck} from '../scripts/check-meta-lead-connection.mjs';
const token='SIMULATION_META_TOKEN_ONLY',secret='SIMULATION_META_SECRET_ONLY';
const env={VERCEL_ENV:'production',META_LEAD_SETUP_APP_ID:'111111111',META_LEAD_SETUP_PAGE_ID:'222222222',META_LEAD_SETUP_FORM_ID:'333333333',META_LEAD_ADS_READ_PAGE_IDS:'222222222',META_ADS_READ_ACCESS_TOKEN:token,META_LEAD_APP_SECRET:secret,META_GRAPH_VERSION:'v26.0',SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_SECRET_KEY:'SIMULATION_DATABASE_ONLY'};
let requests=[],mode='success';
const fetcher=async(url,options)=>{
 url=new URL(url);requests.push(url.pathname);
 assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
 assert.equal(url.origin,'https://graph.facebook.com');
 if(url.pathname.endsWith('/subscriptions')){
  assert.equal(options.headers.Authorization,'Bearer '+env.META_LEAD_SETUP_APP_ID+'|'+secret);
  return Response.json({data:[{object:'page',active:true,callback_url:'https://homeoffernetwork.com/api/webhooks/meta-leads',fields:[{name:'leadgen'}]}]});
 }
 assert.equal(options.headers.Authorization,'Bearer '+token);
 assert.equal(url.searchParams.get('appsecret_proof'),createHmac('sha256',secret).update(token).digest('hex'));
 if(url.pathname.endsWith('/subscribed_apps'))return Response.json({data:mode==='unsubscribed'?[]:[{id:env.META_LEAD_SETUP_APP_ID,subscribed_fields:['leadgen']}]});
 assert.equal(url.pathname,'/v26.0/'+env.META_LEAD_SETUP_FORM_ID);
 assert(!url.searchParams.get('fields').includes('leads'));
 if(mode==='denied')return Response.json({error:{code:200,message:'Secret echo '+token,access_token:token}},{status:403});
 return Response.json({id:env.META_LEAD_SETUP_FORM_ID,page_id:mode==='mismatch'?'999999999':env.META_LEAD_SETUP_PAGE_ID,status:'ACTIVE',questions:[{key:'full_name',type:'FULL_NAME'},{key:'phone_number',type:'PHONE'}],legal_content:{custom_disclaimer:{title:'Contact choice',body:{text:'Fixture permission'},checkboxes:[{key:'contact',text:'Fixture checkbox'}]},unexpected_token:token},name:'Fixture '+token,privacy_policy_url:'https://fixture.test/privacy?access_token=private',unexpected:{access_token:token}});
};
let result=await checkMetaLeadConnection(env,fetcher);
assert.equal(result.status,'metadata_verified');assert.equal(requests.length,3);
assert.deepEqual(result.form.questions.map(q=>q.key),['full_name','phone_number']);
assert.equal(result.form.legal_content.custom_disclaimer.checkboxes[0].key,'contact');
assert.equal(result.formHash.length,64);assert.equal(result.providerWrites,false);assert.equal(result.leadReads,false);
assert(!JSON.stringify(result).includes(token));assert(!JSON.stringify(result).includes(secret));assert(!JSON.stringify(result).includes('=private'));
assert(!Object.hasOwn(result.form,'unexpected'));
requests=[];mode='denied';result=await checkMetaLeadConnection(env,fetcher);
assert.equal(result.status,'form_access_unverified');assert.equal(result.form.code,200);assert.equal(requests.length,1);assert(!JSON.stringify(result).includes(token));
requests=[];mode='mismatch';assert.equal((await checkMetaLeadConnection(env,fetcher)).status,'form_page_mismatch');assert.equal(requests.length,1);
requests=[];mode='unsubscribed';assert.equal((await checkMetaLeadConnection(env,fetcher)).status,'webhook_setup_required');
const forbidden=()=>assert.fail('A preview or unbound source cannot contact a provider');
for(const input of [{...env,VERCEL_ENV:'preview'},{...env,VERCEL_TARGET_ENV:'preview'},{...env,VERCEL_ENV:undefined}]){
 assert.equal((await checkMetaLeadConnection(input,forbidden)).status,'not_production');
 assert.equal(await saveMetaLeadCheck(result,input,forbidden),false);
}
assert.equal((await checkMetaLeadConnection({...env,META_LEAD_ADS_READ_PAGE_IDS:'444444444'},forbidden)).status,'page_token_required');
assert.equal((await checkMetaLeadConnection({...env,META_LEAD_SETUP_FORM_ID:'33333/leads'},forbidden)).status,'not_configured');
let writes=0;
assert.equal(await saveMetaLeadCheck(result,env,async(url,options)=>{
 writes++;assert.equal(url,env.SUPABASE_URL+'/rest/v1/icash_integration_checks?on_conflict=provider');
 const body=JSON.parse(options.body);assert.equal(body.provider,'meta_lead_setup');assert.equal(body.result.status,'form_access_unverified');
 assert(!options.body.includes(token));return new Response('',{status:201});
}),true);assert.equal(writes,1);
console.log('PASS Meta setup: read-only form/Page/app binding, exact name/phone metadata, safe credential handling, private receipt, and no preview traffic.');
