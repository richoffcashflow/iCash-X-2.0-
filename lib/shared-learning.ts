import {z} from 'zod';

const count=z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const sharedLearningStatSchema=z.object({
 variant:z.string().min(1).max(100),contributors:count.int(),attempts:count.int(),pending:count.int(),positive:count.int(),opted_out:count.int(),
 contract_trials:count.int(),contracts:count.int(),closing_trials:count.int(),closings:count.int(),cost_cents:count.int(),costs_complete:z.boolean(),updated_at:z.string(),
 effective_attempts:count,effective_pending:count,effective_positive:count,effective_opted_out:count,
 effective_contract_trials:count,effective_contracts:count,effective_closing_trials:count,effective_closings:count,effective_cost_cents:count,
}).refine(s=>s.pending<=s.attempts&&s.positive<=s.attempts&&s.opted_out<=s.attempts&&s.contracts<=s.contract_trials&&s.closings<=s.closing_trials
 &&s.effective_pending<=s.effective_attempts&&s.effective_positive<=s.effective_attempts&&s.effective_contracts<=s.effective_contract_trials&&s.effective_closings<=s.effective_closing_trials);
export type SharedLearningStat=z.infer<typeof sharedLearningStatSchema>;
export function sharedLearningStats(raw:unknown):SharedLearningStat[]{
 const parsed=z.array(sharedLearningStatSchema).max(100).safeParse(raw);
 return parsed.success&&new Set(parsed.data.map(s=>s.variant)).size===parsed.data.length?parsed.data:[];
}
export function learningLower(wins:number,trials:number){
 if(trials<=0||wins<0||wins>trials)return 0;
 const p=wins/trials,z=1.645,z2=z*z;
 return Math.max(0,(p+z2/(2*trials)-z*Math.sqrt(p*(1-p)/trials+z2/(4*trials*trials)))/(1+z2/trials));
}
export function learningObjective(stats:SharedLearningStat[]){
 if(stats.length&&stats.every(s=>s.effective_closing_trials>=100&&s.effective_closings>=5))return 'closings';
 if(stats.length&&stats.every(s=>s.effective_contract_trials>=100&&s.effective_contracts>=5))return 'contracts';
 return 'positive';
}
export function learningScore(s:SharedLearningStat,objective:ReturnType<typeof learningObjective>){
 const trials=objective==='closings'?s.effective_closing_trials:objective==='contracts'?s.effective_contract_trials:s.effective_attempts-s.effective_pending;
 return learningLower(s[`effective_${objective}`],trials);
}
export function sharedEvidenceReady(s:SharedLearningStat){return s.contributors>=3&&s.effective_attempts-s.effective_pending>=100&&s.effective_opted_out/Math.max(1,s.effective_attempts)<=0.05;}
/** Shared observations guide only reviewed alternatives. They grant no authority. */
export function sharedLearningWinner(raw:unknown,choices:readonly string[],requireContracts=false){
 const stats=sharedLearningStats(raw).filter(s=>choices.includes(s.variant));
 if(choices.length<2||stats.length!==choices.length||!stats.every(sharedEvidenceReady))return null;
 const objective=learningObjective(stats);if(requireContracts&&objective==='positive')return null;
 const ranked=[...stats].sort((a,b)=>learningScore(b,objective)-learningScore(a,objective)||a.variant.localeCompare(b.variant));
 return learningScore(ranked[0],objective)>0?{variant:ranked[0].variant,objective}:null;
}
export const sellerInterestVariants=['ownership_as_is_v2','ownership_cash_v2','ownership_timing_v2'] as const;
/** Mirrors the SQL seller text allocator; pending observations never inflate yield. */
export function sellerInterestWinner(raw:unknown,choices:readonly string[]=sellerInterestVariants){
 const stats=sharedLearningStats(raw).filter(s=>choices.includes(s.variant));
 if(choices.length<2||stats.length!==choices.length||!stats.every(s=>sharedEvidenceReady(s)&&s.costs_complete&&s.effective_cost_cents>0))return null;
 const objective=learningObjective(stats);
 const score=(s:SharedLearningStat)=>{
  const trials=objective==='closings'?s.effective_closing_trials:objective==='contracts'?s.effective_contract_trials:s.effective_attempts;
  return Math.max(0,learningLower(s[`effective_${objective}`],trials)*trials-0.5*s.effective_opted_out)/(s.effective_cost_cents+1000);
 };
 const ranked=[...stats].sort((a,b)=>score(b)-score(a)||a.variant.localeCompare(b.variant));
 return score(ranked[0])>0?{variant:ranked[0].variant,objective}:null;
}
export const platformLearningReportSchema=z.object({
 version:z.literal('shared-v1'),checkedAt:z.string(),minimumAccounts:z.literal(3),contributionCap:z.literal(200),maxLearnedShare:z.literal(0.6),
 dueAccounts:count.int(),failedAccounts:count.int(),lastRefresh:z.string().nullable(),cohortsTruncated:z.boolean(),recoveryEnabled:count.int(),filterEnabled:z.boolean(),
 cohorts:z.array(z.object({domain:z.string(),context:z.string(),market:z.string(),stats:z.array(sharedLearningStatSchema)})).max(200),
});
export type PlatformLearningReport=z.infer<typeof platformLearningReportSchema>;
export type SharedAssignment={variant:string;version:'shared-v1';mode:'explore'|'shared'};
export async function assignSharedLearning(database:<T>(path:string,method?:string,body?:unknown)=>Promise<T>,input:{account:string;domain:'seller_calls'|'buyer_search';subject:string;context:string;market:string}):Promise<SharedAssignment|null>{
 const raw=await database('rpc/icash_assign_shared_learning','POST',{p_account:input.account,p_domain:input.domain,p_subject:input.subject,p_context:input.context,p_market:input.market});
 if(raw===null)return null;
 const result=z.object({variant:z.enum(input.domain==='seller_calls'?['cash_interest','flexible_timing']:['recent_corporate','corporate_owners']),version:z.literal('shared-v1'),mode:z.enum(['explore','shared'])}).strict().parse(raw);
 return result;
}
