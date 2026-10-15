import type {UsageLoopEvent} from './usage-loop-tracking';
/** Optional telemetry; never retry a write or make a product action await it. */
export async function trackUsageLoopEvent(input:UsageLoopEvent):Promise<void>{
 try{
  await fetch('/api/work/usage-loop-event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),credentials:'same-origin',keepalive:true,signal:AbortSignal.timeout(4000)});
 }catch{/* Missing measurements must not interrupt the workspace. */}
}
