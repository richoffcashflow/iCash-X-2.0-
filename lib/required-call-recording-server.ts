import {db} from '@/lib/stripe-test';
import {createRecordingProviders} from './required-call-recording-provider.ts';
import {readRecordingReview} from './required-call-recording.ts';
import {recordingService} from './required-call-recording-service.ts';
export function recordingServer(signal?:AbortSignal){
 const env={...process.env},deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(12000)]);
 return recordingService(env,{
  db:(path,method,body)=>db(path,method,body,deadline),
  // A provider timeout or caller disconnect must not also cancel saving its
  // result. This separate, bounded writer is only used after the dial claim.
  receiptDb:(path,method,body)=>db(path,method,body,AbortSignal.timeout(8000)),
  provider:createRecordingProviders(env,fetch,deadline),
  dispatchAllowed:()=>!deadline.aborted&&process.env.ICASH_LIVE_WORK_READY==='true'&&process.env.ICASH_RECORDED_OUTBOUND_READY==='true'&&process.env.ICASH_RECORDING_RECEIPTS_READY==='true'&&process.env.RECORDED_OUTBOUND_REVIEW_JSON===env.RECORDED_OUTBOUND_REVIEW_JSON&&!!readRecordingReview(process.env.RECORDED_OUTBOUND_REVIEW_JSON),
 });
}
