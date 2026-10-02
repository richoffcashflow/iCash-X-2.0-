import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readOwnerForwarding,OwnerForwardingError} from '../lib/owner-forwarding-readiness.ts';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const key=randomBytes(24).toString('hex'),source=ownerInboundTarget.sourceNumber;
const env={CONTIGUITY_API_KEY:key,CONTIGUITY_FROM:source};
const fixture={object:'response',data:{number:source,call_forwarding:{enabled:true,to:ownerInboundTarget.ingressNumber,status:'active',estimated_completion:null}}};
let calls=0;
const transport=body=>async(url,options)=>{
 calls++;assert.equal(url,'https://api.contiguity.com/numbers/lease/'+encodeURIComponent(source)+'/call_forwarding');
 assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,'Bearer '+key);
 assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');
 return Response.json(body);
};
const ready=await readOwnerForwarding(env,transport(fixture));assert.equal(ready.routeConfigured,true);assert.equal(ready.callVerification,'not_tested');assert.equal(ready.forwardingCostVerified,false);assert(!JSON.stringify(ready).includes(key));
for(const f of [
 {enabled:false,to:null,status:'active',estimated_completion:null},
 {enabled:true,to:ownerInboundTarget.ingressNumber,status:'queued',estimated_completion:Date.now()+60000},
 {enabled:true,to:'+12145550123',status:'active',estimated_completion:null}
])assert.equal((await readOwnerForwarding(env,transport({...fixture,data:{number:source,call_forwarding:f}}))).routeConfigured,false);
for(const patch of [{CONTIGUITY_API_KEY:undefined},{CONTIGUITY_API_KEY:''},{CONTIGUITY_API_KEY:key+'\n'},{CONTIGUITY_FROM:'+12145550123'}]){
 const before=calls;await assert.rejects(readOwnerForwarding({...env,...patch},transport(fixture)),e=>e.code==='configuration_unavailable');assert.equal(calls,before);
}
for(const change of [
 x=>x.data.number='+12145550123',x=>x.object='error',x=>x.data.call_forwarding.enabled='true',
 x=>x.data.call_forwarding.to=null,x=>x.data.call_forwarding.status='pending',
 x=>x.data.call_forwarding.estimated_completion=123,x=>delete x.data.call_forwarding.status,
 x=>{x.data.call_forwarding.status='queued';x.data.call_forwarding.estimated_completion=null;},
 x=>{x.data.call_forwarding.enabled=false;x.data.call_forwarding.to=ownerInboundTarget.ingressNumber;}
]){const bad=structuredClone(fixture);change(bad);await assert.rejects(readOwnerForwarding(env,transport(bad)),e=>e.code==='provider_receipt_invalid');}
for(const [status,code] of [[400,'provider_request_rejected'],[401,'provider_auth_failed'],[403,'provider_access_denied'],[429,'provider_unavailable'],[500,'provider_unavailable']]){
 let count=0;await assert.rejects(readOwnerForwarding(env,async()=>{count++;return new Response(key,{status});}),e=>e.code===code&&!e.message.includes(key));assert.equal(count,1,'No retries or alternate authentication transport');
}
await assert.rejects(readOwnerForwarding(env,async()=>{throw Error(key);}),e=>e.code==='provider_unavailable'&&!e.message.includes(key));
await assert.rejects(readOwnerForwarding(env,async()=>new Response('<html>'+key,{headers:{'Content-Type':'text/html'}})),e=>e.code==='provider_receipt_invalid');
await assert.rejects(readOwnerForwarding(env,async()=>new Response(' '.repeat(65537),{headers:{'Content-Type':'application/json'}})),e=>e.code==='provider_receipt_invalid');
await assert.rejects(readOwnerForwarding(env,async()=>Response.json(fixture,{headers:{'Content-Length':'65537'}})),e=>e.code==='provider_receipt_invalid');
await assert.rejects(readOwnerForwarding(env,async()=>new Response(new ReadableStream({start(controller){controller.error(Error(key));}}),{headers:{'Content-Type':'application/json'}})),e=>e.code==='provider_unavailable'&&!e.message.includes(key));
let reads=0,auth='owner',providerError=null;
const route=await loadService('app/api/owner-inbound-acceptance/forwarding/route.ts',{
 NextResponse:{json:Response.json},ownerInboundTarget,OwnerForwardingError,
 workAccount:async()=>{if(auth==='signed_out')throw Error('SIGN_IN_REQUIRED');return {accountId:auth==='foreign_account'?'foreign':ownerInboundTarget.accountId,userId:auth==='foreign_user'?'foreign':ownerInboundTarget.ownerUserId};},
 readOwnerForwarding:async()=>{reads++;if(providerError)throw providerError;return ready;}
});
const request=new Request('https://test.invalid/api/owner-inbound-acceptance/forwarding');
auth='signed_out';assert.equal((await route.GET(request)).status,401);
for(const foreign of ['foreign_account','foreign_user']){auth=foreign;assert.equal((await route.GET(request)).status,403);}
auth='owner';assert.equal((await route.GET(new Request(request.url+'?source=other'))).status,400);assert.equal(reads,0);
const response=await route.GET(request);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.deepEqual(await response.json(),ready);assert.equal(reads,1);assert.equal(route.POST,undefined);
for(const code of ['configuration_unavailable','provider_auth_failed','provider_access_denied','provider_receipt_invalid']){providerError=new OwnerForwardingError(code);const failure=await route.GET(request);assert.equal(failure.status,503);assert.deepEqual(await failure.json(),{status:code});}
providerError=Error(key);assert.deepEqual(await (await route.GET(request)).json(),{status:'readiness_unavailable'});
console.log('Owner forwarding diagnostic: pinned owner/source, GET-only Bearer transport, active versus queued/disabled, strict receipts, redacted errors, no calls or configuration changes');
