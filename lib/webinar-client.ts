/** Bounded browser requests. Never automatically repeat a write or payment. */
export async function webinarRequest<T>(path:string,init:RequestInit={},timeoutMs=25000):Promise<T>{
 const controller=new AbortController();
 const abort=()=>controller.abort();
 if(init.signal?.aborted)controller.abort();
 else init.signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeoutMs);
 try{
  const response=await fetch(path,{...init,signal:controller.signal});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data||typeof data!=='object')throw Object.assign(Error(typeof data?.error==='string'?data.error:'Could not connect. Please try again.'),{status:response.status});
  return data as T;
 }catch(error){
  if(controller.signal.aborted)throw Error('The connection took too long. Please try again.');
  throw error instanceof Error?error:Error('Could not connect. Please try again.');
 }finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
}
export function webinarPost<T>(path:string,body:unknown,timeoutMs=25000){
 return webinarRequest<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},timeoutMs);
}
export function webinarBeacon(path:string,body:unknown){
 const payload=JSON.stringify(body);
 try{if(navigator.sendBeacon?.(path,new Blob([payload],{type:'application/json'})))return;}catch{/* Some webviews block beacons. */}
 void webinarRequest(path,{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true},8000).catch(()=>{});
}
