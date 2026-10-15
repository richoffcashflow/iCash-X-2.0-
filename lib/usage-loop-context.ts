import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {contactWorkEnabled,smsWorkEnabled} from './live-work-admission';

const positive=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const usageLoopContextSchema=z.object({
 checkedAt:z.string().datetime({offset:true}),
 progress:z.object({kind:z.enum(['seller_reply','buyer_reply','contract_signed','research_complete','closed']),count:positive,lastAt:z.string().datetime({offset:true})}).strict().nullable(),
 work:z.object({kind:z.enum(['seller_followup','buyer_outreach','research']),count:positive,estimateCents:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()}).strict().nullable(),
 hasHistory:z.boolean(),needsReview:z.boolean(),ready:z.boolean(),hasDeal:z.boolean(),
}).strict();
export type UsageLoopContext=z.infer<typeof usageLoopContextSchema>;
/** Only reads persisted evidence. Configuration checks never contact providers. */
export async function loadUsageLoopContext(accountId:string,userId:string):Promise<UsageLoopContext>{
 const value=usageLoopContextSchema.parse(await db<unknown>('rpc/icash_usage_loop_context','POST',{p_account:accountId,p_user:userId}));
 const now=Date.now(),checked=Date.parse(value.checkedAt);
 if(checked>now+5000||checked<now-90000||(value.progress&&Date.parse(value.progress.lastAt)>now+5000))throw Error('Usage context is stale');
 const configured=value.work?.kind==='research'
  ?contactWorkEnabled()&&/^dm_sk_live_[A-Za-z0-9_-]+$/.test(process.env.DEALMACHINE_API_KEY??'')
  :smsWorkEnabled()&&!!process.env.CONTIGUITY_API_KEY&&!!process.env.CONTIGUITY_WEBHOOK_SECRET&&/^\+1[2-9]\d{9}$/.test(process.env.CONTIGUITY_FROM??'');
 return {...value,ready:value.ready&&configured,work:configured?value.work:null};
}
