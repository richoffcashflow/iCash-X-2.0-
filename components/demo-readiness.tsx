import type {DemoReadiness} from '@/lib/demo-readiness';

/** Read-only preparation stays behind the action, without a diagnostic panel. */
export async function checkDemoReadiness(signal:AbortSignal):Promise<boolean>{
 try{
  const r=await fetch('/api/demo/readiness',{method:'GET',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(35000)])});
  if(!r.ok||signal.aborted)return false;
  const d=await r.json() as DemoReadiness;
  return !signal.aborted&&d.mode==='read_only'&&Array.isArray(d.checks)&&d.checks.length===5&&typeof d.checkedAt==='string'&&d.setupChecksPass===true&&d.checks.every(c=>c.status==='passed');
 }catch{return false;}
}
