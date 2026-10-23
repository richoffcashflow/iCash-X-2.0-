import type {Call,Device} from '@twilio/voice-sdk';
export type BrowserCallPhase='connecting'|'ringing'|'connected'|'ended'|'error';
type CallResult={id?:string;parentSid?:string|null;status?:string;connected?:boolean;ended?:boolean;error?:string};
export function guardBrowserCallCallbacks<T extends {onState:(phase:BrowserCallPhase,message?:string)=>void;onStarted:()=>void}>(isCurrent:()=>boolean,callbacks:T){
 return {onState:(phase:BrowserCallPhase,message?:string)=>{if(isCurrent())callbacks.onState(phase,message);},onStarted:()=>{if(isCurrent())callbacks.onStarted();}};
}
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
 private stopped=false;private dispatched=false;private connected=false;private completion?:Promise<void>;private poll?:ReturnType<typeof setInterval>;private timeout?:ReturnType<typeof setTimeout>;private checking=false;
 readonly id:string;private deps:Dependencies;
 constructor(id:string,deps:Dependencies){this.id=id;this.deps=deps;}
 private accept(){
  if(this.stopped||!this.incoming||!this.expectedSid)return;
  const call=this.incoming;this.incoming=undefined;
  if(call.parameters.CallSid!==this.expectedSid){call.reject();return;}
  this.call=call;
  call.on('disconnect',()=>void this.stop());call.on('cancel',()=>void this.stop());call.on('reject',()=>void this.stop());
  call.on('error',()=>{if(this.stopped)return;void this.finish(undefined,'The call disconnected. Check your connection and try again.');});
  call.on('accept',()=>{if(!this.stopped)this.deps.onState('ringing');});
  call.accept();
 }
 async start(){
  this.deps.onState('connecting');
  try{
   await this.deps.microphone();if(this.stopped)return;
   this.timeout=setTimeout(()=>{void this.finish(undefined,'Could not connect browser audio. Please try again.');},60000);
   const prepared=await this.deps.request('prepare',this.id);if(this.stopped)return;
   if(!prepared.token)throw Error(prepared.error||'Calling is temporarily unavailable. Please try again.');
   const device=await this.deps.createDevice(prepared.token);if(this.stopped){device.destroy();return;}this.device=device;
   device.audio?.incoming(false);
   device.on('incoming',(call:Call)=>{if(this.stopped||this.call||this.incoming){call.reject();return;}this.incoming=call;this.accept();});
   device.on('error',()=>{if(this.stopped)return;void this.finish(undefined,'Could not connect browser audio. Check your connection and try again.');});
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
     if(status.connected)this.connected=true;
     if(status.ended||status.status==='failed'||status.status==='completed'){await this.finish(status);return;}
     if(status.connected){if(this.timeout)clearTimeout(this.timeout);this.deps.onState('connected');}
    }catch{/* Keep End call available through a transient refresh failure. */}finally{this.checking=false;}
   };
   this.poll=setInterval(()=>void check(),3000);void check();
   clearTimeout(this.timeout);this.timeout=setTimeout(()=>{void this.finish(undefined,'The call could not connect. Please try again.');},60000);
  }catch(error){
   if(this.stopped)return;
   const name=error instanceof Error?error.name:'';
   await this.finish(undefined,name==='NotAllowedError'?'Allow microphone access in your browser, then try again.':name==='NotFoundError'?'Connect a microphone, then try again.':error instanceof Error?error.message:'Could not connect the call.');
  }
 }
 mute(value:boolean){this.call?.mute(value);}
 stop(){return this.finish();}
 private finish(finalStatus?:CallResult,fallbackError?:string):Promise<void>{
  if(this.stopped)return this.completion??Promise.resolve();this.stopped=true;
  clearInterval(this.poll);clearTimeout(this.timeout);
  // Stop local audio and request carrier cleanup before checking the final receipt.
  this.incoming?.reject();this.call?.disconnect();this.device?.destroy();
  if(this.dispatched)this.deps.onState('error','Browser audio has stopped. Final call status is still being checked.');
  this.completion=(async()=>{
   if(this.dispatched)await this.deps.request('end',this.id).catch(()=>undefined);
   let status=finalStatus;
   if(!status&&this.dispatched)status=await this.deps.status(this.id).catch(()=>undefined);
   if(status?.connected)this.connected=true;
   if(status?.status==='failed')this.deps.onState('error',this.connected?'The call failed after connecting.':'The call failed before connecting to the seller.');
   else if(fallbackError)this.deps.onState('error',fallbackError);
   else if(!this.dispatched||status?.status==='completed')this.deps.onState('ended');
   else this.deps.onState('error','Browser audio has stopped, but the final call status could not be confirmed.');
  })();
  return this.completion;
 }
}
