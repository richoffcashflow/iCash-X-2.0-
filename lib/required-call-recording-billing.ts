import {costCategories} from './cost-guard.ts';
import {object,type RecordingRow} from './required-call-recording.ts';
import {recordingAddonCosts,completedRecordingReceipt} from './required-call-recording-cost.ts';
import {canonicalCall,type RecordingDb} from './required-call-recording-service.ts';
import type {RecordingProviders,RecordingEnv} from './required-call-recording-provider.ts';
import {settleBoundVoiceUsage,usdMicros,type VoiceUsagePolicy} from './voice-usage-service.ts';
/** Separate adapter: legacy zero-add-on policies must never settle a recorded call. */
export async function settleRecordedVoice(db:RecordingDb,accountId:string,callId:string,row:RecordingRow,policies:VoiceUsagePolicy[],env:RecordingEnv){
 if(row.account_id!==accountId||!row.conversation_id||!completedRecordingReceipt(row))return {status:'held',reason:'recording_receipt_required'};
 const policy=policies.find(p=>p.enabled&&p.rateId===row.rate_id&&p.version.startsWith('required-audio-30d-speech-v1:'));
 if(!policy||policies.filter(p=>p.enabled&&p.rateId===row.rate_id).length!==1)return {status:'held',reason:'recording_cost_policy_required'};
 if(policy.components.other.kind!=='recording_addon_estimate')return {status:'held',reason:'recording_cost_policy_required'};
 const [bound]=await db<{conversation_id:string;operation_key:string}[]>(`icash_live_conversations?id=eq.${encodeURIComponent(callId)}&account_id=eq.${encodeURIComponent(accountId)}&select=conversation_id,operation_key`);
 if(!bound||bound.conversation_id!==row.conversation_id||bound.operation_key!==row.operation_key)return {status:'held',reason:'recording_call_binding_required'};
 return settleBoundVoiceUsage(db,accountId,callId,[policy],{env});
}
/** No invented ElevenLabs receipt for a call that ended at the consent gate. */
export async function settleRecordingGateOnly(db:RecordingDb,provider:RecordingProviders,row:RecordingRow,now=Date.now()){
 if(row.conversation_id||row.start_claimed_at||row.recording_sid||!row.call_sid||!['declined','failed','absent'].includes(row.state))return {status:'held',reason:'not_gate_only'};
 const c=await provider.getCall(row.call_sid);
 if(!canonicalCall(row,c,now,false,false)||!['completed','busy','failed','no-answer','canceled'].includes(String(c.status))||typeof c.duration!=='string'||!/^\d+$/.test(c.duration)||Number(c.duration)>600)return {status:'held',reason:'terminal_carrier_receipt_required'};
 // A verified ended call must not remain dispatching just because its price is pending.
 await db('rpc/icash_note_recorded_gate_terminal','POST',{p_id:row.id,p_account:row.account_id,p_operation:row.operation_key,p_receipt:{sid:c.sid,account_sid:c.account_sid,from:c.from,to:c.to,direction:c.direction,status:c.status,date_created:c.date_created,duration:c.duration}});
 if(typeof c.price!=='string'||!/^-[0-9]+(?:\.[0-9]{1,6})?$|^0(?:\.0{1,6})?$/.test(c.price)||c.price_unit!=='USD')return {status:'held',reason:'terminal_carrier_receipt_required'};
 const price=usdMicros(c.price.replace(/^-/,'') ),speech=row.entry_policy!=='direct_recorded_v1'&&(row.state==='declined'||c.status==='completed');
 const [rate]=await db<{costs_micros:Record<string,number>}[]>(`icash_operation_rates?id=eq.${row.rate_id}&select=costs_micros`);if(!rate)return {status:'held',reason:'reviewed_costs_required'};
 const components=Object.fromEntries(costCategories.map(k=>[k,{amountMicros:rate.costs_micros[k],basis:'estimated',evidenceRef:'Reviewed gate-only operation overhead; '+row.rate_id}]));
 components.elevenlabs={amountMicros:0,basis:'not_applicable',evidenceRef:'No ElevenLabs registration or recording-start attempt for '+row.id};
 components.llm={amountMicros:0,basis:'not_applicable',evidenceRef:'No ElevenLabs registration or model use for '+row.id};
 components.twilio={amountMicros:price,basis:'verified',evidenceRef:'Canonical terminal Twilio Call '+row.call_sid};
 components.other=Object.assign({amountMicros:speech?20000:0,basis:'estimated',evidenceRef:'One consent Gather estimate only; audio recording and storage not applicable'}, {subitems:{speechGatherMicros:speech?20000:0,recordingMicros:0,storageMicros:0}});
 return db('rpc/icash_settle_unstarted_recorded_call','POST',{p_id:row.id,p_account:row.account_id,p_operation:row.operation_key,p_receipt:{providerAccountSid:row.provider_account_sid,callSid:row.call_sid,fromPhone:row.from_phone,toPhone:row.to_phone,status:c.status,durationSeconds:Number(c.duration),priceMicros:price,currency:'USD',speechGatherUsed:speech},p_components:components,p_evidence:'Canonical Twilio terminal call receipt, no agent registration, reviewed speech-gather estimate: '+row.id});
}
