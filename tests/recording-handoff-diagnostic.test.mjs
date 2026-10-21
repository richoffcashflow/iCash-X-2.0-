import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recordingHandoffDiagnostic} from '../lib/recording-handoff-diagnostic.ts';
import {sha,recordingBaseUrl} from '../lib/required-call-recording.ts';
import {RecordingProviderError,createRecordingProviders} from '../lib/required-call-recording-provider.ts';
const now=Date.now(),nonce='f'.repeat(64),ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32);
const row={id:'11111111-1111-4111-8111-111111111111',call_sid:ca,provider_account_sid:ac,nonce_hash:sha(nonce),from_phone:'+15555550101',to_phone:'+15555550102',start_claimed_at:new Date(now-3600000).toISOString(),conversation_id:null};
const call={sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',status:'completed',end_time:new Date(now-3600000).toISOString()};
const event={request:{method:'POST',url:recordingBaseUrl+'/connect?id='+row.id+'&nonce='+nonce,parameters:{account_sid:ac,call_sid:ca}},response:{response_code:200,response_body:'<Response><Connect><Stream url="wss://secret.example"><Parameter name="token" value="private-token"/></Stream></Connect></Response>'}};
function fixture({callValue=call,pageValue,callError,pageError,notesValue,notesError}={}){const reads=[];return {reads,provider:{getCallNotifications:async id=>{reads.push(['notifications',id]);if(notesError)throw notesError;return notesValue??{next_page_uri:null,notifications:[]};},getCall:async id=>{reads.push(['call',id]);if(callError)throw callError;return callValue;},getCallEventsPage:async(...args)=>{reads.push(['events',...args]);if(pageError)throw pageError;return pageValue??{page:0,page_size:100,next_page_uri:null,events:[event]};}}};}
test('exact terminal call and nonce-bound response yield markers only, without write capabilities',async()=>{
 const f=fixture(),r=await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now);
 assert.deepEqual(r,{status:'complete',matchedEvents:1,events:[{httpStatus:200,bodyBounded:true,connectMarker:true,streamMarker:true,hangupMarker:false}],notifications:{status:'complete',errorCodes:[]}});
 assert.deepEqual(f.reads,[['call',ca],['events',ca,0],['notifications',ca]]);
 for(const secret of [nonce,ca,ac,row.from_phone,row.to_phone,'secret.example','private-token'])assert(!JSON.stringify(r).includes(secret));
});
for(const field of ['sid','account_sid','from','to','direction'])test('reject mismatched carrier '+field,async()=>{const f=fixture({callValue:{...call,[field]:'wrong'}});assert.equal((await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now)).status,'carrier_binding_mismatch');assert.equal(f.reads.length,1);});
for(const [label,value] of [['active',{...call,status:'in-progress'}],['recent',{...call,end_time:new Date(now-1000).toISOString()}],['future',{...call,end_time:new Date(now+1000).toISOString()}],['missing end',{...call,end_time:null}]])test('no events requested for '+label,async()=>{const f=fixture({callValue:value});await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now);assert.equal(f.reads.length,1);});
test('bad nonce and cross-call events are not attributed to this recording',async()=>{
 for(const mutate of [e=>e.request.url=e.request.url.replace(nonce,'e'.repeat(64)),e=>e.request.parameters.call_sid='CA'+'c'.repeat(32),e=>e.request.parameters.account_sid='AC'+'c'.repeat(32)]){
  const e=structuredClone(event);mutate(e);const f=fixture({pageValue:{page:0,page_size:100,next_page_uri:null,events:[e]}});
  assert.deepEqual(await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now),{status:'event_binding_mismatch'});
 }
});
test('pagination never follows provider URLs and remains explicitly incomplete',async()=>{const f=fixture({pageValue:{page:0,page_size:100,next_page_uri:'https://evil.test/secret',events:[event]}});assert.equal((await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now)).status,'incomplete_page');assert.equal(f.reads.length,3);});
test('invalid page rejected and oversized bodies withheld',async()=>{
 const f=fixture({pageValue:{page:1,page_size:100,next_page_uri:null,events:[]}});assert.equal((await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now)).status,'event_page_invalid');
 const e=structuredClone(event);e.response.response_body='x'.repeat(64001);e.response.response_code='secret';const g=fixture({pageValue:{page:0,page_size:100,next_page_uri:null,events:[e]}});
 assert.deepEqual((await recordingHandoffDiagnostic(row,g.provider,{TWILIO_ACCOUNT_SID:ac},now)).events,[{httpStatus:null,bodyBounded:false,connectMarker:null,streamMarker:null,hangupMarker:null}]);
});
test('provider errors expose only typed HTTP status and do not throw into reconciliation',async()=>{
 const f=fixture({pageError:new RecordingProviderError(403)});assert.deepEqual(await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now),{status:'provider_read_unavailable',providerStatus:403});
 const g=fixture({callError:Error('secret-token '+row.to_phone)});assert.deepEqual(await recordingHandoffDiagnostic(row,g.provider,{TWILIO_ACCOUNT_SID:ac},now),{status:'provider_read_unavailable'});
});
test('already bound or invalid local row never requests provider data',async()=>{for(const value of [{...row,conversation_id:'conv_exists'},{...row,nonce_hash:null},{...row,provider_account_sid:'wrong'}]){const f=fixture();assert.equal((await recordingHandoffDiagnostic(value,f.provider,{TWILIO_ACCOUNT_SID:ac},now)).status,'binding_unavailable');assert.equal(f.reads.length,0);}});

test('notification codes are bounded, sorted, deduplicated, and never expose provider descriptions',async()=>{
 const f=fixture({notesValue:{next_page_uri:null,notifications:[31901,'31901',11200].map(error_code=>({account_sid:ac,call_sid:ca,error_code,message:'secret-token',request_url:'https://private.example'}))}});
 const r=await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now);
 assert.deepEqual(r.notifications,{status:'complete',errorCodes:[11200,31901]});
 assert(!JSON.stringify(r).includes('secret'));assert(!JSON.stringify(r).includes('private.example'));
});
test('foreign or malformed notifications expose no partial error codes',async()=>{
 for(const patch of [{account_sid:'wrong'},{call_sid:'wrong'},{error_code:'secret'},{error_code:Infinity},{error_code:123.5}]){
  const f=fixture({notesValue:{next_page_uri:null,notifications:[{account_sid:ac,call_sid:ca,error_code:31901},{account_sid:ac,call_sid:ca,error_code:31902,...patch}]}});
  assert.deepEqual((await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now)).notifications,{status:'binding_or_code_invalid'});
 }
});
test('notification pagination and read failures never lose existing handoff evidence',async()=>{
 for(const [input,expected] of [[{notesValue:{next_page_uri:'https://evil.example',notifications:[]}},{status:'incomplete_page',errorCodes:[]}],[{notesValue:{notifications:Array(21).fill({})}},{status:'invalid_page'}],[{notesError:new RecordingProviderError(403)},{status:'provider_read_unavailable',providerStatus:403}],[{notesError:Error('secret-token')},{status:'provider_read_unavailable'}]]){
  const f=fixture(input),r=await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now);
  assert.equal(r.status,'complete');assert.equal(r.matchedEvents,1);assert.deepEqual(r.notifications,expected);assert.equal(f.reads.length,3);
 }
});
test('unmatched callback never reads call notifications',async()=>{
 const f=fixture({pageValue:{page:0,page_size:100,next_page_uri:null,events:[]}});
 assert.deepEqual((await recordingHandoffDiagnostic(row,f.provider,{TWILIO_ACCOUNT_SID:ac},now)).notifications,{status:'not_inspected'});assert.equal(f.reads.length,2);
});

test('notification transport is a fixed GET and rejects injected call paths before a request',async()=>{
 const requests=[];const provider=createRecordingProviders({TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'fixture-token-long-enough'},async(url,init)=>{requests.push({url,method:init.method,body:init.body,redirect:init.redirect});return new Response(JSON.stringify({notifications:[],next_page_uri:null}),{status:200,headers:{'content-type':'application/json'}});});
 await provider.getCallNotifications(ca);
 assert.deepEqual(requests,[{url:'https://api.twilio.com/2010-04-01/Accounts/'+ac+'/Calls/'+ca+'/Notifications.json?PageSize=20',method:'GET',body:undefined,redirect:'error'}]);
 assert.throws(()=>provider.getCallNotifications(ca+'?PageToken=evil'));assert.equal(requests.length,1);
});
