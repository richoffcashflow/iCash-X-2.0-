/** Authenticated routes provide a single server-owned account, never client IDs. */
export function workspaceEventStream({accountId,read,signal,intervalMs=5000,lifetimeMs=45000}:{accountId:string;read:()=>Promise<unknown>;signal:AbortSignal;intervalMs?:number;lifetimeMs?:number}){
 let timer:ReturnType<typeof setTimeout>|undefined,ended=false,cleanup=()=>{};
 const encoder=new TextEncoder(),started=Date.now();let revision:string|null=null;
 return new ReadableStream<Uint8Array>({
  start(controller){
   const close=()=>{if(ended)return;ended=true;clearTimeout(timer);signal.removeEventListener('abort',close);controller.close();};
   cleanup=()=>{ended=true;clearTimeout(timer);signal.removeEventListener('abort',close);};
   signal.addEventListener('abort',close,{once:true});
   async function poll(){
    if(ended)return;if(signal.aborted||Date.now()-started>=lifetimeMs){close();return;}
    try{
     const versions=await read();if(ended)return;
     if(!versions||typeof versions!=='object'||Array.isArray(versions)||Object.keys(versions).some(id=>id!==accountId))throw Error('Invalid revision scope');
     const next=(versions as Record<string,unknown>)[accountId]??'0';
     if(typeof next!=='string'||!/^\d{1,20}$/.test(next))throw Error('Invalid revision');
     if(revision!==next){revision=next;controller.enqueue(encoder.encode(`event: revision\ndata: ${JSON.stringify({revision})}\n\n`));}
     else controller.enqueue(encoder.encode(': heartbeat\n\n'));
     timer=setTimeout(()=>void poll(),intervalMs);
    }catch{close();}
   }
   void poll();
  },
  cancel(){cleanup();},
 });
}
