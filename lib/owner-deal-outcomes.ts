import {z} from 'zod';

const count=z.number().int().nonnegative().safe();
const cohort=z.object({
 key:z.enum(['customers','owner']),signingStarted:count,awaitingSeller:count,awaitingCustomer:count,needsReview:count,
 verifiedPurchases:count,verifiedAssignments:count,verifiedClosings:count,receivedDeals:count,receivedCents:count,
}).strict().refine(c=>c.awaitingSeller+c.awaitingCustomer+c.needsReview+c.verifiedPurchases<=c.signingStarted
 &&c.verifiedAssignments<=c.verifiedPurchases&&c.verifiedClosings<=c.verifiedAssignments&&c.receivedDeals<=c.verifiedClosings
 &&(c.receivedDeals===0)===(c.receivedCents===0));
export const ownerDealOutcomesSchema=z.object({
 days:z.union([z.literal(1),z.literal(7),z.literal(30)]),startAt:z.iso.datetime({offset:true}),endAt:z.iso.datetime({offset:true}),
 maxDeals:z.literal(10000),truncated:z.boolean(),cohorts:z.tuple([cohort,cohort]),
}).strict().refine(r=>r.cohorts[0].key==='customers'&&r.cohorts[1].key==='owner'
 &&Date.parse(r.startAt)<=Date.parse(r.endAt)&&r.cohorts.reduce((n,c)=>n+c.signingStarted,0)<=r.maxDeals);
export type OwnerDealOutcomes=z.infer<typeof ownerDealOutcomesSchema>;
