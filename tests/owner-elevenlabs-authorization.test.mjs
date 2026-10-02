import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {prepareOwnerElevenLabsAuthorization as prepare,applyOwnerElevenLabsAuthorization as apply} from '../lib/owner-elevenlabs-authorization.ts';
import {ownerInboundTarget as target} from '../lib/owner-inbound-acceptance.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

// Fixtures only. No real provider key, secret value, provider request or mutation.
const env={ELEVENLABS_API_KEY:'SYNTHETIC_PROVIDER_KEY',ELEVENLABS_INBOUND_WEBHOOK_SECRET:'SYNTHETIC_INBOUND_SIGNING_SECRET_123456789'};
const hidden='PRIVATE_DATA_MUST_NOT_LEAVE_SERVER',sourceId='secret_SYNTHETIC_REFERENCE_ONLY',mainId='agtbrch_synthetic_main';
const hookKey='conversation_initiation_client_data_webhook',canonical='https://www.geticashx.com/api/internal/voice/inbound';
const base=`https://api.us.elevenlabs.io/v1/convai/agents/${target.agentId}`;
const urls={default:base,main:base+'?branch_id='+mainId,private:base+'?branch_id='+target.branchId,branches:base+'/branches?include_archived=true&limit=100',phone:`https://api.us.elevenlabs.io/v1/convai/phone-numbers/${target.phoneNumberId}`,procedures:base+'/branches/'+mainId+'/procedures'};
function state(){
 const main={agent_id:target.agentId,branch_id:mainId,main_branch_id:mainId,version_id:'agtvrsn_MAIN_1',name:'Synthetic Agent',metadata:{updated_at_unix_secs:1},
  conversation_config:{agent:{prompt:{prompt:hidden,tool_ids:['tool_unchanged'],llm:'model_unchanged'}}},platform_settings:{privacy:{record_voice:false},overrides:{enable_conversation_initiation_client_data_from_webhook:true},workspace_overrides:{unrelated:{protected:true},[hookKey]:{url:canonical,request_headers:{'Content-Type':'application/json',Accept:'application/json','X-Saved-Reference':{secret_id:'secret_another'}}}}},
  workflow:{nodes:{untouched:true}},procedures:{procedure_one:{procedure_id:'procedure_one',version_id:'procedure_version_one',name:hidden,referenced_tool_ids:['tool_unchanged']}},tags:['unchanged']};
 const privateAgent=structuredClone(main);privateAgent.branch_id=target.branchId;privateAgent.version_id='agtvrsn_PRIVATE_1';privateAgent.platform_settings.workspace_overrides[hookKey].request_headers={Authorization:{secret_id:sourceId}};
 const branches={results:[{id:mainId,agent_id:target.agentId,name:'Main',is_archived:false,current_live_percentage:100,draft_exists:false,last_committed_at:1,calls_7d:2},{id:target.branchId,agent_id:target.agentId,name:'Private',is_archived:false,current_live_percentage:0,draft_exists:false,last_committed_at:1,calls_7d:1}],meta:{total:2}};
 const phone={phone_number_id:target.phoneNumberId,phone_number:target.ingressNumber,provider:'twilio',assigned_agent:{agent_id:target.agentId,branch_id:null},label:hidden};
 const procedureList={procedures:[{...main.procedures.procedure_one,has_draft:false}]};
 return {main,private:privateAgent,branches,phone,procedureList};
}
const hook=s=>s.main.platform_settings.workspace_overrides[hookKey];
const source=s=>s.private.platform_settings.workspace_overrides[hookKey];
function fixture(initial=state(),options={}){
 const s=structuredClone(initial),calls=[],patches=[];
 const fetcher=async(url,request)=>{
  calls.push({url,method:request.method});assert(Object.values(urls).includes(url),'Only fixed US provider paths are permitted');
  assert.equal(request.headers['xi-api-key'],env.ELEVENLABS_API_KEY);assert.equal(request.cache,'no-store');assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');assert(request.signal instanceof AbortSignal);
  if(request.method==='PATCH'){
   assert.equal(url,urls.main);const patch=JSON.parse(request.body);patches.push(patch);
   if(options.beforePatch)await options.beforePatch(s,patch);
   if(options.patchChanges!==false){hook(s).request_headers=structuredClone(patch.platform_settings.workspace_overrides[hookKey].request_headers);s.main.version_id='agtvrsn_MAIN_2';s.main.metadata.updated_at_unix_secs=2;s.branches.results[0].last_committed_at=2;}
   if(options.afterPatch)options.afterPatch(s,patch);
   if(options.patchThrows)throw Error(hidden);
   return new Response(hidden,{status:options.patchStatus??200});
  }
  assert.equal(request.method,'GET');assert.equal(request.body,undefined);
  if(options.getResponse){const override=options.getResponse(url,s,calls);if(override)return override;}
  const receipt=url===urls.default?(options.defaultAgent?.(s)??s.main):url===urls.main?s.main:url===urls.private?s.private:url===urls.branches?s.branches:url===urls.procedures?s.procedureList:s.phone;
  return Response.json(receipt);
 };
 return {s,calls,patches,fetcher,prepare:()=>prepare(env,fetcher),apply:token=>apply(env,token,fetcher)};
}
function redacted(output){
 for(const value of [hidden,sourceId,target.agentId,target.branchId,target.phoneNumberId,target.ownerPhone,target.ingressNumber,env.ELEVENLABS_API_KEY,env.ELEVENLABS_INBOUND_WEBHOOK_SECRET])assert(!JSON.stringify(output).includes(value),'No private/provider configuration is returned');
 if(output.reviewToken){const payload=JSON.parse(Buffer.from(output.reviewToken.split('.')[0],'base64url').toString());assert.deepEqual(Object.keys(payload).sort(),['expires','fingerprint','nonce','op','v']);}
}
const f=fixture(),ready=await f.prepare();assert.equal(ready.status,'ready');redacted(ready);assert.equal(f.patches.length,0);assert.equal(f.calls.length,6);
assert.equal(ready.concurrencyProtection,'fresh_snapshot_check_only');assert.match(ready.fingerprint,/^[a-f0-9]{64}$/);
const success=await f.apply(ready.reviewToken);assert.equal(success.status,'verified_only_auth_changed');assert.equal(success.reason,'verified_only_auth_changed');assert.equal(success.providerRequestStatus,200);redacted(success);
assert.equal(f.patches.length,1);assert.deepEqual(Object.keys(f.patches[0]).sort(),['platform_settings','procedures','version_description']);
assert.deepEqual(f.patches[0].procedures,{procedure_one:{procedure_id:'procedure_one',version_id:'procedure_version_one'}});
assert.deepEqual(f.patches[0].platform_settings,{workspace_overrides:{[hookKey]:{url:canonical,request_headers:{...hook(state()).request_headers,Authorization:{secret_id:sourceId}}}}});
assert.equal(f.calls.length,19);assert.equal((await f.apply(ready.reviewToken)).status,'blocked');assert.equal(f.patches.length,1);
assert.equal((await f.prepare()).status,'no_change');assert.equal(f.patches.length,1);

for(const [mutate,reason] of [
 [s=>delete s.main.main_branch_id,'evidence_missing'],[s=>s.main.main_branch_id=target.branchId,'evidence_missing'],[s=>s.main.branch_id='wrong','evidence_missing'],
 [s=>delete s.main.version_id,'evidence_missing'],[s=>delete s.private.version_id,'evidence_missing'],[s=>delete s.main.conversation_config,'evidence_missing'],
 [s=>delete s.main.procedures,'evidence_missing'],[s=>s.main.procedures=null,'evidence_missing'],[s=>s.main.procedures.procedure_one.version_id=null,'drafts_present'],[s=>delete s.main.procedures.procedure_one.version_id,'drafts_present'],[s=>s.main.procedures.procedure_one.procedure_id='different','drafts_present'],[s=>s.private.procedures.procedure_one.version_id=null,'drafts_present'],
 [s=>delete s.branches.results[0].draft_exists,'evidence_missing'],[s=>s.branches.results[0].draft_exists=true,'drafts_present'],[s=>s.branches.results[1].draft_exists=true,'drafts_present'],[s=>s.branches.results[0].current_live_percentage=99,'routing_not_safe'],[s=>s.branches.results[1].current_live_percentage=1,'routing_not_safe'],[s=>delete s.branches.results[1].current_live_percentage,'evidence_missing'],[s=>s.branches.results[1].is_archived=true,'routing_not_safe'],[s=>s.branches.results[0].is_archived=true,'routing_not_safe'],[s=>s.branches.results.push(structuredClone(s.branches.results[0])),'evidence_missing'],[s=>s.branches.meta.total=3,'evidence_missing'],
 [s=>delete s.procedureList.procedures,'evidence_missing'],[s=>delete s.procedureList.procedures[0].has_draft,'evidence_missing'],[s=>s.procedureList.procedures[0].has_draft=true,'drafts_present'],[s=>s.procedureList.procedures[0].version_id=null,'drafts_present'],[s=>s.procedureList.procedures[0].version_id='different','evidence_missing'],[s=>s.procedureList.procedures=[],'evidence_missing'],[s=>s.procedureList.procedures.push(structuredClone(s.procedureList.procedures[0])),'evidence_missing'],
 [s=>delete s.phone.assigned_agent.branch_id,'routing_not_safe'],[s=>s.phone.assigned_agent.branch_id=target.branchId,'routing_not_safe'],[s=>s.phone.assigned_agent.agent_id='foreign','routing_not_safe'],[s=>s.phone.phone_number='+10000000000','routing_not_safe'],[s=>s.phone.provider='foreign','routing_not_safe'],
 [s=>hook(s).url='https://geticashx.com/api/internal/voice/inbound','evidence_missing'],[s=>source(s).url='https://foreign.invalid','evidence_missing'],[s=>hook(s).extra='unsafe','evidence_missing'],[s=>s.main.platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook=false,'evidence_missing'],
 [s=>source(s).request_headers={Authorization:'Bearer '+hidden},'source_reference_invalid'],[s=>source(s).request_headers.Authorization={secret_id:sourceId,value:hidden},'source_reference_invalid'],[s=>source(s).request_headers.Authorization={secret_id:'{{secret}}'},'source_reference_invalid'],[s=>source(s).request_headers.Authorization={secret_id:''},'source_reference_invalid'],[s=>source(s).request_headers.Authorization={secret_id:'masked_reference'},'source_reference_invalid'],[s=>source(s).request_headers={Authorization:{secret_id:sourceId},authorization:{secret_id:sourceId}},'unsafe_headers'],
 [s=>hook(s).request_headers['X-API-Key']=hidden,'unsafe_headers'],[s=>hook(s).request_headers.Accept='application/json\r\nX: y','unsafe_headers'],[s=>hook(s).request_headers.accept='application/json','unsafe_headers'],[s=>hook(s).request_headers['bad\r\nname']='application/json','unsafe_headers'],[s=>hook(s).request_headers['X-Saved-Reference']={secret_id:sourceId,secret:hidden},'unsafe_headers'],
 ]){const initial=state();mutate(initial);const x=fixture(initial),out=await x.prepare();assert.equal(out.status,'blocked');assert.equal(out.reason,reason);assert.equal(x.patches.length,0);redacted(out);}
for(const assignedBranch of [null,mainId]){const initial=state();initial.phone.assigned_agent.branch_id=assignedBranch;assert.equal((await fixture(initial).prepare()).status,'ready');}
const empty=state();empty.main.procedures={};empty.procedureList.procedures=[];const e=fixture(empty),er=await e.prepare();assert.equal((await e.apply(er.reviewToken)).status,'verified_only_auth_changed');assert.deepEqual(e.patches[0].procedures,{});
const mixed=state();source(mixed).request_headers={aUtHoRiZaTiOn:{secret_id:sourceId}};assert.equal((await fixture(mixed).prepare()).status,'ready');
for(const value of [{secret_id:sourceId},'arbitrary existing value',null]){const initial=state();hook(initial).request_headers.aUtHoRiZaTiOn=value;const x=fixture(initial);assert.equal((await x.prepare()).status,'no_change');assert.equal(x.patches.length,0);}
const mismatch=fixture(state(),{defaultAgent:s=>({...s.main,name:'changed'})});assert.equal((await mismatch.prepare()).reason,'evidence_missing');

for(const change of [s=>s.main.conversation_config.agent.prompt.llm='changed',s=>s.main.version_id='agtvrsn_OTHER',s=>s.private.version_id='agtvrsn_PRIVATE_CHANGED',s=>s.phone.label='changed',s=>s.branches.results[0].last_committed_at=200,s=>s.main.workflow.nodes.untouched=false,s=>s.main.procedures.procedure_one.name='changed']){
 const x=fixture(),review=await x.prepare();change(x.s);const out=await x.apply(review.reviewToken);assert.equal(out.reason,'configuration_changed');assert.equal(x.patches.length,0);
}
const volatile=fixture(),vr=await volatile.prepare();volatile.s.main.metadata.updated_at_unix_secs=999;volatile.s.branches.results[0].calls_7d=999;assert.equal((await volatile.apply(vr.reviewToken)).status,'verified_only_auth_changed');

for(const options of [
 {patchThrows:true},{patchStatus:500},{patchStatus:403,patchChanges:false},{patchChanges:false},
 {afterPatch:s=>s.main.conversation_config.agent.prompt.llm='unexpected'},
 {afterPatch:s=>s.main.workflow.nodes.untouched=false},
 {afterPatch:s=>s.main.platform_settings.privacy.record_voice=true},
 {afterPatch:s=>s.main.procedures.procedure_one.version_id='unexpected'},
 {afterPatch:s=>s.private.name='unexpected'},
 {afterPatch:s=>s.phone.assigned_agent.branch_id=target.branchId},
 {afterPatch:s=>s.branches.results[1].current_live_percentage=1},
 {afterPatch:s=>s.branches.results[0].draft_exists=true},
 {afterPatch:s=>s.procedureList.procedures[0].has_draft=true},
 {afterPatch:s=>s.procedureList.procedures[0].name='changed'},
 {afterPatch:s=>s.main.version_id='agtvrsn_MAIN_1'},
 {afterPatch:s=>hook(s).request_headers.Authorization={secret_id:'unexpected'}},
 {getResponse:(url,s,calls)=>calls.some(c=>c.method==='PATCH')?new Response(hidden,{status:503}):null},
 ]){const x=fixture(state(),options),review=await x.prepare(),out=await x.apply(review.reviewToken);assert.equal(out.status,'outcome_unknown');assert.equal(x.patches.length,1);assert(x.calls.slice(x.calls.findIndex(c=>c.method==='PATCH')+1).every(c=>c.method==='GET'));assert.equal((await x.apply(review.reviewToken)).status,'blocked');assert.equal(x.patches.length,1);redacted(out);}
let unblock;const concurrency=fixture(state(),{beforePatch:()=>new Promise(resolve=>unblock=resolve)}),cr=await concurrency.prepare();const first=concurrency.apply(cr.reviewToken);while(!unblock)await new Promise(resolve=>setImmediate(resolve));assert.equal((await concurrency.apply(cr.reviewToken)).status,'blocked');unblock();assert.equal((await first).status,'verified_only_auth_changed');assert.equal(concurrency.patches.length,1);

const forged=fixture(),fr=await forged.prepare();for(const token of [undefined,'',fr.reviewToken+'extra',fr.reviewToken.slice(0,-3)+'xyz']){const count=forged.calls.length;assert.equal((await forged.apply(token)).reason,'invalid_review');assert.equal(forged.calls.length,count);}
assert.equal((await apply(env,fr.reviewToken,forged.fetcher,Date.now()+130000)).reason,'review_expired');
const payload=JSON.parse(Buffer.from(fr.reviewToken.split('.')[0],'base64url').toString());payload.fingerprint='a'.repeat(64);const enc=Buffer.from(JSON.stringify(payload)).toString('base64url'),sig=createHmac('sha256',env.ELEVENLABS_INBOUND_WEBHOOK_SECRET).update('icash-elevenlabs-auth-review-v1\0'+enc).digest('base64url');assert.equal((await forged.apply(enc+'.'+sig)).reason,'configuration_changed');assert.equal(forged.patches.length,0);
for(const replacement of [()=>new Response(hidden,{status:401}),()=>new Response(hidden,{status:403}),()=>new Response(hidden,{status:500}),()=>Response.json([]),()=>new Response('not json',{headers:{'content-type':'application/json'}}),()=>Response.json(state().main,{headers:{'Content-Length':'2000000'}}),()=>new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}}),()=>{throw Error(hidden);},()=>{const r=Response.json(state().main);Object.defineProperty(r,'url',{value:'https://foreign.invalid'});return r;}]){
 const x=fixture(state(),{getResponse:replacement}),out=await x.prepare();assert.equal(out.status,'blocked');assert.equal(x.patches.length,0);redacted(out);
}
for(const injected of [{},{...env,ELEVENLABS_API_KEY:'bad\nkey'},{...env,ELEVENLABS_INBOUND_WEBHOOK_SECRET:'short'}]){let calls=0;const out=await prepare(injected,async()=>{calls++;throw Error();});assert.equal(out.reason,'configuration_unavailable');assert.equal(calls,0);}
globalThis.window={};assert.equal((await prepare(env,()=>{throw Error('should not fetch');})).reason,'configuration_unavailable');delete globalThis.window;

let identity='owner',prepares=0,applies=0;
const route=await loadService('app/api/owner-inbound-acceptance/elevenlabs/authorization/route.ts',{
 NextResponse:{json:Response.json},ownerInboundTarget:target,process:{env},
 workAccount:async()=>{if(identity==='signed_out')throw Error('SIGN_IN_REQUIRED');return {accountId:identity==='wrong_account'?'foreign':target.accountId,userId:identity==='wrong_user'?'foreign':target.ownerUserId};},
 prepareOwnerElevenLabsAuthorization:async injected=>{assert.deepEqual(injected,env);prepares++;return ready;},
 applyOwnerElevenLabsAuthorization:async(injected,token)=>{assert.deepEqual(injected,env);assert.equal(token,ready.reviewToken);applies++;return success;},
});
const routeUrl='https://app.test/api/owner-inbound-acceptance/elevenlabs/authorization';
const request=(method='GET',changes={})=>new Request(changes.url??routeUrl,{method,headers:{host:'app.test',...(method==='POST'?{origin:'https://app.test','content-type':'application/json'}:{}),...changes.headers},...(method==='POST'?{body:changes.body??JSON.stringify({reviewToken:ready.reviewToken})}:{})});
for(const who of ['signed_out','wrong_account','wrong_user']){identity=who;for(const method of ['GET','POST'])assert.equal((await route[method](request(method))).status,who==='signed_out'?401:403);}
assert.equal(prepares+applies,0);identity='owner';
for(const method of ['GET','POST']){
 assert.equal((await route[method](request(method,{url:routeUrl+'?agent_id=other'}))).status,400);
 assert.equal((await route[method](request(method,{headers:{host:'foreign'}}))).status,400);
 assert.equal((await route[method](request(method,{headers:{origin:'https://foreign'}}))).status,403);
 assert.equal((await route[method](request(method,{headers:{'sec-fetch-site':'cross-site'}}))).status,403);
}
for(const bad of [JSON.stringify({reviewToken:ready.reviewToken,agentId:'foreign'}),'null','[]','{}','{"reviewToken":42}','invalid','x'.repeat(5000)])assert.equal((await route.POST(request('POST',{body:bad}))).status,400);
assert.equal((await route.POST(request('POST',{headers:{'content-type':'text/plain'}}))).status,415);
assert.equal((await route.POST(request('POST',{headers:{'content-length':'invalid'}}))).status,400);
assert.equal((await route.POST(request('POST',{headers:{origin:''}}))).status,403);
assert.equal(prepares+applies,0);
const gr=await route.GET(request());assert.equal(gr.status,200);assert.deepEqual(await gr.json(),ready);assert.equal(gr.headers.get('cache-control'),'private, no-store, max-age=0');
const pr=await route.POST(request('POST'));assert.equal(pr.status,200);assert.deepEqual(await pr.json(),success);assert.equal(prepares,1);assert.equal(applies,1);assert.equal(route.maxDuration,120);assert.equal(route.PATCH,undefined);
const sourceCode=readFileSync('lib/owner-elevenlabs-authorization.ts','utf8');assert(!sourceCode.includes('process.env'));assert(!/console\./.test(sourceCode));assert(!sourceCode.includes('/v1/convai/secrets'));assert(!/method:'(?:PUT|DELETE)'/.test(sourceCode));
console.log('Owner Authorization repair: strict owner/same-origin JSON, signed expiring review, fresh full snapshots, published procedure pins, reference-only single PATCH, redaction, no retry and exact post-read verification passed');
