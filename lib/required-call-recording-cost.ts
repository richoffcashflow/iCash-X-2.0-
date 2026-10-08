import {recordingAuthorized} from './direct-call-entry.ts';
import type {RecordingRow} from './required-call-recording.ts';
/** Audio expiry removes playback, not the immutable completed provider receipt needed for billing. */
export function completedRecordingReceipt(row:RecordingRow){
 return ['available','expired','deletion_pending','deleted'].includes(row.state)&&!!row.recording_sid&&!!row.call_sid&&recordingAuthorized(row)&&!!row.start_claimed_at&&!!row.conversation_id&&Number.isFinite(Date.parse(row.provider_started_at??''))&&Number.isFinite(Date.parse(row.ended_at??''))&&Date.parse(row.ended_at!)>=Date.parse(row.provider_started_at!)&&Number.isSafeInteger(row.duration_seconds)&&row.duration_seconds!>=0&&row.duration_seconds!<=600;
}
/** Derive estimates from recorded duration, never total AI/carrier duration. */
export function recordingAddonCosts(row:RecordingRow){
 if(row.pricing_policy.version!=='required-audio-30d-speech-v1'||!Number.isSafeInteger(row.duration_seconds)||row.duration_seconds!<0||row.duration_seconds!>600)throw Error('RECORDING_COST_EVIDENCE_REQUIRED');
 const minutes=Math.ceil(row.duration_seconds!/60);
 const recording=row.provider_recording_price_micros??minutes*2500;
 // Conservative daily billing allocation: 30 days over shortest billing month.
 const storage=Math.ceil(minutes*500*30/28);
 const speech=row.entry_policy==='direct_recorded_v1'?0:20000;
 return {recording,storage,speech,total:recording+storage+speech,recordingObserved:row.provider_recording_price_micros!==null};
}
