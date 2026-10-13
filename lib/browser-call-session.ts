import type {Call,Device} from '@twilio/voice-sdk';
export type BrowserCallPhase='connecting'|'ringing'|'connected'|'ended'|'error';
type CallResult={id?:string;parentSid?:string|null;status?:string;connected?:boolean;ended?:boolean;error?:string};
type Dependencies={
 createDevice:(token:string)=>Promise<Device>;
 microphone:()=>Promise<void>;
 request:(action:'prepare'|'start'|'end',id:string)=>Promise<CallResult&{token?:string}>;
 status:(id:string)=>Promise<CallResult>;
 onState:(phase:BrowserCallPhase,message?:string)=>void;
 onStarted:()=>void;
};
/** One explicit click creates at most one call; late results never revive a stopped session. */
export class BrowserCallSession {
 private device?:Device;private call?:Call;private incoming?:Call;private expectedSid?:string|null;
 private stopped=false;private dispatched=false;private poll?:ReturnType<typeof setInterval>;private timeout?:ReturnType<typeof setTimeout>;private checking=false;
 readonly id:string;private deps:Dependencies;
 constructor(id:string,deps:Dependencies){this.id=id;this.deps=deps;}
 private accept(){
  if(this.stopped||!this.incoming||!this.expectedSid)return;
  const call=this.incoming;this.incoming=undefined;
  if(call.parameters.CallSid!==this.expectedSid){call.reject();return;}
  this.call=call;
  call.on('disconnect',()=>void this.stop());call.on('cancel',()=>void this.stop());call.on('reject',()=>void this.stop());
  call.on('error',()=>{if(this.stopped)return;void this.stop();this.deps.onState('error','The call disconnected. Check your connection and try again.');});
  call.on('accept',()=>{if(!this.stopped)this.deps.onState('ringing');});
  call.accept();
 }
 async start(){
  this.deps.onState('connecting');
  try{
   await this.deps.microphone();if(this.stopped)return;
   this.timeout=setTimeout(()=>{void this.stop();this.deps.onState('error','Could not connect browser audio. Please try again.');},60000);
   const prepared=await this.deps.request('prepare',this.id);if(this.stopped)return;
   if(!prepared.token)throw Error(prepared.error||'Browser calling is unavailable. Use your phone instead.');
   const device=await this.deps.createDevice(prepared.token);if(this.stopped){device.destroy();return;}this.device=device;
   device.audio?.incoming(false);
   device.on('incoming',(call:Call)=>{if(this.stopped||this.call||this.incoming){call.reject();return;}this.incoming=call;this.accept();});
   device.on('error',()=>{if(this.stopped)return;void this.stop();this.deps.onState('error','Could not connect browser audio. Check your connection or use your phone instead.');});
   await device.register();if(this.stopped)return;
   this.dispatched=true;
   const result=await this.deps.request('start',this.id);
   if(this.stopped){await this.deps.request('end',this.id).catch(()=>undefined);return;}
   if(!result.id)throw Error(result.error||'Could not start the call.');
   this.deps.onStarted();this.expectedSid=result.parentSid;this.accept();
   const check=async()=>{
    if(this.stopped||this.checking)return;this.checking=true;
    try{const status=await this.deps.status(this.id);if(this.stopped)return;
     if(status.parentSid){this.expectedSid=status.parentSid;this.accept();}
     if(status.ended){await this.stop();return;}
     if(status.connected){if(this.timeout)clearTimeout(this.timeout);this.deps.onState('connected');}
    }catch{/* Keep End call available through a transient refresh failure. */}finally{this.checking=false;}
   };
   this.poll=setInterval(()=>void check(),3000);void check();
   clearTimeout(this.timeout);this.timeout=setTimeout(()=>{void this.stop();this.deps.onState('error','The call could not connect. Please try again.');},60000);
  }catch(error){
   await this.stop();
   const name=error instanceof Error?error.name:'';
   this.deps.onState('error',name==='NotAllowedError'?'Allow microphone access to call from your browser. You can also use your phone.':name==='NotFoundError'?'Connect a microphone, or use your phone instead.':error instanceof Error?error.message:'Could not connect the call.');
  }
 }
 mute(value:boolean){this.call?.mute(value);}
 async stop(){
  if(this.stopped)return;this.stopped=true;
  clearInterval(this.poll);clearTimeout(this.timeout);
  this.incoming?.reject();this.call?.disconnect();this.device?.destroy();
  this.deps.onState('ended');
  if(this.dispatched)await this.deps.request('end',this.id).catch(()=>undefined);
 }
}
