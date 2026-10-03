import type {OwnerRecordingRun} from './owner-recording-test.ts';
import {sid} from './required-call-recording.ts';

/** An ended, unstarted technical gate failure can retain its entire $1 while price is pending. */
export function ownerPendingCarrierCandidate(r:OwnerRecordingRun){
 return r.state==='failed'&&r.last_error==='owner_carrier_price_pending'&&r.reserved_micros===1000000&&r.configuration.quote.maxAttemptMicros===1000000
  &&sid(r.call_sid,'CA')&&!!r.call_started_at&&!!r.end_requested_at&&!!r.call_ended_at&&r.contact_opted_out===false
  &&[r.consent_at,r.consent_evidence,r.start_claimed_at,r.registration_claimed_at,r.recording_sid,r.conversation_id,
   r.provider_started_at,r.audio_expires_at,r.duration_seconds,r.recording_price_micros,r.deleted_at,r.settled_at,r.settled_micros,r.settlement].every(x=>x===null);
}
export function ownerPendingCarrierReceipt(r:OwnerRecordingRun,c:Record<string,unknown>){
 if(!ownerPendingCarrierCandidate(r)||c.sid!==r.call_sid||c.account_sid!==r.configuration.review.providerAccountSid||c.from!==r.configuration.from_phone||c.to!==r.configuration.phone||c.direction!=='outbound-api'||c.status!=='completed'||c.price!==null||c.price_unit!=='USD'||typeof c.duration!=='string'||!/^(0|[1-9][0-9]?)$/.test(c.duration)||Number(c.duration)>60||typeof c.start_time!=='string'||!Number.isFinite(Date.parse(c.start_time))||Date.parse(c.start_time)!==Date.parse(r.call_started_at!))return null;
 return {sid:c.sid,account_sid:c.account_sid,from:c.from,to:c.to,direction:c.direction,status:c.status,price:null,price_unit:'USD',duration:c.duration,start_time:c.start_time};
}
export function ownerPriorRunClear(r:OwnerRecordingRun){return !!r.call_ended_at&&r.contact_opted_out===false&&r.settled_at!==null&&r.settled_at!==undefined&&r.settlement!==null&&r.settled_micros!==null&&r.settled_micros<=r.reserved_micros;}
