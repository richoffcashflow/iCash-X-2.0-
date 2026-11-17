import assert from 'node:assert/strict';
import {recordedAnswerDetectionMicros,recordingAddonCosts} from '../lib/required-call-recording-cost.ts';
import {settleBoundVoiceUsage} from '../lib/voice-usage-service.ts';
import {costCategories} from '../lib/cost-guard.ts';
const when='2026-11-16T00:00:00.000Z';
const base={entry_policy:'direct_recorded_v1',call_context:{},pricing_policy:{version:'required-audio-30d-speech-v1'},state:'available',duration_seconds:60,provider_recording_price_micros:null,rate_id:'rate',recording_sid:'REfixture',call_sid:'CAfixture',recording_authorized_at:when,start_claimed_at:when,conversation_id:'conv',provider_started_at:when,ended_at:'2026-11-16T00:01:00.000Z'};
const marked={...base,call_context:{answerPolicy:'carrier_amd_enable_v1'}};
const legacy=recordingAddonCosts(base);
assert.deepEqual(legacy,{recording:2500,storage:536,speech:0,total:3036,recordingObserved:false});
assert.equal(recordedAnswerDetectionMicros(base),0);assert.equal(recordedAnswerDetectionMicros(marked),7500);
for(const value of [null,false,{},'unknown'])assert.throws(()=>recordedAnswerDetectionMicros({...base,call_context:{answerPolicy:value}}),/ANSWER_DETECTION_POLICY_REQUIRED/);
assert.throws(()=>recordedAnswerDetectionMicros({...marked,entry_policy:'spoken_v1'}),/ANSWER_DETECTION_POLICY_REQUIRED/);
for(const seconds of [0,1,60,61,600]){
 const a=recordingAddonCosts({...marked,duration_seconds:seconds}),old=recordingAddonCosts({...base,duration_seconds:seconds});
 assert.equal(a.total,old.total+7500);assert.equal(a.answerDetection,7500);assert.equal(a.speech,0);assert(a.total<=38500);
}
const policy={enabled:true,rateId:'rate',version:'required-audio-30d-speech-v1:fixture',operation:'seller_call',reviewedAt:'2026-01-01',validFrom:'2026-01-01',validUntil:'9999-12-31',evidenceRef:'Synthetic reviewed provider estimate policy',components:Object.fromEntries(costCategories.filter(k=>k!=='elevenlabs').map(k=>[k,k==='other'?{kind:'recording_addon_estimate',policyVersion:'required-audio-30d-speech-v1',evidenceRef:'Synthetic recording tariff'}:{kind:'fixed_estimate',amountMicros:0,evidenceRef:'Synthetic fixed overhead tariff'}]))};
for(const row of [base,marked]){
 const writes=[];
 const db=async(path,method,body)=>{
  if(path.startsWith('icash_live_conversations?'))return [{operation_key:'op',conversation_id:'conv',state:'complete',completed_at:when,created_at:when,result:{durationSeconds:60}}];
  if(path.startsWith('icash_operation_spend?'))return [{rate_id:'rate',state:'dispatched'}];
  if(path.startsWith('icash_operation_rates?'))return [{operation:'seller_call',version:policy.version}];
  if(path.startsWith('icash_cost_observations?'))return [{amount:'0.010000',units:'USD'}];
  if(path.startsWith('icash_call_recordings?'))return [row];
  assert.equal(path,'rpc/icash_settle_voice_usage');writes.push(body);return true;
 };
 assert.equal((await settleBoundVoiceUsage(db,'account','call',[policy])).status,'settled');
 const other=writes[0].p_components.other;
 assert.equal(other.amountMicros,row===marked?10536:3036);assert.equal(other.basis,'estimated');
 if(row===marked)assert.deepEqual(other.subitems,{recordingMicros:2500,storageMicros:536,speechGatherMicros:0,answerDetectionMicros:7500});
 else assert.equal(Object.hasOwn(other,'subitems'),false);
 await settleBoundVoiceUsage(db,'account','call',[policy]);assert.deepEqual(writes[1],writes[0]);
}
console.log('PASS carrier AMD costs: prospective marker, legacy shape, covered ceiling, exact complete collector and immutable retries');
const {recordingPresentation}=await import('../lib/required-call-recording-receipt.ts');
for(const source of [base,marked]){
 const row={...source,id:'fixture-recording',account_id:'account',operation_key:'op'};
 const db=async path=>{
  if(path.startsWith('icash_live_conversations?'))return [{conversation_id:'conv',operation_key:'op'}];
  if(path.startsWith('icash_call_recordings?'))return [row];
  if(path.startsWith('icash_operation_spend?'))return [{state:'settled',charged_cents:10,cost_basis:'estimated'}];
  if(path.startsWith('icash_cost_observations?'))return [{provider:'elevenlabs',amount:'0.01',units:'usd'}];
  if(path.startsWith('icash_cost_manifests?'))return [{components:{twilio:{amountMicros:14000,basis:'verified'}}}];
  assert.fail(path);
 };
 const presentation=await recordingPresentation(db,'account','call'),items=presentation.costs.items.filter(x=>x.label==='Carrier answer detection');
 assert.deepEqual(items,source===marked?[{label:'Carrier answer detection',basis:'estimated',amountMicros:7500}]:[]);
}
