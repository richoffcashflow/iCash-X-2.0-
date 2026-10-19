// Synthetic, in-process receipts only. No providers, credentials, paid usage or external writes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {costCategories} from '../lib/cost-guard.ts';
import {settleRecordingGateOnly} from '../lib/required-call-recording-billing.ts';
import {maintainRecordings} from '../lib/required-call-recording-maintenance.ts';
const now=Date.now(),iso=new Date(now-60000).toISOString();
const ac='AC'+'a'.repeat(32),ca='CA'+'b'.repeat(32),id='11111111-1111-4111-8111-111111111111';
const row={id,account_id:'22222222-2222-4222-8222-222222222222',operation_key:'voice:33333333-3333-4333-8333-333333333333',rate_id:id,charge_cap_cents:977,provider_account_sid:ac,call_sid:ca,from_phone:'+12125550101',to_phone:'+12125550102',entry_policy:'direct_recorded_v1',state:'declined',recording_sid:null,conversation_id:null,start_claimed_at:null,call_ended_at:null,end_requested_at:null,created_at:iso,reconcile_lease_token:id};
const carrier={sid:ca,account_sid:ac,from:row.from_phone,to:row.to_phone,direction:'outbound-api',date_created:iso,status:'completed',duration:'0',price:'0.000000',price_unit:'USD'};
const costs=Object.fromEntries(costCategories.map(key=>[key,0]));
function fixture({receipt={},recording={},rate=[{costs_micros:costs}],settlement={settled:true},finish=true,providerError=null}={}){
 const r={...row,...recording},writes=[],reads=[];let calls=0;
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_claim_call_recording_work')return body.p_kind==='reconcile'?[r]:[];
  if(path==='rpc/icash_call_credit_available')return true;
  if(path.startsWith('icash_operation_rates?')){reads.push(path);return rate;}
  writes.push({path,body});
  if(path==='rpc/icash_note_recorded_gate_terminal')return true;
  if(path==='rpc/icash_settle_unstarted_recorded_call')return settlement;
  if(path==='rpc/icash_finish_call_recording_work')return finish?r:null;
  throw Error('Unexpected synthetic database action');
 };
 const forbidden=async()=>{throw Error('No provider mutations permitted');};
 const provider={getCall:async()=>{calls++;if(providerError)throw providerError;return {...carrier,...receipt};},dial:forbidden,start:forbidden,register:forbidden,end:forbidden};
 return {r,writes,reads,get calls(){return calls;},run:()=>settleRecordingGateOnly(db,provider,r,now),maintain:()=>maintainRecordings(db,provider,{TWILIO_ACCOUNT_SID:ac})};
}
for(const [name,receipt,reason] of [
 ['null price',{price:null},'terminal_carrier_price_pending'],
 ['missing price',{price:undefined},'terminal_carrier_price_pending'],
 ['malformed price',{price:'not-a-price'},'terminal_carrier_price_invalid'],
 ['numeric price',{price:0},'terminal_carrier_price_invalid'],
 ['non-USD price',{price:'-0.1',price_unit:'EUR'},'terminal_carrier_price_invalid'],
 ['positive credit',{price:'0.1'},'terminal_carrier_price_invalid'],
 ['sub-micro precision',{price:'-0.0000001'},'terminal_carrier_price_invalid'],
 ['missing currency',{price:'-0.1',price_unit:null},'terminal_carrier_price_invalid'],
])test(name+' remains held without settlement',async()=>{
 const f=fixture({receipt});assert.deepEqual(await f.run(),{settled:false,status:'held',reason});
 assert.deepEqual(f.writes.map(x=>x.path),['rpc/icash_note_recorded_gate_terminal']);assert.equal(f.reads.length,0);
 assert(!('price' in f.writes[0].body.p_receipt),'Lifecycle evidence does not invent a billing receipt');
});
for(const receipt of [{sid:'CA'+'c'.repeat(32)},{account_sid:'AC'+'c'.repeat(32)},{to:'+12125550999'},{direction:'inbound'},{status:'in-progress'},{duration:null},{duration:'0.5'},{duration:'601'}])test('noncanonical or nonterminal receipt is rejected before lifecycle writes: '+JSON.stringify(receipt),async()=>{
 const f=fixture({receipt});assert.equal((await f.run()).reason,'terminal_carrier_receipt_required');assert.equal(f.writes.length,0);
});
for(const entry_policy of [undefined,null,'',{},'future_policy'])test('unknown entry policy never defaults to a billable consent policy: '+JSON.stringify(entry_policy),async()=>{
 const f=fixture({recording:{entry_policy}});assert.equal((await f.run()).reason,'gate_entry_policy_required');assert.equal(f.calls,0);assert.equal(f.writes.length,0);
});
test('a missing rate and rejected settlement have distinct typed reasons',async()=>{
 const missing=fixture({rate:[]});assert.equal((await missing.run()).reason,'reviewed_costs_required');assert.equal(missing.writes.length,1);
 for(const settlement of [null,false,{}, {settled:false,reason:'UNTRUSTED_RAW_RPC_FIELD'}]){
  const f=fixture({settlement});assert.equal((await f.run()).reason,'terminal_carrier_settlement_rejected');assert.equal(f.writes.at(-1).path,'rpc/icash_settle_unstarted_recorded_call');
 }
});
for(const [entry_policy,state,status,speech] of [
 ['direct_recorded_v1','declined','completed',false],['direct_recorded_v1','failed','completed',false],
 ['spoken_v1','declined','completed',true],['spoken_v1','failed','completed',true],['spoken_v1','failed','busy',false],
])test('policy-specific speech '+[entry_policy,state,status].join('/'),async()=>{
 const f=fixture({recording:{entry_policy,state},receipt:{status}});assert.equal((await f.run()).settled,true);
 const b=f.writes.at(-1).body;assert.equal(b.p_receipt.speechGatherUsed,speech);assert.equal(b.p_components.other.amountMicros,speech?20000:0);assert.equal(b.p_components.elevenlabs.amountMicros,0);assert.equal(b.p_components.llm.amountMicros,0);assert.equal(b.p_receipt.priceMicros,0);assert.equal(b.p_receipt.currency,'USD');
});
test('verified exact carrier costs and unanswered zero retain existing normalization',async()=>{
 const priced=fixture({receipt:{price:'-0.014000000',price_unit:'usd'}});assert.equal((await priced.run()).settled,true);assert.equal(priced.writes.at(-1).body.p_receipt.priceMicros,14000);
 const unanswered=fixture({recording:{state:'failed'},receipt:{status:'no-answer',duration:null,price:null,price_unit:null}});assert.equal((await unanswered.run()).settled,true);assert.equal(unanswered.writes.at(-1).body.p_receipt.priceMicros,0);
});
test('maintenance persists only typed hold codes and a minimal diagnostic whitelist',async()=>{
 const warnings=[],original=console.warn;console.warn=(...args)=>warnings.push(args);
 try{
  const f=fixture({receipt:{price:'RAW_PROVIDER_PRIVATE_VALUE',debug:'NEVER_LOG_RAW_PROVIDER'},settlement:{reason:'UNTRUSTED_RPC_REASON'}});
  assert.equal((await f.maintain()).held,1);assert.equal(f.writes.at(-1).body.p_payload.reason,'terminal_carrier_price_invalid');
  assert.deepEqual(warnings,[['recording_reconcile_diagnostic',{stage:'carrier',recordingId:id,reason:'terminal_carrier_price_invalid'}]]);
  assert(!/1212555|RAW_PROVIDER|UNTRUSTED|account_sid|price_unit/.test(JSON.stringify(warnings)));
  warnings.length=0;
  const rejected=fixture({settlement:{settled:false,reason:'UNTRUSTED_RPC_REASON'},finish:false});await rejected.maintain();
  assert.equal(rejected.writes.at(-1).body.p_payload.reason,'terminal_carrier_settlement_rejected');
  assert.deepEqual(warnings.map(x=>x[1].reason),['terminal_carrier_settlement_rejected','recording_retry_not_saved']);
  warnings.length=0;
  const failed=fixture({providerError:Error('RAW_PROVIDER_PRIVATE_VALUE')});await failed.maintain();
  assert.equal(failed.writes.at(-1).body.p_payload.reason,'provider_recording_reconciliation_required');assert(!JSON.stringify(warnings).includes('RAW_PROVIDER_PRIVATE_VALUE'));
 }finally{console.warn=original;}
});
