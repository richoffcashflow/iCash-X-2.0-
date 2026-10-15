import {db} from '@/lib/stripe-test';
import {createRecordedReceptionProviders} from './recorded-reception-provider.ts';
import {recordedReceptionService} from './recorded-reception-service.ts';
import {selectedCustomCallVoice} from './custom-voice.ts';
import {selectedRecordedReceptionVoice} from './recorded-reception-voice.ts';
import {createVoiceMetering} from './voice-live-metering.ts';
export function recordedReceptionServer(signal?:AbortSignal){
 const deadline=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(14000)]),env={...process.env};
 const provider=createRecordedReceptionProviders(env,fetch,deadline);
 const rpc=<T=unknown>(name:string,body:Record<string,unknown>)=>db<T>('rpc/'+name,'POST',body,deadline);
 return recordedReceptionService(env,{
  rpc:(name,body)=>rpc(name,body??{}),provider,
  ...(env.ICASH_VOICE_METERING_READY==='true'?{meter:createVoiceMetering(rpc,provider)}:{}),
  selectVoice:(accountId,config)=>selectedRecordedReceptionVoice(accountId,config,{selectVoice:selectedCustomCallVoice,agent:provider.agent},deadline),
 });
}
