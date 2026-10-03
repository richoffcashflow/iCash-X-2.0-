import {db} from '@/lib/stripe-test';
import {createRecordingProviders} from './required-call-recording-provider.ts';
import {ownerCallReplyInspector} from './owner-call-reply-inspector.ts';

export function ownerCallReplyInspectorServer(requestSignal:AbortSignal){
 const signal=AbortSignal.any([requestSignal,AbortSignal.timeout(25000)]);
 return ownerCallReplyInspector(process.env,{
  db:(path,method,body)=>db(path,method,body,signal),
  provider:createRecordingProviders(process.env,fetch,signal),
 });
}
