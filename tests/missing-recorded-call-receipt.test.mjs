import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findMissingRecordedCall} from '../lib/missing-recorded-call-receipt.ts';
import {createRecordingProviders,RecordingProviderError} from '../lib/required-call-recording-provider.ts';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
import {directCallTwiml} from '../lib/direct-call-entry.ts';
import {recordingBaseUrl,sha} from '../lib/required-call-recording.ts';
const now=Date.now(),dial=now-3600000,stamp=n=>new Date(n).toISOString();
const ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),nonce='c'.repeat(64);
const row={id:'11111111-1111-4111-8111-111111111111',account_id:'22222222-2222-4222-8222-222222222222',operation_key:'voice:33333333-3333-4333-8333-333333333333',
 provider_account_sid:ac,call_sid:null,state:'consent_pending',entry_policy:'direct_recorded_v1',nonce_hash:sha(nonce),from_phone:'+15555550101',to_phone:'+15555550102',
 created_at:stamp(dial-1000),dial_claimed_at:stamp(dial),recording_sid:null,start_claimed_at:null,conversation_id:null,rate_id:'44444444-4444-4444-8444-444444444444',reconcile_lease_token:'55555555-5555-4555-8555-555555555555'};
const call={sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',parent_call_sid:null,date_created:stamp(dial+1000),end_time:stamp(dial+30000),date_updated:stamp(dial+30000),status:'no-answer',duration:'0',price:'0.00000',price_unit:'USD'};
const terminalEvent={request:{method:'POST',url:recordingBaseUrl+'/terminal?id='+row.id,parameters:{account_sid:ac,call_sid:ca,from:row.from_phone,to:row.to_phone,call_status:'no-answer'}},response:{date_created:stamp(dial+30000),response_code:503}};
const connectEvent={request:{method:'POST',url:recordingBaseUrl+'/connect?id='+row.id+'&nonce='+nonce,parameters:{account_sid:ac,call_sid:ca,from:row.from_phone,to:row.to_phone}},response:{date_created:stamp(dial+10000),response_code:503}};
const createEvent={request:{method:'POST',url:`https://api.twilio.com/2010-04-01/Accounts/${ac}/Calls/${ca}.json`,parameters:{account_sid:ac,from:row.from_phone,to:row.to_phone,twiml:directCallTwiml(recordingBaseUrl+'/connect',row.id,nonce),status_callback:recordingBaseUrl+'/terminal?id='+row.id}},response:{date_created:stamp(dial+1000),response_code:201,response_body:JSON.stringify({sid:ca})}};
function fixture({rows=[call],callValue=call,events=[terminalEvent],listPatch={},eventsPatch={},error}={}){
 const reads=[];const provider={
  listCallCandidates:async(from,to)=>{reads.push(['list',from,to]);if(error)throw error;return {calls:rows,page:0,page_size:25,next_page_uri:null,...listPatch};},
  getCall:async id=>{reads.push(['call',id]);return callValue;},
  getCallEventsPage:async(id,page)=>{reads.push(['events',id,page]);return {events,page:0,page_size:100,next_page_uri:null,...eventsPatch};}
 };return {provider,reads};
}
const lookup=(f,r=row)=>findMissingRecordedCall(r,f.provider,{TWILIO_ACCOUNT_SID:ac},now);
test('original terminal, nonce callback and creation receipts recover a lost ID with GETs only',async()=>{
 for(const event of [terminalEvent,connectEvent,createEvent]){
  const f=fixture({events:[event]}),r=await lookup(f);
  assert.equal(r.status,'original_receipt_matched');assert.deepEqual(r.call,call);assert.equal(r.evidenceHash,sha(JSON.stringify(event)));
  assert.deepEqual(f.reads,[['list',row.from_phone,row.to_phone],['call',ca],['events',ca,0]]);
 }
});
test('matching phone/time without the original request never releases a call',async()=>{
 for(const events of [[],[{request:{method:'POST',url:'https://unrelated.example'},response:{}}]])assert.equal((await lookup(fixture({events}))).status,'original_request_not_matched');
 for(const rows of [[],[call,{...call,sid:'CA'+'d'.repeat(32)}]])assert(!((await lookup(fixture({rows}))).call));
 for(const listPatch of [{next_page_uri:'https://untrusted.example'},{page:1},{page_size:100},{calls:Array(26).fill(call)}])assert.equal((await lookup(fixture({listPatch}))).status,'candidate_page_incomplete');
 for(const eventsPatch of [{next_page_uri:'https://untrusted.example'},{page:1},{page_size:25},{events:Array(101).fill(terminalEvent)}])assert.equal((await lookup(fixture({eventsPatch}))).status,'event_page_incomplete');
});
test('wrong identities, active calls, early events and stale rows retain their holds',async()=>{
 for(const patch of [{account_sid:'AC'+'d'.repeat(32)},{sid:'CA'+'d'.repeat(32)},{from:'+15555550199'},{to:'+15555550199'},{direction:'inbound'},{parent_call_sid:'CA'+'d'.repeat(32)},
  {date_created:stamp(dial-3000)},{date_created:stamp(dial+61000)},{date_created:'invalid'},{status:'in-progress'},{status:'queued'},{end_time:stamp(now-1000)},{end_time:null,date_updated:null}])assert(!((await lookup(fixture({callValue:{...call,...patch}}))).call));
 for(const patch of [{id:'invalid'},{call_sid:ca},{state:'starting'},{start_claimed_at:stamp(dial)},{recording_sid:'RE'+'d'.repeat(32)},{conversation_id:'conv_other'},{provider_account_sid:'wrong'},
  {nonce_hash:null},{dial_claimed_at:null},{dial_claimed_at:stamp(now-60000)},{created_at:stamp(dial+1000)},{created_at:stamp(now-31*86400000)}]){
  const f=fixture();assert.equal((await lookup(f,{...row,...patch})).status,'binding_not_eligible');assert.equal(f.reads.length,0);
 }
});
test('provider request fields and callback URLs are independently bound',async()=>{
 const mutations=[e=>e.request.method='GET',e=>e.request.parameters.account_sid='wrong',e=>e.request.parameters.call_sid='wrong',e=>e.request.parameters.from='+15555550199',e=>e.request.parameters.to='+15555550199',
  e=>e.request.parameters.call_status='completed',e=>e.request.url+='&id='+row.id,e=>e.request.url+='&extra=1',e=>e.request.url+='#fragment',e=>e.request.url=e.request.url.replace(row.id,'66666666-6666-4666-8666-666666666666'),
  e=>e.request.url=e.request.url.replace('www.geticashx.com','evil.example'),e=>e.request.url=e.request.url.replace('https://','https://user@'),e=>e.response.date_created=stamp(dial-2000),e=>e.response.date_created=stamp(now+1)];
 for(const mutate of mutations){const event=structuredClone(terminalEvent);mutate(event);assert.equal((await lookup(fixture({events:[event]}))).status,'original_request_not_matched');}
 const badNonce=structuredClone(connectEvent);badNonce.request.url=badNonce.request.url.replace(nonce,'d'.repeat(64));assert.equal((await lookup(fixture({events:[badNonce]}))).status,'original_request_not_matched');
 for(const mutate of [e=>e.response.response_code=200,e=>e.response.response_body='{"sid":"wrong"}',e=>e.response.response_body='invalid',e=>e.request.parameters.twiml+=' ',e=>e.request.parameters.status_callback+='&extra=1',e=>e.response.date_created=stamp(dial+61000)]){
  const event=structuredClone(createEvent);mutate(event);assert.equal((await lookup(fixture({events:[event]}))).status,'original_request_not_matched');
 }
});
test('provider failures expose no private response or recipient data',async()=>{
 assert.deepEqual(await lookup(fixture({error:Error('private-token '+row.to_phone)})),{status:'provider_read_unavailable'});
 assert.deepEqual(await lookup(fixture({error:new RecordingProviderError(429)})),{status:'provider_read_unavailable',providerStatus:429});
});
test('candidate transport is a bounded fixed GET, never provider pagination',async()=>{
 const requests=[];const provider=createRecordingProviders({TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'fixture-token-long-enough'},async(url,init)=>{requests.push({url,method:init.method,body:init.body,redirect:init.redirect});return new Response('{}');});
 await provider.listCallCandidates(row.from_phone,row.to_phone);
 assert.deepEqual(requests,[{url:`https://api.twilio.com/2010-04-01/Accounts/${ac}/Calls.json?`+new URLSearchParams({From:row.from_phone,To:row.to_phone,PageSize:'25',Page:'0'}),method:'GET',body:undefined,redirect:'error'}]);
 assert.throws(()=>provider.listCallCandidates('https://evil.example',row.to_phone));assert.equal(requests.length,1);
});
test('maintenance uses the original settlement path, never redials, and bounds discovery to one row',async()=>{
 let current={...row},settlements=0;const transitions=[],warnings=[],originalWarn=console.warn;console.warn=(...x)=>warnings.push(x);
 const f=fixture();const forbidden=async()=>{throw Error('Provider mutation or paid test forbidden');};
 const db=async(path,method,input)=>{
  if(path==='rpc/icash_claim_call_recording_work')return input.p_kind==='reconcile'?[{...current},{...row,id:'77777777-7777-4777-8777-777777777777'}]:[];
  if(path==='rpc/icash_transition_call_recording'){
   assert.equal(input.p_id,current.id);assert.equal(input.p_account,current.account_id);assert.equal(input.p_operation,current.operation_key);transitions.push(input.p_action);
   if(input.p_action==='bind_call'){assert.deepEqual(input.p_payload,{callSid:ca,providerAccountSid:ac,fromPhone:row.from_phone,toPhone:row.to_phone});current={...current,call_sid:ca};}
   else if(input.p_action==='fail'){assert.deepEqual(input.p_payload,{reason:'call_ended_before_recording'});current={...current,state:'failed'};}else throw Error('Unexpected transition');return {...current};
  }
  if(path==='rpc/icash_note_recorded_gate_terminal'){assert.equal(input.p_receipt.sid,ca);return null;}
  if(path.startsWith('icash_operation_rates?'))return [{costs_micros:{}}];
  if(path==='rpc/icash_settle_unstarted_recorded_call'){assert.equal(input.p_receipt.callSid,ca);assert.equal(input.p_receipt.priceMicros,0);settlements++;return {settled:true};}
  if(path==='rpc/icash_finish_call_recording_work'){assert.equal(input.p_id,'77777777-7777-4777-8777-777777777777');assert.equal(input.p_outcome,'retry');return row;}
  throw Error('Unexpected DB action '+path);
 };
 try{
  assert.deepEqual(await maintainRecordings(db,{...f.provider,dial:forbidden,end:forbidden,start:forbidden,register:forbidden},{TWILIO_ACCOUNT_SID:ac}),{deleted:0,reconciled:1,held:1});
  assert.deepEqual(transitions,['bind_call','fail']);assert.equal(settlements,1);assert.equal(f.reads.filter(x=>x[0]==='list').length,1);
  const logged=JSON.stringify(warnings);for(const secret of [nonce,ac,ca,row.from_phone,row.to_phone])assert(!logged.includes(secret));assert(logged.includes('original_receipt_matched'));
 }finally{console.warn=originalWarn;}
});
