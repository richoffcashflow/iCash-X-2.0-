import {db} from '@/lib/stripe-test';
import {createRecordingProviders} from './required-call-recording-provider.ts';
import {recordingService} from './required-call-recording-service.ts';
export function recordingServer(signal?:AbortSignal){const env={...process.env},deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(12000)]);return recordingService(env,{db:(path,method,body)=>db(path,method,body,deadline),provider:createRecordingProviders(env,fetch,deadline)});}
