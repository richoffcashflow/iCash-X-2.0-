import {z} from 'zod';
import {trainOutcomeRanker} from './outcome-ranker.ts';
import type {BillingDb} from './outbound-billing-service.ts';

const claimSchema=z.object({token:z.uuid(),asOf:z.iso.datetime({offset:true}),samples:z.array(z.unknown()).max(5000)});
/** Separate hourly job: no provider calls, outreach dispatch, funding, or LLM. */
export async function runOutcomeRanker(database:BillingDb,signal=AbortSignal.timeout(45000)){
 signal.throwIfAborted();
 const raw=await database<unknown>('rpc/icash_claim_ranker_training','POST',{},signal);
 if(raw===null)return {status:'idle'};
 const claim=claimSchema.parse(raw),started=performance.now();
 const result=trainOutcomeRanker(claim.samples,claim.asOf);
 signal.throwIfAborted();
 const elapsedMs=Math.round(performance.now()-started);
 const saved=await database('rpc/icash_finish_ranker_training','POST',{p_token:claim.token,p_result:result,p_elapsed_ms:elapsedMs},signal);
 if(saved!==true)throw Error('Ranker training receipt not confirmed');
 return {status:result.status,reason:result.reason,metrics:result.metrics,elapsedMs};
}
