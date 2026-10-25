import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findRejectedRecordedCall} from '../lib/rejected-recorded-call-receipt.ts';
import {createRecordingProviders,RecordingProviderError} from '../lib/required-call-recording-provider.ts';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
import {directCallTwiml} from '../lib/direct-call-entry.ts';
import {recordingBaseUrl,sha} from '../lib/required-call-recording.ts';
const now=Date.now(),dial=now-3600000,stamp=n=>new Date(n).toISOString();
const ac='AC'+'a'.repeat(32),no='NO'+'b'.repeat(32),nonce='c'.repeat(64);
const row={id:'11111111-1111-4111-8111-111111111111',account_id:'22222222-2222-4222-8222-222222222222',operation_key:'voice:33333333-3333-4333-8333-333333333333',
 provider_account_sid:ac,call_sid:null,state:'consent_pending',entry_policy:'direct_recorded_v1',nonce_hash:sha(nonce),from_phone:'+15555550101',to_phone:'+15555550102',
 created_at:stamp(dial-1000),dial_claimed_at:stamp(dial),recording_sid:null,start_claimed_at:null,conversation_id:null};
const params={From:row.from_phone,To:row.to_phone,Twiml:directCallTwiml(recordingBaseUrl+'/connect',row.id,nonce),StatusCallback:recordingBaseUrl+'/terminal?id='+row.id};
const alert={sid:no,account_sid:ac,error_code:'21211',date_generated:stamp(dial+1000),resource_sid:null,request_method:'POST',
 request_url:`https://api.twilio.com/2010-04-01/Accounts/${ac}/Calls.json`,request_variables:JSON.stringify(params),response_body:JSON.stringify({status:400,code:21211,message:'fixture invalid To'})};
function fixture({detail=alert,alerts=[alert],meta={},error}={}){
 const reads=[];return {reads,provider:{listCallCreationAlerts:async t=>{reads.push(['list',t]);if(error)throw error;return {alerts,meta:{page:0,page_size:20,next_page_url:null,...meta}};},getCallCreationAlert:async id=>{reads.push(['detail',id]);return detail;}}};
}
const lookup=(f,r=row)=>findRejectedRecordedCall(r,f.provider,{TWILIO_ACCOUNT_SID:ac},now);
test('exact original rejected creation releases only a minimal hashed proof using GETs',async()=>{
 for(const raw of [JSON.stringify(params),new URLSearchParams(params).toString()]){
  const f=fixture({detail:{...alert,request_variables:raw}}),result=await lookup(f);
  assert.equal(result.status,'original_rejection_matched');assert.equal(result.proof.alertSid,no);assert.equal(result.proof.nonceHash,sha(nonce));
  assert.equal(result.proof.responseStatus,400);assert.equal(result.proof.errorCode,21211);assert.equal(result.proof.resourceSid,null);
  assert(!JSON.stringify(result.proof).includes(nonce));assert(!JSON.stringify(result.proof).includes('fixture invalid'));
  assert.deepEqual(f.reads,[['list',row.dial_claimed_at],['detail',no]]);
 }
});
test('missing, ambiguous or incomplete original receipts never clear an unknown outcome',async()=>{
 for(const f of [fixture({alerts:[]}),fixture({alerts:[alert,alert]}),fixture({alerts:Array(4).fill(alert)}),fixture({meta:{page:1}}),fixture({meta:{page_size:100}}),fixture({meta:{next_page_url:'https://untrusted.example'}}),fixture({alerts:Array(21).fill(alert)})])assert(!(await lookup(f)).proof);
 const patches=[{sid:'NO'+'d'.repeat(32)},{account_sid:'AC'+'d'.repeat(32)},{request_method:'GET'},{request_url:alert.request_url+'?extra=1'},
  {request_url:alert.request_url.replace('api.twilio.com','evil.example')},{resource_sid:'CA'+'d'.repeat(32)},{resource_sid:undefined},{error_code:'11200'},
  {date_generated:stamp(dial-2001)},{date_generated:stamp(dial+60001)},{date_generated:'invalid'},
  {response_body:'invalid'},{response_body:JSON.stringify({status:500,code:21211})},{response_body:JSON.stringify({status:400,code:21212})},{response_body:JSON.stringify({status:400,code:21211,sid:'CA'+'d'.repeat(32)})}];
 for(const patch of patches)assert(!(await lookup(fixture({detail:{...alert,...patch}}))).proof,JSON.stringify(patch));
 for(const patch of [{To:'+15555550199'},{From:'+15555550199'},{Twiml:params.Twiml.replace(nonce,'d'.repeat(64))},{Twiml:params.Twiml+' '},{StatusCallback:params.StatusCallback+'&extra=1'},{to:row.to_phone},{Twiml:{nested:params.Twiml}}])assert(!(await lookup(fixture({detail:{...alert,request_variables:JSON.stringify({...params,...patch})}}))).proof);
 assert(!(await lookup(fixture({detail:{...alert,request_variables:new URLSearchParams(params)+'&To='+encodeURIComponent(row.to_phone)}}))).proof);
});
test('started, mismatched and recent rows never inspect rejection receipts',async()=>{
 for(const patch of [{id:'invalid'},{call_sid:'CA'+'d'.repeat(32)},{state:'starting'},{entry_policy:'other'},{start_claimed_at:stamp(dial)},{recording_sid:'RE'+'d'.repeat(32)},
  {conversation_id:'conv_other'},{consent_at:stamp(dial)},{provider_started_at:stamp(dial)},{call_ended_at:stamp(dial)},{end_requested_at:stamp(dial)},
  {provider_account_sid:'AC'+'d'.repeat(32)},{nonce_hash:null},{dial_claimed_at:stamp(now-59000)},{dial_claimed_at:null},{created_at:stamp(dial+1)},{created_at:stamp(now-31*86400000)}]){
  const f=fixture();assert.equal((await lookup(f,{...row,...patch})).status,'binding_not_eligible');assert.equal(f.reads.length,0);
 }
});
test('fixed monitor transport rejects redirects, errors, oversized bodies and untrusted paths',async()=>{
 const requests=[],env={TWILIO_ACCOUNT_SID:ac,TWILIO_AUTH_TOKEN:'fixture-token-long-enough'};
 const p=createRecordingProviders(env,async(url,init)=>{requests.push({url,init});return new Response('{}');});
 await p.listCallCreationAlerts(row.dial_claimed_at);await p.getCallCreationAlert(no);
 const u=new URL(requests[0].url);assert.equal(u.origin,'https://monitor.twilio.com');assert.equal(u.pathname,'/v1/Alerts');
 assert.equal(u.searchParams.get('PageSize'),'20');assert.equal(u.searchParams.get('LogLevel'),'error');
 for(const {init} of requests){assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert(init.signal);}
 assert.throws(()=>p.getCallCreationAlert('https://evil.example'));assert.throws(()=>p.listCallCreationAlerts('invalid'));assert.equal(requests.length,2);
 for(const response of [new Response('{}',{status:401}),new Response('x'.repeat(262145)),new Response('{}',{headers:{'content-length':'262145'}})])await assert.rejects(()=>createRecordingProviders(env,async()=>response).getCallCreationAlert(no));
 assert.deepEqual(await lookup(fixture({error:Error('private '+row.to_phone)})),{status:'rejection_read_unavailable'});
 assert.deepEqual(await lookup(fixture({error:new RecordingProviderError(429)})),{status:'rejection_read_unavailable',providerStatus:429});
});
test('maintenance submits only verified proof and bounds recovery to one row without provider mutation',async()=>{
 const f=fixture(),writes=[],warnings=[],originalWarn=console.warn;console.warn=(...x)=>warnings.push(x);
 const forbidden=async()=>{throw Error('Provider mutation forbidden');};
 const provider={...f.provider,listCallCandidates:async()=>({calls:[],page:0,page_size:25,next_page_uri:null}),dial:forbidden,end:forbidden,start:forbidden,register:forbidden};
 const db=async(path,method,input)=>{
  if(path==='rpc/icash_claim_call_recording_work')return input.p_kind==='reconcile'?[row,{...row,id:'77777777-7777-4777-8777-777777777777'}]:[];
  if(path==='rpc/icash_note_call_creation_rejection'){writes.push(input);assert.equal(input.p_id,row.id);assert.equal(input.p_account,row.account_id);assert.equal(input.p_operation,row.operation_key);assert.equal(input.p_receipt.alertSid,no);return {settled:true};}
  if(path==='rpc/icash_finish_call_recording_work'){assert.equal(input.p_id,'77777777-7777-4777-8777-777777777777');assert.equal(input.p_outcome,'retry');return row;}
  throw Error('Unexpected database action '+path);
 };
 try{
  assert.deepEqual(await maintainRecordings(db,provider,{TWILIO_ACCOUNT_SID:ac}),{deleted:0,reconciled:1,held:1});assert.equal(writes.length,1);assert.equal(f.reads.length,2);
  const log=JSON.stringify(warnings);for(const secret of [nonce,ac,no,row.from_phone,row.to_phone])assert(!log.includes(secret));assert(log.includes('original_rejection_matched'));
 }finally{console.warn=originalWarn;}
});
