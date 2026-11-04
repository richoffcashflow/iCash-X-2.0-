import {z} from 'zod';
import {learningHealthSchema,improvementReviewSchema} from './learning-health.ts';

const count=z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const sharedLearningStatSchema=z.object({
 variant:z.string().min(1).max(100),contributors:count.int(),attempts:count.int(),pending:count.int(),positive:count.int(),opted_out:count.int(),
 contract_trials:count.int(),contracts:count.int(),closing_trials:count.int(),closings:count.int(),cost_cents:count.int(),costs_complete:z.boolean(),updated_at:z.string(),
 effective_attempts:count,effective_pending:count,effective_positive:count,effective_opted_out:count,
 effective_contract_trials:count,effective_contracts:count,effective_closing_trials:count,effective_closings:count,effective_cost_cents:count,
}).refine(s=>s.pending<=s.attempts&&s.positive<=s.attempts-s.pending&&s.opted_out<=s.attempts&&s.contracts<=s.contract_trials&&s.closings<=s.closing_trials
 &&s.effective_pending<=s.effective_attempts&&s.effective_positive<=s.effective_attempts-s.effective_pending&&s.effective_opted_out<=s.effective_attempts&&s.effective_contracts<=s.effective_contract_trials&&s.effective_closings<=s.effective_closing_trials);
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
export function learningTrials(s:SharedLearningStat,objective:ReturnType<typeof learningObjective>){
 return objective==='closings'?s.effective_closing_trials:objective==='contracts'?s.effective_contract_trials:s.effective_attempts-s.effective_pending;
}
export function learningScore(s:SharedLearningStat,objective:ReturnType<typeof learningObjective>){
 return learningLower(s[`effective_${objective}`],learningTrials(s,objective));
}
export function sharedEvidenceReady(s:SharedLearningStat){return s.contributors>=3&&s.effective_attempts-s.effective_pending>=100&&s.effective_opted_out/Math.max(1,s.effective_attempts)<=0.05;}
/** Shared observations guide only reviewed alternatives. They grant no authority. */
export function learningBounds(wins:number,trials:number){
 if(!Number.isFinite(wins)||!Number.isFinite(trials)||trials<=0||wins<0||wins>trials)return {lower:0,upper:1};
 const p=wins/trials,z=1.96,z2=z*z,center=p+z2/(2*trials),spread=z*Math.sqrt(p*(1-p)/trials+z2/(4*trials*trials)),scale=1+z2/trials;
 return {lower:Math.max(0,(center-spread)/scale),upper:Math.min(1,(center+spread)/scale)};
}
export type LearningDecision={policyVersion:'evidence-v2';status:'explore'|'shared'|'safety_hold';winner:string|null;objective:'positive'|'contracts'|'closings';reason:string;allowedChoices:string[]};
/** Only immutable, reviewed alternatives compete. Bounds describe observational
 * uncertainty, not causal lift. Complete contact costs are not total profit. */
export function sharedLearningDecision(raw:unknown,choices:readonly string[],requireContracts=false):LearningDecision{
 const decision:LearningDecision={policyVersion:'evidence-v2',status:'explore',winner:null,objective:'positive',reason:'insufficient_evidence',allowedChoices:[...choices]};
 if(choices.length<1||choices.length>20||new Set(choices).size!==choices.length||choices.some(c=>!c||c.length>100))return {...decision,reason:'invalid_choices',allowedChoices:[]};
 const all=sharedLearningStats(raw),stats=all.filter(s=>choices.includes(s.variant));
 if(!all.length)return decision;
 const unsafe=new Set(stats.filter(s=>s.effective_attempts>=20&&s.effective_opted_out>=3&&s.effective_opted_out/s.effective_attempts>0.05).map(s=>s.variant));
 decision.allowedChoices=choices.filter(c=>!unsafe.has(c));
 if(unsafe.size)return {...decision,status:'safety_hold',reason:'opt_out_guard'};
 if(choices.length<2)return decision;
 if(stats.length!==choices.length||!stats.every(sharedEvidenceReady))return decision;
 if(stats.every(s=>s.effective_closing_trials>=100))decision.objective='closings';
 else if(stats.every(s=>s.effective_contract_trials>=100))decision.objective='contracts';
 if(requireContracts&&decision.objective==='positive')return {...decision,reason:'verified_contracts_required'};
 if(!stats.every(s=>s.costs_complete&&s.effective_cost_cents>0))return {...decision,reason:'cost_evidence_incomplete'};
 const rows=stats.map(s=>{
  const trials=learningTrials(s,decision.objective),wins=s[`effective_${decision.objective}`],bounds=learningBounds(wins,trials);
  return {variant:s.variant,wins,lower:Math.max(0,bounds.lower*trials-0.5*s.effective_opted_out)/s.effective_cost_cents,upper:bounds.upper*trials/s.effective_cost_cents};
 }).sort((a,b)=>b.lower-a.lower||a.variant.localeCompare(b.variant));
 const winner=rows[0];
 if(winner.wins<(decision.objective==='positive'?10:5))return {...decision,reason:'insufficient_positive_outcomes'};
 if(winner.lower<=0||rows.slice(1).some(s=>winner.lower<=s.upper*1.05))return {...decision,reason:'comparison_inconclusive'};
 return {...decision,status:'shared',winner:winner.variant,reason:'verified_cost_comparison'};
}
export function sharedLearningWinner(raw:unknown,choices:readonly string[],requireContracts=false){
 const result=sharedLearningDecision(raw,choices,requireContracts);
 return result.status==='shared'&&result.winner?{variant:result.winner,objective:result.objective}:null;
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
 health:learningHealthSchema.optional(),improvementReview:improvementReviewSchema.optional(),conversionUpdatedAt:z.string().nullable().optional(),
 cohorts:z.array(z.object({domain:z.string(),context:z.string(),market:z.string(),stats:z.array(sharedLearningStatSchema)})).max(200),
 ranker:z.object({enabled:z.boolean(),status:z.enum(['disabled','collecting','rejected','qualified','expired']),lastTrainedAt:z.string().nullable(),elapsedMs:count.nullable(),reason:z.string().nullable(),
  samples:count.int(),matureInterest:count.int(),observedInterest:count.int(),observedContracts:count.int(),observedClosings:count.int(),
 }).optional(),
});
export type PlatformLearningReport=z.infer<typeof platformLearningReportSchema>;
export class SharedLearningSafetyHold extends Error{constructor(){super('LEARNING_SAFETY_HOLD');}}
export type SharedAssignment={variant:string;version:'shared-v1';mode:'explore'|'shared'};
export async function assignSharedLearning(database:<T>(path:string,method?:string,body?:unknown)=>Promise<T>,input:{account:string;domain:'seller_calls'|'buyer_search';subject:string;context:string;market:string}):Promise<SharedAssignment|null>{
 const raw=await database('rpc/icash_assign_shared_learning','POST',{p_account:input.account,p_domain:input.domain,p_subject:input.subject,p_context:input.context,p_market:input.market});
 if(raw===null)return null;
 if(z.object({held:z.literal(true),reason:z.literal('learning_safety_hold')}).strict().safeParse(raw).success)throw new SharedLearningSafetyHold();
 const result=z.object({variant:z.enum(input.domain==='seller_calls'?['cash_interest','flexible_timing']:['recent_corporate','corporate_owners']),version:z.literal('shared-v1'),mode:z.enum(['explore','shared'])}).strict().parse(raw);
 return result;
}
