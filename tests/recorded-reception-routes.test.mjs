// LOCAL SYNTHETIC ROUTE TESTS ONLY. Imports are injected; no external calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import {timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {privateHeaders,uuid} from '../lib/required-call-recording.ts';
import {recordedReceptionPresentation} from '../lib/recorded-reception-presentation.ts';
import {recordedReceptionPolicy} from '../lib/recorded-reception.ts';
import {rejectTwiml} from '../lib/general-reception.ts';

globalThis.fetch=async()=>{throw Error('UNEXPECTED_EXTERNAL_NETWORK_IN_SYNTHETIC_TEST');};
const account='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',foreign='33333333-3333-4333-8333-333333333333';
const root='https://www.geticashx.com',noStore=response=>assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');

test('recorded incoming callbacks forward the unchanged request and signal to the dedicated service',async()=>{
  for(const method of ['inbound','consent','status','terminal','stop']){
    const request=new Request(root+'/api/reception/recorded/'+method,{method:'POST',body:'synthetic-only'}),expected=new Response('fixture',{headers:privateHeaders});let calls=0;
    const route=await loadService('app/api/reception/recorded/'+method+'/route.ts',{privateHeaders,rejectTwiml,process:{env:{ICASH_RECORDED_RECEPTION_READY:'true'}},recordedReceptionServer:signal=>{assert.equal(signal,request.signal);return {[method]:async actual=>{calls++;assert.equal(actual,request);return expected;}};}});
    assert.equal(await route.POST(request),expected);assert.equal(calls,1);assert.equal(route.runtime,'nodejs');assert.equal(route.dynamic,'force-dynamic');assert.equal(route.maxDuration,20);assert.equal(route.GET,undefined);
  }
});
test('callback wrapper errors fail closed without exposing provider internals',async()=>{
  for(const method of ['inbound','consent','status','terminal','stop']){
    const route=await loadService('app/api/reception/recorded/'+method+'/route.ts',{privateHeaders,rejectTwiml,process:{env:{ICASH_RECORDED_RECEPTION_READY:'true'}},recordedReceptionServer:()=>{throw Error('secret-synthetic-provider-detail');}});
    const response=await route.POST(new Request(root+'/api/reception/recorded/'+method,{method:'POST'}));noStore(response);const text=await response.text();assert(!text.includes('secret-synthetic-provider-detail'));assert(!text.includes('<Connect'));if(['inbound','consent'].includes(method))assert.match(text,/<Hangup/);else assert.equal(response.status,503);
  }
});
test('maintenance requires its exact secret and schema release, independently of capture and bot pause',async()=>{
  const env={CRON_SECRET:'synthetic-cron-secret-fixture-only'.padEnd(40,'x'),ICASH_RECORDED_RECEPTION_SCHEMA_READY:'false',ICASH_RECORDED_RECEPTION_READY:'false',RECEPTION_ENABLED:'false',BOT_PAUSED:'true'},events=[];
  const provider={fixture:true};let fail=false;
  const route=await loadService('app/api/reception/recorded/maintenance/route.ts',{privateHeaders,timingSafeEqual,process:{env},db:async(path,method,body)=>{events.push({path,method,body});return [];},createRecordedReceptionProviders:actual=>{assert.equal(actual,env);events.push('provider');return provider;},maintainRecordedReception:async(rpc,actual,settings)=>{events.push('maintain');assert.equal(actual,provider);assert.equal(settings,env);if(fail)throw Error('private-provider-detail');await rpc('icash_claim_recorded_reception_work',{p_kind:'delete',p_limit:5});return {deleted:1,reconciled:0,settled:0,held:0};}});
  const request=authorization=>new Request(root+'/api/reception/recorded/maintenance',{method:'POST',headers:authorization?{authorization}:{}});
  for(const token of [undefined,'Bearer incorrect','Basic '+env.CRON_SECRET]){const response=await route.POST(request(token));assert.equal(response.status,401);noStore(response);assert.deepEqual(events,[]);}
  const auth='Bearer '+env.CRON_SECRET;let response=await route.POST(request(auth));assert.deepEqual(await response.json(),{status:'schema_not_released'});assert.deepEqual(events,[]);
  env.ICASH_RECORDED_RECEPTION_SCHEMA_READY='true';response=await route.POST(request(auth));assert.equal(response.status,200);noStore(response);assert.equal((await response.json()).deleted,1);assert.equal(events[2].path,'rpc/icash_claim_recorded_reception_work');assert.equal(events[2].method,'POST');assert.equal(route.GET,route.POST);assert.equal(route.maxDuration,60);
  fail=true;response=await route.POST(request(auth));assert.equal(response.status,503);assert(!JSON.stringify(await response.json()).includes('private-provider-detail'));
});
test('private audio wrapper derives account from authenticated session and forwards exact range',async()=>{
  const events=[];let signedIn=true,throws=false;
  const route=await loadService('app/api/work/reception-recording/audio/route.ts',{privateHeaders,uuid,workAccount:async()=>{events.push('account');if(!signedIn)throw Error('SIGN_IN_REQUIRED');return {accountId:account};},recordedReceptionServer:signal=>({audio:async(...args)=>{events.push({args,signal});if(throws)throw Error('private-provider-detail');return new Response('synthetic-audio',{headers:privateHeaders});}})});
  const request=url=>new Request(url,{headers:{range:'bytes=0-3'}});
  for(const query of ['', '?id=invalid','?id='+id+'&accountId='+foreign,'?id='+id+'&id='+foreign]){events.length=0;assert.equal((await route.GET(request(root+'/api/work/reception-recording/audio'+query))).status,404);assert.deepEqual(events,['account']);}
  const req=request(root+'/api/work/reception-recording/audio?id='+id);events.length=0;let response=await route.GET(req);assert.equal(response.status,200);assert.deepEqual(events[1].args,[account,id,'bytes=0-3']);assert.equal(events[1].signal,req.signal);noStore(response);
  signedIn=false;events.length=0;response=await route.GET(req);assert.equal(response.status,404);assert.deepEqual(events,['account']);
  signedIn=true;throws=true;response=await route.GET(req);assert.equal(response.status,404);assert(!String(await response.text()).includes('private-provider-detail'));assert.equal(route.POST,undefined);
});
const row=()=>({id,account_id:account,created_at:new Date().toISOString(),state:'available',recording_sid:'RE'+'a'.repeat(32),consent_at:'2026-10-03T00:00:00Z',start_claimed_at:'2026-10-03T00:00:00Z',conversation_id:'conv_fixture',call_ended_at:'2026-10-03T00:00:01Z',audio_expires_at:new Date(Date.now()+3600000).toISOString(),deleted_at:null,duration_seconds:60,max_total_seconds:600,charge_cap_cents:479,provider_recording_price_micros:null,pricing_policy:{version:recordedReceptionPolicy},setup_confirmed_at:'2026-10-03T00:00:00Z',nonce_hash:'private-nonce',stop_token_hash:'private-capability',from_phone:'+12125550199',configuration:{secret:'private-config'}});
test('receipt list remains schema-off, account-scoped, bounded and allowlisted',async()=>{
  const env={ICASH_RECORDED_RECEPTION_SCHEMA_READY:'false'},calls=[];let signedIn=true,rows=[row()],single=row();
  const route=await loadService('app/api/work/reception-recording/route.ts',{privateHeaders,uuid,recordedReceptionPresentation,process:{env},workAccount:async()=>{if(!signedIn)throw Error('SIGN_IN_REQUIRED');return {accountId:account};},db:async(path,method,body)=>{calls.push({path,method,body});return path.endsWith('icash_get_recorded_reception_session')?single:rows;}});
  const request=query=>new Request(root+'/api/work/reception-recording'+query);
  let response=await route.GET(request(''));assert.deepEqual(await response.json(),{recordings:[]});assert.deepEqual(calls,[]);
  env.ICASH_RECORDED_RECEPTION_SCHEMA_READY='true';response=await route.GET(request(''));noStore(response);assert.equal(response.status,200);const result=await response.json();assert.equal(result.recordings.length,1);assert.deepEqual(calls[0],{path:'rpc/icash_list_recorded_reception_sessions',method:'POST',body:{p_account:account,p_limit:20}});for(const key of ['private-capability','private-nonce','private-config','from_phone'])assert(!JSON.stringify(result).includes(key));
  response=await route.GET(request('?id='+id));assert.equal(response.status,200);assert.deepEqual(calls.at(-1).body,{p_id:id,p_account:account,p_operation:null});single={...row(),account_id:foreign};assert.equal((await route.GET(request('?id='+id))).status,404);
  for(const query of ['?id=invalid','?accountId='+foreign,'?id='+id+'&extra=1','?id='+id+'&id='+foreign]){const before=calls.length;assert.equal((await route.GET(request(query))).status,400);assert.equal(calls.length,before);}
  for(const bad of [[{...row(),account_id:foreign}],Array.from({length:21},row),null]){rows=bad;response=await route.GET(request(''));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Reception recordings unavailable.'});}
  signedIn=false;const before=calls.length;response=await route.GET(request(''));assert.equal(response.status,503);assert.equal(calls.length,before);assert.equal(route.POST,undefined);
});
test('recording UI uses only tenant playback route, explicit expiry, and estimated-cost labels',()=>{
  const ui=readFileSync('components/reception-recordings.tsx','utf8');assert.match(ui,/preload="none"/);assert.match(ui,/Date\.parse\(r\.audioExpiresAt\)>Date\.now\(\)/);assert.match(ui,/\/api\/work\/reception-recording\/audio\?id=/);assert.match(ui,/Storage estimate/);assert.match(ui,/Spoken-consent estimate/);assert.match(ui,/reservation is not a charge/);assert.match(ui,/Audio does not verify provider costs/);assert(!/api\.twilio\.com|s3\.amazonaws\.com|Authorization|nonce_hash|stop_token_hash/.test(ui));
});
test('schema/capture-off inbound rejects before constructing credentials or provider transports',async()=>{
  let constructed=0;const route=await loadService('app/api/reception/recorded/inbound/route.ts',{privateHeaders,rejectTwiml,process:{env:{}},recordedReceptionServer:()=>{constructed++;throw Error('MUST_NOT_CONSTRUCT');}});
  const response=await route.POST(new Request(root+'/api/reception/recorded/inbound',{method:'POST'}));assert.equal(await response.text(),rejectTwiml);assert.equal(constructed,0);
});
test('incoming rate and standing billing candidates are disabled unresolved templates',()=>{
  const rate=JSON.parse(readFileSync('config/recorded-reception-rate-candidates.json','utf8')),policy=JSON.parse(readFileSync('config/recorded-reception-billing-candidate.json','utf8'));
  assert.equal(rate.enabled,false);assert.equal(policy.enabled,false);for(const name of ['id','rate_id','account_id','rate_snapshot','approved_at','reviewed_until','approval_reference'])assert.equal(policy[name],null);
  assert.equal(Object.keys(policy.components).length,16);assert.equal(policy.components.twilio.source,'provider_receipt');assert.equal(policy.components.elevenlabs.source,'provider_receipt');assert.equal(policy.components.other.source,'recorded_reception_addons');assert.equal(policy.components.other.pricingPolicy.streamMicrosPerMinute,4400);
});
