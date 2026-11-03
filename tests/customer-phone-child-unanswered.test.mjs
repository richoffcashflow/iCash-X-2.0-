import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {object,sid,uuid,verifiedTwilioForm} from '../lib/required-call-recording.ts';
import {twilioUsdChargeMicros,twilioUnansweredCall} from '../lib/twilio-usd-cost.ts';
import {boundedBytes,createRecordingProviders} from '../lib/required-call-recording-provider.ts';
const created=new Date(Date.now()-120000).toISOString(),ended=new Date(Date.now()-60000).toISOString();
const ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),ch='CA'+'c'.repeat(32),re='RE'+'d'.repeat(32),id='44444444-4444-4444-8444-444444444444';
const parentReceipt={sid:ca,status:'completed',currency:'USD',costMicros:4000,receiptHash:'a'.repeat(64)};
const childReceipt={sid:ch,status:'no-answer',currency:'USD',costMicros:null,receiptHash:'b'.repeat(64)};
const audioReceipt={sid:re,status:'completed',costMicros:3000,currency:'USD',callSid:ca,providerAccountSid:ac,policy:'customer-phone-recorded-v1',receiptHash:'c'.repeat(64)};
const base={id,account_id:'11111111-1111-4111-8111-111111111111',callback_phone:'client:icash_'+'a'.repeat(64),recipient_phone:'+12025550102',business_phone:'+12025550101',provider_account_sid:ac,connection_type:'browser',recording_required:true,recording_state:'available',recording_sid:re,recording_deleted_at:null,max_seconds:600,created_at:created,state:'failed',parent_sid:ca,child_sid:ch,ended_at:ended,connected_at:created,recipient_answered_at:null,settled_at:null};
const parentBase={sid:ca,from:base.business_phone,to:base.callback_phone,account_sid:ac,direction:'outbound-api',date_created:created,end_time:ended,status:'completed',duration:'30',price:'-0.004',price_unit:'USD'};
const childBase={...parentBase,sid:ch,to:base.recipient_phone,direction:'outbound-dial',parent_call_sid:ca,status:'no-answer',duration:'0',price:null};
let row,parent,child,listed,children,descendants,recordings,reads,patches,settlements,conflict;
function reset(){row={...base,parent_receipt:{...parentReceipt},child_receipt:{...childReceipt},recording_receipt:{...audioReceipt}};parent={...parentBase};child={...childBase};listed=null;children=null;descendants={calls:[],next_page_uri:null};recordings={recordings:[],next_page_uri:null};reads=[];patches=[];settlements=0;conflict=false;}
const db=async(path,method='GET',body)=>{if(path.startsWith('icash_customer_phone_calls?')){if(method==='PATCH'){if(body.child_receipt?.kind==='verified_unanswered_browser_child'){
 const p=new URLSearchParams(path.split('?')[1]);for(const k of ['parent_receipt','child_receipt','recording_receipt'])assert.equal(p.get(k),'eq.'+JSON.stringify(row[k]));
 assert.equal(p.get('child_sid'),'eq.'+ch);assert.equal(p.get('recipient_answered_at'),'is.null');assert.equal(p.get('connected_at'),'eq.'+created);assert.equal(p.get('settled_at'),'is.null');
 if(conflict){row.recipient_answered_at=created;return [];}
 }patches.push(body);Object.assign(row,body);}return [{...row}];}if(path==='rpc/icash_settle_customer_phone_call'){settlements++;return false;}throw Error('Unexpected fixture database action');};
const m=await loadService('lib/customer-phone.ts',{createHash,createHmac,db,boundedBytes,createRecordingProviders,verifiedTwilioForm,object,sid,uuid,twilioUsdChargeMicros,twilioUnansweredCall});
const p={call:async(s)=>{reads.push('call:'+s);return s===ca?parent:child;},children:async(s)=>{reads.push('children:'+s);return s===ca?(children??{calls:[listed??child],next_page_uri:null}):descendants;},recordings:{listRecordings:async(s)=>{reads.push('audio:'+s);assert.equal(s,ch);if(recordings instanceof Error)throw recordings;return recordings;}}};
const run=()=>m.reconcileCustomerPhoneCall({...row},p),held=()=>assert(!patches.some(p=>p.child_receipt?.kind==='verified_unanswered_browser_child'));
for(const status of ['busy','no-answer','failed','canceled'])for(const duration of [null,'','0']){
 reset();child.status=status;child.duration=duration;row.child_receipt.status=status;const original=structuredClone(row.child_receipt);
 await run();assert.equal(row.child_receipt.kind,'verified_unanswered_browser_child');assert.equal(row.child_receipt.costMicros,0);assert.deepEqual(row.parent_receipt,parentReceipt);assert.deepEqual(row.recording_receipt,audioReceipt);assert.deepEqual(row.child_receipt.costEvidence.originalChildReceipt,original);
 assert.deepEqual(reads,['call:'+ca,'children:'+ca,'call:'+ch,'children:'+ch,'audio:'+ch]);
 await run();assert.deepEqual(row.child_receipt.costEvidence.originalChildReceipt,original,'Repeated fresh proof does not nest or discard the original receipt');
}
for(const change of [{status:'completed'},{status:'in-progress'},{duration:'1'},{duration:0},{price:'-0.014'},{price_unit:'EUR'},{sid:'CA'+'e'.repeat(32)},{account_sid:'AC'+'e'.repeat(32)},{parent_call_sid:'CA'+'e'.repeat(32)},{from:'+12025550999'},{to:'+12025550999'},{direction:'outbound-api'},{date_created:new Date(Date.parse(created)-5001).toISOString()},{end_time:undefined},{end_time:new Date(Date.now()-10000).toISOString()},{end_time:new Date(Date.parse(created)-1000).toISOString()}]){reset();Object.assign(child,change);await run();held();}
for(const change of [{recipient_answered_at:created},{connection_type:'phone'},{recording_required:false},{connected_at:null},{child_sid:'CA'+'e'.repeat(32)},{parent_receipt:{...parentReceipt,costMicros:5000}},{parent_receipt:{...parentReceipt,status:'no-answer'}},{child_receipt:{...childReceipt,status:'completed'}},{child_receipt:{...childReceipt,costMicros:1}},{recording_receipt:{...audioReceipt,callSid:ch}},{recording_receipt:{...audioReceipt,sid:'RE'+'e'.repeat(32)}}]){reset();Object.assign(row,change);const original=structuredClone(row);await run();held();await run();held();if(change.recipient_answered_at||change.child_receipt||change.parent_receipt||change.recording_receipt)assert.deepEqual(row,original,'Contradictory original evidence cannot be laundered by repeated polls');}
for(const list of [{calls:[]},{calls:[childBase]},{calls:[],next_page_uri:'/next'},{calls:null}]){reset();descendants=list;await run();held();}
for(const list of [{recordings:[]},{recordings:[{sid:re}],next_page_uri:null},{recordings:[],next_page_uri:'/next'},{recordings:null},new Error('unavailable')]){reset();recordings=list;await run();held();}
reset();children={calls:[childBase]};await run();held();reset();listed={...childBase,status:'busy'};await run();held();
reset();conflict=true;await run();assert.equal(settlements,0);assert.equal(row.child_receipt.costMicros,null);
// First ordinary receipt collection must still work before all known parent
// evidence exists; only a later canonical recheck can establish child zero.
reset();row.parent_receipt=null;await run();held();assert.equal(row.parent_receipt.costMicros,4000);await run();assert.equal(row.child_receipt.costMicros,0);
reset();row.child_receipt=null;await run();held();assert.equal(row.child_receipt.costMicros,null);await run();assert.equal(row.child_receipt.costMicros,0);
console.log('PASS unanswered browser child: canonical child identity/status, complete empty child audio/descendants, original parent/audio costs preserved, contradictory history held, first receipt collection preserved, and CAS rejects late answer.');
