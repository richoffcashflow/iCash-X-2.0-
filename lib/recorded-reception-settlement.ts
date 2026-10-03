import {object,sha} from './required-call-recording.ts';
import {usdMicros} from './voice-usage-service.ts';
import {receptionUsdNumberMicros} from './general-reception-reconcile.ts';
import {incomingCallMatches,receptionConversationMatches,receptionRecordingMatches,receptionRecordingCosts,recordedReceptionPolicy,type RecordedReceptionRow,type RecordedReceptionRpc} from './recorded-reception.ts';

/** Provider readback attests identity and USD; it never manufactures a cost
 * approval. SQL requires a separate exact, immutable all-16-category review. */
export function receptionSettlementAttestation(row:RecordedReceptionRow,call:Record<string,unknown>,conversation:Record<string,unknown>|null,recording:Record<string,unknown>|null){
 if(!row.call_ended_at||!incomingCallMatches(row,call)||!['completed','failed','busy','no-answer','canceled'].includes(String(call.status))||call.price_unit!=='USD'||typeof call.price!=='string'||!/^-(?:0|[1-9]\d*)(?:\.\d{1,6})?$|^0(?:\.0{1,6})?$/.test(call.price)||typeof call.duration!=='string'||!/^\d+$/.test(call.duration))return null;
 if(row.setup_confirmed_at&&!row.call_started_at&&(call.status==='completed'||call.start_time!==null&&call.start_time!==undefined))return null;
 const duration=Number(call.duration);if(!Number.isSafeInteger(duration)||duration<0||duration>row.max_total_seconds)return null;
 const gate=!row.start_claimed_at&&!row.register_claimed_at&&!row.recording_sid&&!row.conversation_id;
 const providers:Record<string,unknown>={twilio:{amountMicros:usdMicros(call.price.replace(/^-/,'')),currency:'USD',receiptHash:sha(JSON.stringify(call))}};
 let recordingMicros=0,storageMicros=0,streamMicros=0,recordingEstimated=false;
 if(!gate){
  if(!row.conversation_id||!row.recording_sid||!row.consent_at||!row.start_claimed_at||!row.register_claimed_at||!['available','expired','deletion_pending','deleted'].includes(row.state)||row.duration_seconds===null||!row.ended_at||!row.provider_started_at||!conversation||conversation.status!=='done'||!receptionConversationMatches(row,conversation))return null;
  const metadata=object(conversation.metadata),aiSeconds=metadata.call_duration_secs,price=receptionUsdNumberMicros(metadata.cost_fiat);
  if(price===null||typeof aiSeconds!=='number'||!Number.isFinite(aiSeconds)||aiSeconds<0||aiSeconds>row.max_total_seconds||recording&&!receptionRecordingMatches(row,recording))return null;
  const costs=receptionRecordingCosts(row);recordingMicros=costs.recording;storageMicros=costs.storage;recordingEstimated=!costs.recordingObserved;
  // Call resource price excludes Media Streams. Carrier seconds conservatively
  // bound stream time, including rounding; this allocation is not an invoice.
  if(row.pricing_policy.streamMicrosPerMinute!==4400)return null;streamMicros=Math.ceil(duration/60)*4400;
  providers.elevenlabs={amountMicros:price,currency:'USD',receiptHash:sha(JSON.stringify(conversation))};
 }
 return {schemaVersion:1,mode:gate?'gate_only':'recorded',binding:{sessionId:row.id,configId:row.config_id,accountId:row.account_id,operationKey:row.operation_key,providerAccountSid:row.provider_account_sid,callSid:row.call_sid,fromPhone:row.from_phone,toPhone:row.to_phone,direction:'inbound',agentId:row.agent_id,branchId:row.branch_id,versionId:row.version_id,rateId:row.rate_id,chargeCapCents:row.charge_cap_cents,maxTotalSeconds:row.max_total_seconds,conversationId:row.conversation_id,recordingSid:row.recording_sid},durationSeconds:duration,providers,
  recording:{policyVersion:recordedReceptionPolicy,speechGatherMicros:row.setup_confirmed_at?20000:0,recordingMicros,storageMicros,streamMicros,recordingEstimated}};
}
export async function settleRecordedReception(rpc:RecordedReceptionRpc,row:RecordedReceptionRow,call:Record<string,unknown>,conversation:Record<string,unknown>|null,recording:Record<string,unknown>|null){
 const attestation=receptionSettlementAttestation(row,call,conversation,recording);if(!attestation)return {settled:false,reason:'complete_bound_provider_costs_required'};
 const result=object(await rpc('icash_settle_recorded_reception',{p_id:row.id,p_account:row.account_id,p_operation:row.operation_key,p_attestation:attestation}));
 if(result.settled===true&&typeof result.chargedCents==='number'&&Number.isSafeInteger(result.chargedCents)&&result.chargedCents>=0&&result.chargedCents<=row.charge_cap_cents&&['verified','estimated'].includes(String(result.costBasis)))return {settled:true,chargedCents:result.chargedCents,costBasis:result.costBasis,...(result.reviewRequired===true?{reviewRequired:true}:{})};
 return {settled:false,reason:result.settled===false?'cost_review_required':'settlement_status_unconfirmed'};
}
