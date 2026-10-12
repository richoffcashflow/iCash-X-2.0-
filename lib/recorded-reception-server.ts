import {db} from '@/lib/stripe-test';
import {createRecordedReceptionProviders} from './recorded-reception-provider.ts';
import {recordedReceptionService} from './recorded-reception-service.ts';
import {selectedCustomCallVoice} from './custom-voice.ts';
import {selectedRecordedReceptionVoice} from './recorded-reception-voice.ts';
export function recordedReceptionServer(signal?:AbortSignal){
 const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(14000)]),env={...process.env};
 const provider=createRecordedReceptionProviders(env,fetch,deadline);
 return recordedReceptionService(env,{
  rpc:(name,body)=>db('rpc/'+name,'POST',body??{},deadline),provider,
  selectVoice:(accountId,config)=>selectedRecordedReceptionVoice(accountId,config,{selectVoice:selectedCustomCallVoice,agent:provider.agent},deadline),
 });
}
