export type SupportTransport = (path:string,init?:RequestInit)=>Promise<Response>;
export const supportTransport:SupportTransport=(path,init)=>fetch(path,init);

/** Bound the whole response, including body reads. Writes are never auto-retried. */
export async function supportRequest<T>(path:string,init:RequestInit={},transport:SupportTransport=supportTransport,timeoutMs=45000):Promise<{ok:boolean;status:number;data:T}>{
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(Error(init.method==='POST'?'The connection took too long. Your request may have been saved. Refresh status before retrying.':'The connection took too long. Please refresh the conversation.'));},timeoutMs);
 });
 try{
  return await Promise.race([(async()=>{
   const response=await transport(path,{...init,signal:controller.signal});
   const data=await response.json().catch(()=>null);
   if(!data||typeof data!=='object')throw Error('Could not read the support response. Refresh status before retrying.');
   return {ok:response.ok,status:response.status,data:data as T};
  })(),deadline]);
 }catch(error){throw error instanceof Error?error:Error('Could not connect to support. Your unsent message is still here.');}
 finally{clearTimeout(timer);}
}

/** A brief reading/typing pace, never another long wait after a slow request. */
export function supportReplyWaitMs(reply:string,elapsedMs:number){
 const target=Math.min(3600,1800+reply.length*8);
 return Math.max(0,target-Math.max(0,elapsedMs));
}
