import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {ownerCallReplyInspector,safeOwnerReply} from '../lib/owner-call-reply-inspector.ts';
import {createRecordingProviders,RecordingProviderError} from '../lib/required-call-recording-provider.ts';
import {privateHeaders,uuid,sha} from '../lib/required-call-recording.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

// Synthetic fixtures only. No live provider requests, account secrets or owner call IDs.
const owner={accountId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222'};
const id='33333333-3333-4333-8333-333333333333',ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),nonce='c'.repeat(64);
const env={TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'synthetic-token-only-for-tests',CONTIGUITY_FROM:'+14243948384'};
const config={id:1,account_id:owner.accountId,owner_user_id:owner.userId,phone:'+12125555280',from_phone:env.CONTIGUITY_FROM,review:{providerAccountSid:ac}};
const run={id,config_id:1,account_id:owner.accountId,owner_user_id:owner.userId,configuration:config,attempt:2,call_sid:ca,nonce_hash:sha(nonce)};
const call={sid:ca,account_sid:ac,from:config.from_phone,to:config.phone,direction:'outbound-api',status:'completed',end_time:'2026-10-03T14:00:00Z'};
const event=(speech='Yes, you can record this call.',extra={})=>({request:{method:'POST',url:`https://www.geticashx.com/api/internal/voice/owner-recording-test/consent?id=${id}&nonce=${nonce}`,parameters:{account_sid:ac,call_sid:ca,speech_result:speech,confidence:'0.91',...extra},headers:{'x-twilio-signature':'synthetic-signature-do-not-return'}},response:{response_code:200,date_created:'Sat, 03 Oct 2026 14:00:00 +0000',response_body:'secret synthetic response body'}});
const page=(events,index=0,next=null)=>({events,page:index,page_size:100,next_page_uri:next});
const next=(index=1,account=ac,callId=ca)=>`/2010-04-01/Accounts/${account}/Calls/${callId}/Events.json?PageSize=100&Page=${index}&PageToken=synthetic-token-${index}`;
function fixture({configs=[structuredClone(config)],runs=[structuredClone(run)],receipt=structuredClone(call),pages=[page([event()])],failCall,failPage,now=()=>Date.parse('2026-10-03T15:00:00Z')}={}){
 const reads=[],providerReads=[];
 const db=async(path,method='GET')=>{reads.push({path,method});assert.equal(method,'GET');return path.startsWith('icash_owner_recording_test_config?')?configs:runs;};
 const provider={getCall:async(key)=>{providerReads.push(['call',key]);if(failCall)throw failCall;return receipt;},getCallEventsPage:async(key,index,token)=>{providerReads.push(['events',key,index,token]);if(failPage)throw failPage;return pages[index];}};
 return {inspect:ownerCallReplyInspector(env,{db,provider,now}),reads,providerReads};
}
let f=fixture(),r=await f.inspect(owner,id);
assert.equal(r.status,'complete');assert.equal(r.reason,'final_speech_result_found');assert.equal(r.attempt,2);assert.equal(r.finalEvents,1);assert.equal(r.events[0].speech,'Yes, you can record this call.');assert.equal(r.events[0].confidence,0.91);assert.equal(r.events[0].partial,false);assert.equal(r.events[0].eventTime,'2026-10-03T14:00:00.000Z');assert.equal(r.events[0].httpResponse,200);
for(const leaked of [id,ac,ca,nonce,'signature','response_body','synthetic response','request','headers','configuration'])assert(!JSON.stringify(r).includes(leaked),leaked);
assert(f.reads.every(x=>x.path.includes(`account_id=eq.${owner.accountId}`)&&x.path.includes(`owner_user_id=eq.${owner.userId}`)&&x.path.includes('limit=2')));assert(f.reads[1].path.includes('config_id=eq.1'));assert(!f.reads.some(x=>x.path.includes('select=*')));
for(const invalid of ['no-run',ca,id+'&account_id=eq.attacker',id+'?url=https://evil.test']){f=fixture();assert.equal((await f.inspect(owner,invalid)).status,'unavailable');assert.equal(f.reads.length,0);assert.equal(f.providerReads.length,0);}
for(const changed of [{configs:[]},{configs:[{...config,id:2}]},{configs:[{...config,account_id:'foreign'}]},{configs:[{...config,owner_user_id:'foreign'}]},{configs:[{...config,phone:'+12125550100'}]},{configs:[{...config,from_phone:'+12125550101'}]},{configs:[{...config,review:{providerAccountSid:'AC'+'d'.repeat(32)}}]},{runs:[]},{runs:[{...run,id:'44444444-4444-4444-8444-444444444444'}]},{runs:[{...run,config_id:2}]},{runs:[{...run,account_id:'foreign'}]},{runs:[{...run,owner_user_id:'foreign'}]},{runs:[{...run,attempt:0}]},{runs:[{...run,attempt:4}]},{runs:[{...run,attempt:2.5}]},{runs:[{...run,call_sid:null}]},{runs:[{...run,configuration:{...config,phone:'+12125550100'}}]},{runs:[{...run,configuration:{...config,owner_user_id:'foreign'}}]},{runs:[{...run,configuration:{...config,review:{providerAccountSid:'foreign'}}}]}]){f=fixture(changed);assert.equal((await f.inspect(owner,id)).status,'unavailable');assert.equal(f.providerReads.length,0,JSON.stringify(changed));}
for(const delta of [{sid:'CA'+'d'.repeat(32)},{account_sid:'AC'+'d'.repeat(32)},{from:'+12125550101'},{to:'+12125550102'},{direction:'inbound'}]){f=fixture({receipt:{...call,...delta}});assert.equal((await f.inspect(owner,id)).reason,'carrier_binding_unverified');assert.equal(f.providerReads.length,1);}
for(const delta of [{status:'in-progress'},{end_time:null},{end_time:'2099-01-01T00:00:00Z'},{end_time:'2026-10-03T14:59:00Z'}]){f=fixture({receipt:{...call,...delta}});assert.equal((await f.inspect(owner,id)).status,'not_ready');assert.equal(f.providerReads.length,1);}
for(const status of [401,403])for(const scope of ['failCall','failPage']){f=fixture({[scope]:new RecordingProviderError(status)});r=await f.inspect(owner,id);assert.equal(r.status,'provider_access_denied');assert.equal(r.events.length,0);assert.equal(f.providerReads.length,scope==='failCall'?1:2);}
const second=event('No, please stop.');f=fixture({pages:[page([event(),second,event('',{unstable_speech_result:'partial-private-text'})])]});r=await f.inspect(owner,id);assert.equal(r.finalEvents,2);assert.equal(r.matchedEvents,3);assert.equal(r.reason,'multiple_final_speech_results');assert.equal(r.events[1].speech,'No, please stop.');assert.equal(r.events[2].partial,true);assert.equal(r.events[2].speech,null);assert.equal(r.events[2].speechStatus,'partial');assert(!JSON.stringify(r).includes('partial-private-text'));
const missing=event();delete missing.request.parameters.speech_result;delete missing.request.parameters.confidence;
f=fixture({pages:[page([missing,event('',{confidence:''}),event(null,{confidence:'NaN'}),event('okay',{confidence:2})])]});r=await f.inspect(owner,id);assert.deepEqual(r.events.map(x=>x.speechStatus),['missing','empty','invalid','present']);assert.deepEqual(r.events.map(x=>x.confidenceStatus),['missing','empty','invalid','invalid']);
f=fixture({pages:[page([])]});r=await f.inspect(owner,id);assert.equal(r.status,'complete');assert.equal(r.reason,'no_matching_consent_event');assert.equal(r.finalEvents,0);
for(const delta of [{account_sid:'foreign'},{call_sid:'foreign'}]){const bad=event('Should not be shown',delta);f=fixture({pages:[page([bad])]});r=await f.inspect(owner,id);assert.equal(r.status,'incomplete');assert.equal(r.reason,'event_binding_unverified');assert.equal(r.events.length,0);}
for(const url of [`https://www.geticashx.com/api/internal/voice/owner-recording-test/consent?id=${id}&nonce=${'f'.repeat(64)}`,`https://www.geticashx.com/api/internal/voice/owner-recording-test/consent?id=${id}&nonce=${nonce}&extra=1`]){const bad=event();bad.request.url=url;f=fixture({pages:[page([bad])]});assert.equal((await f.inspect(owner,id)).reason,'event_binding_unverified');}
for(const change of [{url:'https://evil.test/api/internal/voice/owner-recording-test/consent'},{url:`https://www.geticashx.com/api/internal/voice/owner-recording-test/status?id=${id}`},{method:'GET'}]){const irrelevant=event('Never shown');Object.assign(irrelevant.request,change);f=fixture({pages:[page([irrelevant])]});r=await f.inspect(owner,id);assert.equal(r.events.length,0);assert.equal(r.reason,'no_matching_consent_event');}
f=fixture({pages:[page([event()],0,next()),page([second],1)]});r=await f.inspect(owner,id);assert.equal(r.pagesRead,2);assert.equal(r.events.length,2);assert.deepEqual(f.providerReads.at(-1),['events',ca,1,'synthetic-token-1']);
for(const unsafe of ['https://evil.test'+next(),next(1,'AC'+'f'.repeat(32)),next(1,ac,'CA'+'f'.repeat(32)),next(0),next()+'&Other=unsafe',next()+'&Page=1',next()+'#fragment',next().replace('PageSize=100','PageSize=1000'),next().replace('synthetic-token-1','x%2Fy'),undefined]){const p=page([event()]);p.next_page_uri=unsafe;f=fixture({pages:[p]});r=await f.inspect(owner,id);assert.equal(r.status,'incomplete');assert.equal(r.reason,'pagination_unverified');assert.equal(f.providerReads.length,2);}
f=fixture({pages:[page([event()],0,next()),page([second],1,next(2)),page([event()],2,next(3))]});r=await f.inspect(owner,id);assert.equal(r.reason,'page_limit_reached');assert.equal(r.pagesRead,3);assert.equal(r.events.length,3);assert.equal(f.providerReads.length,4);
for(const invalid of [{events:{}},{events:Array(101).fill(event())},{page:4},{page_size:1000}]){f=fixture({pages:[{...page([]),...invalid}]});assert.equal((await f.inspect(owner,id)).reason,'provider_page_invalid');}
assert.equal(safeOwnerReply('Yes, you may record.').speech,'Yes, you may record.');assert.equal(safeOwnerReply('Okay... record!').speech,'Okay... record!');assert.equal(safeOwnerReply('Yes.Go ahead.').speech,'Yes.Go ahead.');assert.equal(safeOwnerReply('user@example.test').speech,'[redacted]');
for(const secret of ['https://evil.test/?nonce=private','www.evil.test/path','ftp://evil.test/private','user@example.test','+1 (212) 555-1234','CA'+'b'.repeat(32),'token=privateValue','Bearer syntheticSecret1234','a'.repeat(64),'sk_live_private12345','evil.test/private','+1.212.555.1234','212.555.1234','+1\u2009212\u2009555\u20091234','password hunter2','nonce abcdefg','token is hunter2','+1\u2011212\u2011555\u20111234','212/555/1234','٢١٢/٥٥٥/١٢٣٤','212\u2212555\u22121234']){const safe=safeOwnerReply('Okay, '+secret);assert(safe.redacted,secret);assert(!safe.speech.includes(secret),secret);}
assert.equal(safeOwnerReply('word '.repeat(200)).truncated,true);assert.equal(safeOwnerReply('word '.repeat(200)).speech.length,501);
const overlongStart=performance.now();const overlong=safeOwnerReply('a.'.repeat(131072));assert.equal(overlong.speech,'[withheld: overlong reply]');assert.equal(overlong.truncated,true);assert.equal(overlong.redacted,true);assert(performance.now()-overlongStart<100,'Overlong text must be rejected before regex scanning');

let wires=[];const provider=createRecordingProviders(env,async(url,init)=>{wires.push({url,init});return Response.json(page([]));});
await provider.getCallEventsPage(ca,1,'PAsynthetic');assert.equal(wires[0].url,`https://api.twilio.com/2010-04-01/Accounts/${ac}/Calls/${ca}/Events.json?PageSize=100&Page=1&PageToken=PAsynthetic`);assert.equal(wires[0].init.method,'GET');assert.equal(wires[0].init.redirect,'error');assert.equal(wires[0].init.cache,'no-store');assert.equal(wires[0].init.credentials,'omit');assert(wires[0].init.signal);assert.equal(wires[0].init.body,undefined);
for(const args of [[ca,3],[ca,-1],[ca,1,'../bad'],['https://evil.test',0]]){assert.throws(()=>provider.getCallEventsPage(...args));}assert.equal(wires.length,1);
for(const response of [new Response('no',{status:403}),new Response('x'.repeat(262145)),new Response('{}',{headers:{'Content-Length':'262145'}}),Object.assign(Response.json({}),{})]){
 if(response.status===200&&response.headers.get('content-type')==='application/json')Object.defineProperty(response,'redirected',{value:true});
 const p=createRecordingProviders(env,async()=>response);await assert.rejects(()=>p.getCallEventsPage(ca));
}
const redirected=Response.json(page([]));Object.defineProperty(redirected,'url',{value:'https://evil.test/'});await assert.rejects(()=>createRecordingProviders(env,async()=>redirected).getCallEventsPage(ca));

const savedFlag=process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY;process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY='true';
try{
 let authCalls=0,inspectorCalls=0,signInError=false;
 const route=await loadService('app/api/owner-recording-test/reply/route.ts',{privateHeaders,uuid,workAccount:async()=>{authCalls++;if(signInError)throw Error('secret auth detail');return owner;},ownerCallReplyInspectorServer:()=>async(o,key)=>{inspectorCalls++;assert.deepEqual(o,owner);assert.equal(key,id);return {status:'complete',reason:'no_matching_consent_event',events:[],pagesRead:1,matchedEvents:0,finalEvents:0};}});
 assert.equal(route.POST,undefined);
 for(const query of ['',`?id=${id}&CallSid=${ca}`,`?id=${id}&id=${id}`,`?id=${ca}`]){const response=await route.GET(new Request('https://www.geticashx.com/api/owner-recording-test/reply'+query));assert.equal(response.status,400);assert(response.headers.get('cache-control').includes('no-store'));}
 assert.equal(authCalls,0);assert.equal(inspectorCalls,0);signInError=true;
 let response=await route.GET(new Request('https://www.geticashx.com/api/owner-recording-test/reply?id='+id));assert.equal(response.status,403);assert.equal(inspectorCalls,0);assert(!(await response.text()).includes('secret'));
 signInError=false;response=await route.GET(new Request('https://www.geticashx.com/api/owner-recording-test/reply?id='+id));assert.equal(response.status,200);assert.equal(inspectorCalls,1);assert(response.headers.get('cache-control').includes('no-store'));assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY='false';response=await route.GET(new Request('https://www.geticashx.com/api/owner-recording-test/reply?id='+id));assert.equal(response.status,404);assert.equal(inspectorCalls,1);
}finally{if(savedFlag===undefined)delete process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY;else process.env.ICASH_OWNER_RECORDING_RECEIPTS_READY=savedFlag;}
const source=readFileSync(new URL('../app/owner-recording-test/check.tsx',import.meta.url),'utf8');assert(source.includes('<OwnerReplyInspector runId={r.id}'));assert(source.includes('if(active.current||!ended)return'));assert(source.includes('controller.current?.abort()'));assert(!source.includes('TWILIO_AUTH_TOKEN'));
const require=createRequire(import.meta.url),mod={exports:{}};
// The production-readiness child has its own focused suite; this renderer isolates the reply inspector export.
const componentRequire=name=>name==='./production-readiness'?{default:()=>null}:require(name);
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText)(componentRequire,mod,mod.exports);
const html=renderToStaticMarkup(require('react').createElement(mod.exports.OwnerReplyInspector,{runId:id,ended:true}));assert(html.includes('Inspect captured reply (read-only)'));assert(!html.includes('Captured reply:'));
const serviceSource=readFileSync(new URL('../lib/owner-call-reply-inspector.ts',import.meta.url),'utf8');assert(!/console\.|\.start\(|\.dial\(|\.register\(|\.end\(|db\([^\n]*['"]POST/.test(serviceSource));
console.log('Owner reply inspector: fixed owner/run/canonical-call binding, read-only provider transport, denial stop, bounded pages/bodies, redaction/no header/nonce/response leakage, explicit multiple/missing/partial events, private route and visible click-only UI passed.');
