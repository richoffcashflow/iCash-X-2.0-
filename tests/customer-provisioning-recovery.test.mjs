import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

let state;
const reset=()=>state={mode:'live',ack:true,credits:800,membership:true,review:false,paused:false,discovery:'discovery_configuration_required',voice:null,fail:false,provision:0,checks:0,paths:[]};
const deps={
 after:()=>{},recordSoftwareAccess:async()=>{},accountMode:()=>state.mode,
 currentUser:async()=>({id:'customer',email:'customer@example.invalid'}),
 membershipAccessible:()=>state.membership,workspaceAcknowledgmentCurrent:()=>state.ack,
 ownerInboundTarget:{ownerUserId:'owner'},NextResponse:{json:Response.json},
 liveWorkReady:()=>true,resolveRequestedPropertyMarket:async()=>({status:'not_requested'}),
 launchReadiness:async()=>{state.checks++;return {ready:state.voice==='enabled'&&!state.discovery,blockers:state.voice==='enabled'?[]:['voice']};},
 smsAccountReady:async()=>true,contactAccountReadiness:async()=>({ready:!state.discovery,quote:null}),
 discoveryAccountReadiness:async()=>({ready:!state.discovery,reason:state.discovery,quote:null}),
 db:async(path,method,body)=>{
  state.paths.push(path);
  if(path==='rpc/icash_load_workspace_account')return {accountId:'customer-account',account:{billingModel:'membership_credits',membership:{},balanceCents:state.credits,billingReview:state.review,paused:state.paused}};
  if(path==='rpc/icash_workspace_vip_access')return {vip:false};
  if(path.startsWith('icash_accounts?')){assert(path.includes('id=eq.customer-account&owner_user_id=eq.customer'));return [{}];}
  if(path.startsWith('icash_voice_configs?')){assert.equal(path,'icash_voice_configs?account_id=eq.customer-account&select=account_id&limit=1');return state.voice?[{account_id:'customer-account'}]:[];}
  assert.equal(path,'rpc/icash_provision_funded_account');assert.equal(method,'POST');assert.deepEqual(body,{p_account:'customer-account'});state.provision++;
  if(state.fail)throw Error('Private provider configuration');
  if(state.discovery==='discovery_configuration_required')state.discovery=null;
  if(!state.voice)state.voice='enabled';
  return {status:'configured',voice:{status:'configured'}};
 }
};
globalThis.__customerRecovery=deps;
const code=ts.transpileModule(readFileSync(new URL('../app/api/account/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {GET}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__customerRecovery;\n'+code).toString('base64'));
const get=async(core=false)=>{const r=await GET(new Request('https://www.geticashx.com/api/account'+(core?'?view=core':'')));assert.equal(r.status,200);return r.json();};

reset();let result=await get();assert.equal(state.provision,1,'A funded nationwide customer recovers missing setup without another payment');assert.equal(state.checks,2);assert.equal(result.workReady,true);assert.equal(result.balanceCents,800);assert.equal(result.paused,false);
await get();assert.equal(state.provision,1,'Healthy repeat loads do not reprovision');
reset();state.discovery=null;result=await get();assert.equal(state.provision,1,'Missing voice configuration also recovers');assert.equal(result.workReady,true);
for(const voice of ['disabled','expired']){reset();state.discovery=null;state.voice=voice;result=await get();assert.equal(state.provision,0,'An existing held voice configuration is not repaired by an account read');assert.equal(result.workReady,false);}
reset();state.voice='disabled';state.paused=true;result=await get();assert.equal(state.provision,1);assert.equal(state.voice,'disabled');assert.equal(result.paused,true);assert.equal(result.workReady,false,'Missing search recovery preserves a manual voice hold and Pause');
reset();state.fail=true;result=await get();assert.equal(state.provision,1);assert.equal(state.checks,1);assert.equal(result.workReady,false);assert.equal(result.discoveryBlocker,'discovery_configuration_required');assert.equal(result.balanceCents,800);assert(!JSON.stringify(result).includes('Private'));
for(const change of [{ack:false},{credits:0},{membership:false},{review:true},{mode:'test'}]){reset();Object.assign(state,change);await get();assert.equal(state.provision,0);assert.equal(state.checks,0);}
reset();result=await get(true);assert.equal(state.provision,0);assert.equal(state.checks,0);assert.equal(result.readinessPending,true);
reset();state.discovery='data_review_required';state.voice='enabled';result=await get();assert.equal(state.provision,0);assert.equal(result.discoveryBlocker,'data_review_required');
delete globalThis.__customerRecovery;
console.log('PASS customer provisioning recovery: nationwide/search/voice retries once, held accounts remain held, core stays fast, and payment balances survive setup failure. Fixture only.');
