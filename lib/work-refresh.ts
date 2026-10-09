/** Refresh saved work without replacing forms or overlapping network requests. */
export const workUpdatedEvent = 'icash:work-updated';

export function notifyWorkUpdated() {
 if (typeof window !== 'undefined') window.dispatchEvent(new Event(workUpdatedEvent));
}

export function startWorkPolling<T>({load,onData,onError,intervalMs=30000}:{
 load:(signal:AbortSignal)=>Promise<T>;
 onData:(data:T)=>void;
 onError:(error:unknown)=>void;
 intervalMs?:number;
}) {
 const controller=new AbortController();
 let stopped=false,inFlight=false,pending=false;
 async function refresh() {
  if(stopped||document.hidden)return;
  if(inFlight){pending=true;return;}
  inFlight=true;pending=false;
  try{
   const data=await load(controller.signal);
   if(!stopped)onData(data);
  }catch(error){if(!stopped)onError(error);}
  finally{inFlight=false;if(pending&&!stopped)void refresh();}
 }
 const request=()=>{void refresh();};
 const timer=setInterval(request,intervalMs);
 document.addEventListener('visibilitychange',request);
 window.addEventListener('focus',request);
 window.addEventListener('online',request);
 window.addEventListener(workUpdatedEvent,request);
 request();
 return()=>{
  stopped=true;controller.abort();clearInterval(timer);
  document.removeEventListener('visibilitychange',request);
  window.removeEventListener('focus',request);
  window.removeEventListener('online',request);
  window.removeEventListener(workUpdatedEvent,request);
 };
}
