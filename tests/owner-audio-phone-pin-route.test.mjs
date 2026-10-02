import assert from 'node:assert/strict';
import {ownerInboundTarget as target} from '../lib/owner-inbound-acceptance.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
let identity='owner',saved=null,run=null,events=[],saveError=false,tokenError=false,readError=false,restoreAllowed=true;
const env={ELEVENLABS_API_KEY:'fixture',ELEVENLABS_INBOUND_WEBHOOK_SECRET:'fixture'};
const reviewToken='synthetic_signed_review';
const ready={status:'ready',message:'Ready',reviewToken,expiresAt:new Date(Date.now()+120000).toISOString()};
const pinned={...ready,status:'pinned',message:'Pinned',expiresAt:new Date(Date.now()-20000).toISOString()};
const restored={...pinned,status:'restored',message:'Restored'};
let inspection=pinned;
const route=await loadService('app/api/owner-inbound-acceptance/audio-once/phone-pin/route.ts',{
 NextResponse:{json:Response.json},ownerInboundTarget:target,process:{env},
 workAccount:async()=>{if(identity==='signed_out')throw Error('SIGN_IN_REQUIRED');return {accountId:identity==='wrong_account'?'foreign':target.accountId,userId:identity==='wrong_user'?'foreign':target.ownerUserId};},
 db:async(path,method,body)=>{events.push('db');if(path==='rpc/icash_start_owner_audio_phone_restore'){assert.equal(method,'POST');assert.deepEqual(body,{p_review_token:reviewToken});return restoreAllowed;}assert(path.startsWith('icash_owner_audio_once?id=eq.1&select='));return run?[run]:[];},
 savedAudioPhonePinReview:async()=>{events.push('saved');if(readError)throw Error('private');return saved;},
 saveAudioPhonePinReview:async token=>{events.push('save');assert.equal(token,reviewToken);if(saveError)throw Error('private');saved=token;},
 assertPinReviewCurrent:(injected,token)=>{events.push('validate');assert.deepEqual(injected,env);assert.equal(token,reviewToken);if(tokenError)throw Error('review_expired');},
 prepareOwnerAudioPhonePin:async injected=>{events.push('prepare');assert.deepEqual(injected,env);return ready;},
 applyOwnerAudioPhonePin:async(injected,token)=>{events.push('pin');assert.deepEqual(injected,env);assert.equal(token,reviewToken);return pinned;},
 restoreOwnerAudioPhonePin:async(injected,token)=>{events.push('restore');assert.deepEqual(injected,env);assert.equal(token,reviewToken);return restored;},
 inspectOwnerAudioPhonePin:async(injected,token)=>{events.push('inspect');assert.deepEqual(injected,env);assert.equal(token,reviewToken);return inspection;},
});
const url='https://app.test/api/owner-inbound-acceptance/audio-once/phone-pin';
const request=(method='GET',changes={})=>new Request(changes.url??url,{method,headers:{host:'app.test',...(method==='POST'?{origin:'https://app.test','content-type':'application/json'}:{}),...changes.headers},...(method==='POST'?{body:changes.body??JSON.stringify({action:changes.action??'pin',reviewToken})}:{})});
for(const who of ['signed_out','wrong_account','wrong_user']){identity=who;for(const method of ['GET','POST'])assert.equal((await route[method](request(method))).status,who==='signed_out'?401:403);}
assert.deepEqual(events,[]);identity='owner';
for(const method of ['GET','POST']){
 assert.equal((await route[method](request(method,{url:url+'?phone_id=other'}))).status,400);
 assert.equal((await route[method](request(method,{headers:{host:'foreign'}}))).status,400);
 assert.equal((await route[method](request(method,{headers:{origin:'https://foreign'}}))).status,403);
 assert.equal((await route[method](request(method,{headers:{'sec-fetch-site':'cross-site'}}))).status,403);
}
for(const body of [JSON.stringify({action:'pin',reviewToken,phoneId:'foreign'}),'null','[]','{}',JSON.stringify({action:'pin',reviewToken:42}),JSON.stringify({action:'pin',reviewToken:''}),JSON.stringify({action:'other',reviewToken}),'invalid','x'.repeat(5000)])assert.equal((await route.POST(request('POST',{body}))).status,400);
assert.equal((await route.POST(request('POST',{headers:{'content-type':'text/plain'}}))).status,415);
assert.equal((await route.POST(request('POST',{headers:{'content-length':'invalid'}}))).status,400);
assert.equal((await route.POST(request('POST',{headers:{origin:''}}))).status,403);
assert.deepEqual(events,[]);
let response=await route.GET(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),ready);assert.deepEqual(events,['saved','prepare']);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
events=[];response=await route.POST(request('POST'));assert.equal(response.status,200);assert.deepEqual(await response.json(),pinned);assert.deepEqual(events,['validate','db','save','pin']);
events=[];response=await route.GET(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),pinned);assert.deepEqual(events,['saved','inspect']);
events=[];tokenError=true;assert.equal((await route.POST(request('POST'))).status,503);assert.deepEqual(events,['validate']);tokenError=false;
events=[];run={id:1};assert.equal((await route.POST(request('POST'))).status,409);assert.deepEqual(events,['validate','db']);run=null;
events=[];saveError=true;assert.equal((await route.POST(request('POST'))).status,503);assert.deepEqual(events,['validate','db','save']);saveError=false;
events=[];saved='different';assert.equal((await route.POST(request('POST',{action:'restore'}))).status,409);assert.deepEqual(events,['saved']);saved=reviewToken;
events=[];inspection={...pinned,expiresAt:new Date(Date.now()+100000).toISOString()};response=await route.POST(request('POST',{action:'restore'}));assert.equal(response.status,409);assert.deepEqual(events,['saved','inspect']);inspection=pinned;
restoreAllowed=false;events=[];response=await route.POST(request('POST',{action:'restore'}));assert.equal(response.status,409);assert.equal((await response.json()).status,'restore_wait_for_call');assert.deepEqual(events,['saved','inspect','db']);
restoreAllowed=true;events=[];response=await route.POST(request('POST',{action:'restore'}));assert.equal(response.status,200);assert.deepEqual(await response.json(),restored);assert.deepEqual(events,['saved','inspect','db','restore']);
inspection={...restored,expiresAt:new Date(Date.now()+120000).toISOString()};for(const method of ['GET','POST']){events=[];response=await route[method](request(method,{action:'inspect'}));assert.equal(response.status,200);assert.equal((await response.json()).status,'outcome_unknown');assert(!events.includes('restore'));assert(!events.includes('pin'));}
inspection=restored;response=await route.GET(request());assert.equal((await response.json()).status,'restored');
readError=true;response=await route.GET(request());assert.equal(response.status,503);assert(!JSON.stringify(await response.json()).includes('private'));readError=false;
assert.equal(route.maxDuration,120);assert.equal(route.PATCH,undefined);
console.log('Phone pin route passed: owner/CSRF/body bounds, signed-token validation and durable save before pin, recovery reads, no overwrite retries, pending-pin settling guard and atomic restore authorization gate');
