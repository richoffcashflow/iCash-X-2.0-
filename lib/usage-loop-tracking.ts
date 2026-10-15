import {createHash} from 'node:crypto';
import {z} from 'zod';
export const usageLoopAction=z.enum(['funding','resume','vip','work','none']);
export const usageLoopReason=z.enum(['start','refill','resume','progress','review','waiting','vip']);
export const usageLoopEventSchema=z.object({impressionId:z.string().uuid(),event:z.enum(['shown','clicked','dismissed']),action:usageLoopAction,reason:usageLoopReason}).strict();
export type UsageLoopEvent=z.infer<typeof usageLoopEventSchema>;
export type UsageLoopObservation={impressionId:string;variant:'control'|'progress'};
type Database=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
/** Assignment is stable across sessions and is never accepted from a client. */
export function usageLoopVariant(accountId:string):'control'|'progress'{
 return parseInt(createHash('md5').update(accountId.toLowerCase()).digest('hex')[0],16)%2===0?'control':'progress';
}
/** Failure to measure cannot suppress a real next step or block funding. */
export async function createUsageLoopObservation(accountId:string,card:{action:z.infer<typeof usageLoopAction>;reason:z.infer<typeof usageLoopReason>},database?:Database):Promise<UsageLoopObservation|null>{
 try{
  const db=database??(await import('./stripe-test')).db;
  const observation=await db<unknown>('rpc/icash_create_usage_loop_observation','POST',{p_account:accountId,p_action:card.action,p_reason:card.reason},AbortSignal.timeout(2000));
  const parsed=z.object({impressionId:z.string().uuid(),variant:z.enum(['control','progress'])}).strict().safeParse(observation);
  return parsed.success&&parsed.data.variant===usageLoopVariant(accountId)?parsed.data:null;
 }catch{return null;}
}
export async function pruneUsageLoopObservations(database:Database):Promise<void>{
 try{await database('rpc/icash_prune_usage_loop_observations','POST',{},AbortSignal.timeout(2000));}catch{/* Optional telemetry never changes maintenance health. */}
}
const count=z.number().int().nonnegative();
export const usageLoopReportSchema=z.object({
 checkedAt:z.string(),cohortStart:z.string(),cohortEnd:z.string(),observationDays:z.literal(7),retentionDays:z.literal(30),includeOwner:z.boolean(),
 cohort:z.object({firstFunded:count,firstResult:count,secondManualRefill:count,repeatUsage:count}),
 recent:z.object({shownAccounts:count,clickedAccounts:count,dismissedAccounts:count}),
 variants:z.array(z.object({variant:z.enum(['control','progress']),observedAccounts:count,clickedAccounts:count,fundedAccounts:count})).length(2),
});
export type UsageLoopReport=z.infer<typeof usageLoopReportSchema>;
