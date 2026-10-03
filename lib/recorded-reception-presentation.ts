import {receptionAudioAvailable,receptionRecordingCosts,type RecordedReceptionRow} from './recorded-reception.ts';
/** Exact output allowlist. Do not send provider URLs, caller phone/hash,
 * capability hashes, raw config, transcript or provider payloads to the browser. */
export function recordedReceptionPresentation(row:RecordedReceptionRow,now=Date.now()){
 const expired=!!row.audio_expires_at&&Date.parse(row.audio_expires_at)<=now;
 const audioAvailable=receptionAudioAvailable(row,now);
 const status=row.state==='deleted'?'deleted':row.state==='deletion_pending'?'deletion_pending':expired?'expired':row.state==='available'&&!audioAvailable?'processing':row.state;
 let addon:ReturnType<typeof receptionRecordingCosts>|null=null;try{if(row.duration_seconds!==null)addon=receptionRecordingCosts(row);}catch{/* Missing evidence remains unknown. */}
 const paid=typeof row.charged_cents==='number'&&Number.isSafeInteger(row.charged_cents)&&row.charged_cents>=0?row.charged_cents:null;
 return {id:row.id,createdAt:row.created_at,status,callEnded:!!row.call_ended_at,audioAvailable,durationSeconds:row.duration_seconds,audioExpiresAt:row.audio_expires_at,holdCents:row.charge_cap_cents,chargedCents:paid,billingMode:typeof row.cost_policy_id==='string'?'automatic':'manual_review',reviewRequired:row.last_error==='settled_receipt_conflict',
  recordingCostMicros:addon?.recording??null,recordingCostBasis:addon?(addon.recordingObserved?'observed':'estimated'):'pending',storageEstimateMicros:addon?.storage??null,speechGatherEstimateMicros:row.setup_confirmed_at?20000:null,
  providerRecordingSid:row.recording_sid??null,retentionDays:30,costBasis:['verified','estimated'].includes(String(row.cost_basis))?row.cost_basis:'pending'};
}
