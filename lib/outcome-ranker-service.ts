import {z} from 'zod';
import {trainOutcomeRanker} from './outcome-ranker.ts';
import type {BillingDb} from './outbound-billing-service.ts';

const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const samplingSchema=z.object({version:z.literal('age-fair-v2'),sequence:count.positive(),eligible:count,selected:count.max(5000),newlyCovered:count,remainingUnseen:count})
 .refine(s=>s.selected<=s.eligible&&s.newlyCovered<=s.selected&&s.remainingUnseen+s.newlyCovered<=s.eligible);
const claimSchema=z.object({token:z.uuid(),asOf:z.iso.datetime({offset:true}),samples:z.array(z.unknown()).max(5000),sampling:samplingSchema.optional()})
 .refine(c=>!c.sampling||c.sampling.selected===c.samples.length);
/** Separate bounded 15-minute job: no provider calls, outreach, funding or LLM. */
export async function runOutcomeRanker(database:BillingDb,signal=AbortSignal.timeout(45000)){
 signal.throwIfAborted();
 const raw=await database<unknown>('rpc/icash_claim_ranker_training','POST',{},signal);
 if(raw===null)return {status:'idle'};
 const claim=claimSchema.parse(raw),started=performance.now();
 const result=trainOutcomeRanker(claim.samples,claim.asOf);
 if(claim.sampling){
  const s=claim.sampling;
  Object.assign(result.metrics,{samplingVersion:s.version,samplingSequence:s.sequence,samplingEligible:s.eligible,
   samplingSelected:s.selected,samplingNewlyCovered:s.newlyCovered,samplingRemainingUnseen:s.remainingUnseen});
 }
 signal.throwIfAborted();
 const elapsedMs=Math.round(performance.now()-started);
 const saved=await database('rpc/icash_finish_ranker_training','POST',{p_token:claim.token,p_result:result,p_elapsed_ms:elapsedMs},signal);
 if(saved!==true)throw Error('Ranker training receipt not confirmed');
 return {status:result.status,reason:result.reason,metrics:result.metrics,elapsedMs};
}
