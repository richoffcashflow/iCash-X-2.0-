import {z} from 'zod';
type Database=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
const report=z.object({status:z.enum(['disabled','busy','checked']),processed:z.number().int().min(0).max(25),repaired:z.number().int().nonnegative(),errors:z.number().int().min(0).max(25)}).strict();
/** Local queue repairs only. Never retry an uncertain RPC or invoke a provider. */
export async function processDealSupervisor(db:Database,env:NodeJS.ProcessEnv=process.env){
 if(env.VERCEL_ENV!=='production'||env.ICASH_LIVE_WORK_READY!=='true'||env.DOCUSEAL_MODE!=='live')return {status:'held' as const,processed:0,repaired:0,errors:0};
 try{
  const result=report.parse(await db('rpc/icash_run_deal_supervisor','POST',{},AbortSignal.timeout(18000)));
  return result;
 }catch{return {status:'unavailable' as const,processed:0,repaired:0,errors:1};}
}
