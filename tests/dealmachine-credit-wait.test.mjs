import assert from 'node:assert/strict';
import {refreshDealMachineCreditWait,readDealMachineCreditReceipt} from '../lib/dealmachine-credit-wait.ts';
import {finishAdmittedDealMachineRequest} from '../lib/dealmachine-request.ts';

const env={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),DEALMACHINE_API_KEY:'dm_sk_live_fixture'};
const checkId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222';
const usage={plan:{name:'Fixture',is_paid:true},billing_cycle:{start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z'},credits:{total_cap:100000,total_available:0,used:109339}};
function fixture({claim=null,body=usage,status=200,network=false,oversize=false,loss=false,writeFails=false,recordStatus='provider_credit_exhausted'}={}){
 const calls=[],writes=[],finishes=[];let admitted=false,recorded=false;
 const db=async(path,method,input)=>{
  assert.equal(method,'POST');
  if(path==='rpc/icash_claim_dealmachine_credit_check'){
   assert.deepEqual(input,{p_release:env.VERCEL_GIT_COMMIT_SHA});
   if(admitted)return null;admitted=true;return claim;
  }
  if(path==='rpc/icash_dealmachine_credit_status')return {status:'provider_credit_exhausted',nextCheckAt:'2026-11-17T19:00:00Z'};
  if(path==='rpc/icash_finish_dealmachine_request'){finishes.push(input);return true;}
  if(path==='rpc/icash_record_dealmachine_credit_check'){
   assert.equal(input.p_check,checkId);writes.push(input.p_receipt);
   if(writeFails)throw Error('persistence unavailable');
   if(recorded)assert.deepEqual(input.p_receipt,writes[0]);
   const first=!recorded;recorded=true;
   if(loss&&first)throw Error('saved; response lost');
   return recordStatus;
  }
  throw Error('Unexpected RPC '+path);
 };
 const transport=async(url,options)=>{
  calls.push({url,options});assert.equal(url,'https://api.v2.dealmachine.com/v1/usage');
  assert.equal(options.method,'GET');assert.equal(options.body,undefined);
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  assert.equal(options.headers.Authorization,'Bearer dm_sk_live_fixture');
  assert.equal(options.headers['Cache-Control'],'no-cache, max-age=0');
  assert(options.signal instanceof AbortSignal);
  if(network)throw Error('transport unavailable');
  const headers={'Content-Type':'application/json','Date':'Tue, 17 Nov 2026 18:45:00 GMT','Age':'0','X-RateLimit-Remaining':'20','X-RateLimit-Day-Remaining':'3000'};
  return new Response(oversize?'x'.repeat(65537):typeof body==='string'?body:JSON.stringify(body),{status,headers});
 };
 return {calls,writes,finishes,run:overrides=>refreshDealMachineCreditWait(db,transport,{...env,...overrides})};
}
for(const override of [{VERCEL_ENV:'preview'},{DEALMACHINE_API_KEY:''},{VERCEL_GIT_COMMIT_SHA:''}]){
 const f=fixture({claim:{checkId,requestId}});assert.equal((await f.run(override)).status,'credit_check_not_requested');assert.equal(f.calls.length,0);
}
const idle=fixture();assert.equal((await idle.run()).status,'provider_credit_exhausted');assert.equal(idle.calls.length,0);
for(const [body,recordStatus] of [[usage,'provider_credit_exhausted'],[{...usage,credits:{...usage.credits,total_available:25}},'provider_credit_available']]){
 const f=fixture({claim:{checkId,requestId},body,recordStatus,loss:true});
 assert.equal((await f.run()).status,recordStatus);assert.equal(f.calls.length,1);assert.equal(f.writes.length,2);
 assert.deepEqual(f.writes[0].raw,body);assert.equal(JSON.parse(f.writes[0].rawText).credits.used,109339);
 assert.equal(f.finishes.length,1);assert.equal(f.finishes[0].p_request,requestId);
 assert(!('creditsUsed' in f.finishes[0].p_result),'Cumulative usage must never be recorded as this GET’s charge');
 assert(!('returned' in f.finishes[0].p_result));assert.equal(f.finishes[0].p_result.httpStatus,200);
 await f.run();assert.equal(f.calls.length,1,'A saved check never retries its provider GET');
}
for(const option of [{network:true},{oversize:true},{body:'not JSON'},{status:503},{writeFails:true}]){
 const f=fixture({claim:{checkId,requestId},recordStatus:'credit_check_held',...option});
 const result=await f.run();assert(['credit_check_held','credit_check_unavailable'].includes(result.status));
 assert.equal(f.calls.length,1);assert(f.writes.length>=1);assert(!('creditsUsed' in f.finishes[0].p_result));
 await f.run();assert.equal(f.calls.length,1,'Uncertainty cannot replay a usage request');
}
for(const claim of [{checkId:'bad',requestId},{checkId,requestId:'bad'},{}]){
 const f=fixture({claim});assert.equal((await f.run()).status,'credit_check_unavailable');assert.equal(f.calls.length,0);
}
{
 const writes=[];let refusalSaves=0,requests=0;
 const refusalBody={error:{code:'export_limit_exceeded',message:'Data credit limit reached for this billing cycle.',request_id:'req_fixture',details:{remaining_credits:0}},usage:{credits_used:109339,credits_remaining:0}};
 const rawText=JSON.stringify(refusalBody,null,2);
 const db=async(path,method,body)=>{writes.push({path,body});if(path==='rpc/icash_record_dealmachine_credit_refusal'){if(++refusalSaves===1)throw Error('saved; acknowledgement lost');return 'provider_credit_exhausted';}return true;};
 const result=await finishAdmittedDealMachineRequest(db,requestId,async()=>{requests++;return new Response(rawText,{status:402});});
 assert.equal(result.status,402);assert.deepEqual(result.raw,refusalBody);assert.equal(requests,1);
 assert.equal(writes[0].path,'rpc/icash_finish_dealmachine_request','The original request finishes before refusal binding');
 assert.equal(writes[0].body.p_result.creditsUsed,null,'Usage totals never become the failed original’s charge');
 assert.equal(refusalSaves,2);assert.equal(writes[1].body.p_request,requestId);
 assert.equal(writes[1].body.p_receipt.rawText,rawText);assert.deepEqual(writes[1],writes[2]);
}
{
 const neverCancel=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65537));},cancel(){return new Promise(()=>{});}});
 await assert.rejects(()=>readDealMachineCreditReceipt(new Response(neverCancel)),/CREDIT_RESPONSE_TOO_LARGE/);
}
for(const failedFinishes of [1,2]){
 let finishes=0,gets=0,saves=0;
 const db=async(path)=>{
  if(path==='rpc/icash_finish_dealmachine_request'){if(++finishes<=failedFinishes)throw Error('finish unavailable');return true;}
  if(path==='rpc/icash_record_dealmachine_credit_refusal'){saves++;return finishes>failedFinishes?'provider_credit_exhausted':'credit_check_held';}
  assert.fail(path);
 };
 const run=()=>finishAdmittedDealMachineRequest(db,requestId,async()=>{gets++;return Response.json({error:{code:'export_limit_exceeded'}},{status:402});});
 if(failedFinishes===1)assert.equal((await run()).status,402);else await assert.rejects(run,/PROVIDER_CREDIT_EVIDENCE_UNAVAILABLE/);
 assert.equal(finishes,2);assert.equal(saves,1);assert.equal(gets,1,'Metrics or journal failure never repeats a provider request');
}
console.log('PASS credit-wait transport: one authenticated free usage GET per durable claim, immutable bounded receipts, early refill, no usage-as-charge, no replay or paid endpoint.');
