import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {settleBoundVoiceUsage,readVoiceUsagePolicies,usdMicros,settlePendingVoiceUsage} from '../lib/voice-usage-service.ts';
import {costCategories} from '../lib/cost-guard.ts';
const policy=()=>({enabled:true,version:'fixture-policy-v1',rateId:'rate',operation:'seller_call',reviewedAt:'2026-01-01',validFrom:'2026-01-01',validUntil:'2027-01-01',evidenceRef:'reviewed fixture policy',components:Object.fromEntries(costCategories.filter(k=>k!=='elevenlabs').map(k=>[k,k==='twilio'?{kind:'duration_estimate',unitSeconds:60,microsPerUnit:14000,rounding:'up',minimumUnits:0,evidenceRef:'fixture supplier price',durationSource:'conversation_proxy',assumption:'Ringing omitted; proxy reviewed as estimated'}:{kind:'fixed_estimate',amountMicros:k==='support_and_overhead'?1000:0,evidenceRef:'reviewed fixture allocation'}]))});
let call,spend,receipt,writes,queries,rpcResult,conflict;
function reset(){call={operation_key:'op',conversation_id:'conv',state:'complete',completed_at:'2026-09-30',created_at:'2026-09-30',result:{durationSeconds:3}};spend={rate_id:'rate',state:'dispatched'};receipt=[{amount:0.01,units:'USD'}];writes=[];queries=[];rpcResult=true;conflict=false;}
async function db(path,method,body){queries.push(path);if(method==='POST'){writes.push(body);if(conflict)throw Error('Settlement conflict');return rpcResult;}
 if(path.startsWith('icash_live_conversations')){assert(path.includes('account_id=eq.account'));return call?[call]:[];}
 if(path.startsWith('icash_operation_spend'))return spend?[spend]:[];
 if(path.startsWith('icash_operation_rates'))return [{operation:'seller_call'}];
 if(path.startsWith('icash_cost_observations')){assert(path.includes('event_key=eq.conv&source_ref=eq.op'));return receipt;}
 throw Error(path);
}
reset();assert.equal((await settleBoundVoiceUsage(db,'account','call',[policy()])).status,'settled');assert.equal(writes[0].p_components.twilio.amountMicros,14000);assert.equal(writes[0].p_components.support_and_overhead.amountMicros,1000);assert.equal(writes[0].p_components.llm.amountMicros,0);assert.equal(writes[0].p_components.elevenlabs.amountMicros,10000);
const original=structuredClone(writes[0]);spend.state='settled';await settleBoundVoiceUsage(db,'account','call',[policy()]);assert.deepEqual(writes[1],original);
conflict=true;const changed=policy();changed.components.support_and_overhead.amountMicros=2000;await assert.rejects(settleBoundVoiceUsage(db,'account','call',[changed]),/conflict/);
reset();call.result.durationSeconds=600;await settleBoundVoiceUsage(db,'account','call',[policy()]);assert.equal(writes[0].p_components.twilio.amountMicros,140000);assert.equal(writes[0].p_components.support_and_overhead.amountMicros,1000);
for(const alter of [()=>{call=null},()=>{call.state='waiting'},()=>{call.completed_at=null},()=>{call.result.durationSeconds=null},()=>{call.result.durationSeconds=-1},()=>{call.result.durationSeconds='3'},()=>{spend=null},()=>{receipt=[]},()=>{receipt[0].units='credits'},()=>{receipt[0].amount=null}]){reset();alter();assert.equal((await settleBoundVoiceUsage(db,'account','call',[policy()])).status,'held');assert.equal(writes.length,0);}
for(const alter of [p=>{p.enabled=false},p=>{p.rateId='other'},p=>{p.operation='incoming_call'},p=>{p.validUntil='2026-09-01'},p=>{p.reviewedAt='2026-10-01'},p=>{delete p.components.github},p=>{p.components.twilio.assumption=''},p=>{p.components.llm.amountMicros=1},p=>{p.components.twilio.durationSource='model_guess'}]){reset();const p=policy();alter(p);assert.equal((await settleBoundVoiceUsage(db,'account','call',[p])).status,'held');assert.equal(writes.length,0);}
reset();assert.equal((await settleBoundVoiceUsage(db,'account','call',[])).status,'held');assert.equal((await settleBoundVoiceUsage(db,'account','call',[policy(),policy()])).status,'held');
rpcResult=false;assert.equal((await settleBoundVoiceUsage(db,'account','call',[policy()])).reason,'ledger_review_required');
assert.deepEqual(readVoiceUsagePolicies('not json'),[]);assert.deepEqual(readVoiceUsagePolicies('{}'),[]);assert.deepEqual(readVoiceUsagePolicies(undefined),[]);
assert.equal(usdMicros('0.0000001'),1);assert.equal(usdMicros(0.000001),1);assert.equal(usdMicros('1.000001'),1000001);assert.equal(usdMicros(0.07),70000);assert.throws(()=>usdMicros(-1));assert.throws(()=>usdMicros(Infinity));
reset();await settlePendingVoiceUsage(()=>{throw Error('must not query disabled config')},'account',[]);
const live=readFileSync(new URL('../lib/live-conversation-service.ts',import.meta.url),'utf8');assert(live.includes("['provider_receipt_missing','duration_missing'].includes(billing.reason)"));assert(live.includes("if(call.state!=='complete')await db('rpc/icash_save_live_result'"));assert(live.indexOf('icash_record_cost_observation')<live.indexOf('icash_save_live_result'));assert(live.lastIndexOf('billing:await settle()')>live.indexOf('icash_save_live_result'));
// More than two old pages of held operations: persisted rotation reaches a late ready row.
const pending=Array.from({length:77},(_,i)=>({operation_key:'op'+String(i).padStart(3,'0'),estimate_checked_at:null}));
let pages=0,visited=[],claims=0,loseClaim=false,lastSignal;
const batchDb=async(path,method,body,signal)=>{
 signal.throwIfAborted();lastSignal=signal;
 const q=new URLSearchParams(path.split('?')[1]);
 assert.equal(q.get('account_id'),'eq.account');
 if(path.startsWith('icash_operation_spend')){
  assert.equal(q.get('state'),'eq.dispatched');assert.equal(q.get('rate_id'),'in.("rate")');
  if(method==='PATCH'){
   assert.deepEqual(Object.keys(body),['estimate_checked_at']);
   if(loseClaim)return [];
   const row=pending.find(row=>'eq.'+row.operation_key===q.get('operation_key'));
   assert.equal(q.get('estimate_checked_at'),row.estimate_checked_at?'eq.'+row.estimate_checked_at:'is.null');
   row.estimate_checked_at=body.estimate_checked_at;claims++;return [{operation_key:row.operation_key}];
  }
  pages++;assert.equal(q.get('limit'),'1');assert.equal(q.get('order'),'estimate_checked_at.asc.nullsfirst,operation_key.asc');
  return pending.filter(row=>!row.settled).sort((a,b)=>(a.estimate_checked_at??'').localeCompare(b.estimate_checked_at??'')||a.operation_key.localeCompare(b.operation_key)).slice(0,1).map(row=>({...row}));
 }
 assert.equal(q.get('limit'),'1');assert.equal(q.get('state'),'eq.complete');
 const op=q.get('operation_key').slice(3);return op==='op002'?[]:[{id:op}];
};
const totals={settled:0,held:0,reviewRequired:0};
for(let i=0;i<77;i++){
 const before=visited.length;
 const batch=await settlePendingVoiceUsage(batchDb,'account',[policy()],async(account,id,signal)=>{
  assert.equal(account,'account');assert.equal(signal,lastSignal);signal.throwIfAborted();visited.push(id);
  if(id==='op001')throw Error('old conflict');
  if(id==='op076')pending.find(row=>row.operation_key===id).settled=true;
  return {billing:{status:id==='op076'?'settled':'held'}};
 });
 assert(visited.length-before<=1,'Provider work must be bounded per invocation');
 for(const key of Object.keys(totals))totals[key]+=batch[key];
}
assert.equal(pages,77);assert.equal(claims,77);assert.equal(visited.length,76);assert.equal(new Set(visited).size,76);
assert.deepEqual(totals,{settled:1,held:74,reviewRequired:1});
// A lost compare-and-set must not reconcile; a retry revisits the oldest held row.
loseClaim=true;let attempts=0;
await settlePendingVoiceUsage(batchDb,'account',[policy()],async()=>{attempts++;return {};});assert.equal(attempts,0);
loseClaim=false;
await settlePendingVoiceUsage(batchDb,'account',[policy()],async(_account,id)=>{assert.equal(id,'op000');return {billing:{status:'held'}};});
// Expired route deadline prevents all new DB/provider work.
const expired=AbortSignal.abort();
await assert.rejects(settlePendingVoiceUsage(()=>{throw Error('must not query after deadline')},'account',[policy()],undefined,expired),{name:'AbortError'});
// Cancellation reaches ongoing reconciliation; it is awaited, not left running in a race.
const controller=new AbortController();let finished=false;
const aborted=await settlePendingVoiceUsage(batchDb,'account',[policy()],async(_account,_id,signal)=>{
 controller.abort();assert.equal(signal.aborted,true);finished=true;signal.throwIfAborted();
},controller.signal);
assert.equal(finished,true);assert.deepEqual(aborted,{settled:0,held:0,reviewRequired:1});
console.log('PASS: bound server collector, immutable pricing, scoped fair one-row claims, 77-row held backlog, conflicts, missing calls, cancellation');

const staged={rateId:'12345678-1234-4234-8234-123456789abc',version:'required-audio-30d-speech-v1:fixture',enabled:false,components:{other:{kind:'recording_addon_estimate'}}};
const activation=JSON.stringify([{rateId:staged.rateId,version:staged.version}]);
assert.equal(readVoiceUsagePolicies(JSON.stringify([staged]),activation)[0].enabled,true);
assert.equal(readVoiceUsagePolicies(JSON.stringify([staged]))[0].enabled,false);
assert.equal(readVoiceUsagePolicies(JSON.stringify([{...staged,version:staged.version+'different'}]),activation)[0].enabled,false);
assert.equal(readVoiceUsagePolicies(JSON.stringify([staged]),'bad json')[0].enabled,false);
assert.equal(readVoiceUsagePolicies(JSON.stringify([{...staged,components:{}}]),activation)[0].enabled,false);
