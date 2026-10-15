import {db} from '@/lib/stripe-test';
import {createRecordingProviders} from './required-call-recording-provider.ts';
import {readRecordingReview} from './required-call-recording.ts';
import {recordingService} from './required-call-recording-service.ts';
import {createVoiceMetering} from './voice-live-metering.ts';
export function recordingServer(signal?:AbortSignal){
 const env={...process.env},deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(12000)]);
 const database:typeof db=(path,method,body)=>db(path,method,body,deadline),provider=createRecordingProviders(env,fetch,deadline);
 return recordingService(env,{db:database,provider,
  ...(env.ICASH_VOICE_METERING_READY==='true'?{meter:createVoiceMetering((name,body)=>database('rpc/'+name,'POST',body),provider)}:{}),
  dispatchAllowed:()=>process.env.ICASH_LIVE_WORK_READY==='true'&&process.env.ICASH_RECORDED_OUTBOUND_READY==='true'&&process.env.ICASH_RECORDING_RECEIPTS_READY==='true'&&process.env.RECORDED_OUTBOUND_REVIEW_JSON===env.RECORDED_OUTBOUND_REVIEW_JSON&&!!readRecordingReview(process.env.RECORDED_OUTBOUND_REVIEW_JSON)});
}
