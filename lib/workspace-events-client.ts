'use client';
type Listener=()=>void;
const listeners=new Set<Listener>();
let controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>|undefined,attempt=0,revision:string|null=null;
export function notifyWorkspaceChanges(){for(const listener of listeners)listener();}
function stop(){controller?.abort();controller=null;clearTimeout(timer);}
async function connect(){
 if(typeof document==='undefined'||document.hidden||!listeners.size||controller)return;
 const current=new AbortController();controller=current;let timeout:ReturnType<typeof setTimeout>|undefined;
 try{
  timeout=setTimeout(()=>current.abort(),60000);
  const response=await fetch('/api/work/events',{credentials:'same-origin',cache:'no-store',signal:current.signal,redirect:'error'});
  if(!response.ok||!response.body||!response.headers.get('content-type')?.startsWith('text/event-stream'))throw Error('Feed unavailable');
  attempt=0;
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  while(!current.signal.aborted){
   const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
   if(buffer.length>10000)throw Error('Invalid feed');
   let boundary:number;
   while((boundary=buffer.indexOf('\n\n'))>=0){
    const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
    if(!frame.startsWith('event: revision\n'))continue;
    const data=JSON.parse(frame.split('\n').find(line=>line.startsWith('data: '))?.slice(6)??'null');
    if(!data||typeof data.revision!=='string'||!/^\d{1,20}$/.test(data.revision))throw Error('Invalid feed');
    if(revision!==data.revision){revision=data.revision;notifyWorkspaceChanges();}
   }
  }
 }catch{/* Saved work remains visible; subscriber fallback refreshes continue. */}
 finally{
  clearTimeout(timeout);current.abort();if(controller===current)controller=null;
  if(listeners.size&&!document.hidden)timer=setTimeout(()=>void connect(),Math.min(60000,2000*2**Math.min(attempt++,5)));
 }
}
function visibility(){if(document.hidden)stop();else{notifyWorkspaceChanges();void connect();}}
/** One authenticated stream per tab, independent of how many panels subscribe. */
export function subscribeWorkspaceChanges(listener:Listener){
 listeners.add(listener);
 if(listeners.size===1){document.addEventListener('visibilitychange',visibility);void connect();}
 return()=>{listeners.delete(listener);if(!listeners.size){stop();document.removeEventListener('visibilitychange',visibility);revision=null;}};
}
