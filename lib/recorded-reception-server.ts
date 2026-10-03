import {db} from '@/lib/stripe-test';
import {createRecordedReceptionProviders} from './recorded-reception-provider.ts';
import {recordedReceptionService} from './recorded-reception-service.ts';
export function recordedReceptionServer(signal?:AbortSignal){const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(14000)]),env={...process.env};return recordedReceptionService(env,{rpc:(name,body)=>db('rpc/'+name,'POST',body??{},deadline),provider:createRecordedReceptionProviders(env,fetch,deadline)});}
