import {z} from 'zod';
const count=z.number().int().min(0).max(2000);
const age=z.number().finite().nonnegative().nullable();
const stamp=z.string().refine(value=>Number.isFinite(Date.parse(value)));
const latency=z.object({samples:count,p50:age,p90:age,max:age}).strict();
const schema=z.object({
 version:z.literal('seller-conversion-v1'),days:z.union([z.literal(1),z.literal(7),z.literal(30)]),
 startAt:stamp,endAt:stamp,sampleLimit:z.literal(2000),scope:z.literal('recent_source_samples'),complete:z.boolean(),
 truncated:z.object({replies:z.boolean(),calls:z.boolean(),offerEvents:z.boolean(),callbacks:z.boolean()}).strict(),
 replies:z.object({observed:count,actionable:count,restrictedOrAutomated:count,currentlyAccepted:count,delivered:count,sourceTimeUnknown:count,acceptedDispatchLatencyUnknown:count,
  dispatchLatencySeconds:latency,currentWithoutBoundAutomaticReply:count,laterCustomerReplies:count,currentUnsubmitted:count,currentMissingAiJob:count,customerControlled:count,dueProgressChecks:count,oldestDueSeconds:age,
  reasons:z.array(z.object({reason:z.string().min(1).max(100),count:count}).strict()).max(12)}).strict(),
 calls:z.object({attempted:count,completed:count,humanResponses:count,carrierUnanswered:count.optional(),humanResponseUnknown:count}).strict(),
 offers:z.object({observedDeals:count,quoteRecorded:count,acceptanceRecorded:count,currentQuoteSmsDelivered:count,verifiedPurchaseSigned:count,
  quotedWithoutAcceptance:count,acceptedWithoutVerifiedPurchaseOnDeal:count,voiceQuoteDeliveryUnknown:count,currentOfferAuthority:z.null()}).strict(),
 callbacks:z.object({observed:count,scheduledReviewsDue:count,oldestDueSeconds:age,heldForHuman:count}).strict(),
}).strict();
/** Independent bounded source samples, not a cohort conversion rate or authority. */
export function validSellerConversionReport(value:unknown,days:1|7|30):boolean{
 const parsed=schema.safeParse(value);if(!parsed.success)return false;
 const v=parsed.data,r=v.replies,l=r.dispatchLatencySeconds,o=v.offers,c=v.calls,b=v.callbacks;
 if(v.days!==days||Math.abs(Date.parse(v.endAt)-Date.parse(v.startAt)-days*86400000)>1000
  ||v.complete===Object.values(v.truncated).some(Boolean))return false;
 if(r.actionable+r.restrictedOrAutomated!==r.observed||r.currentlyAccepted>r.observed||r.delivered>r.currentlyAccepted||r.sourceTimeUnknown>r.observed
  ||l.samples+r.acceptedDispatchLatencyUnknown!==r.currentlyAccepted||r.currentWithoutBoundAutomaticReply>r.actionable||r.currentUnsubmitted>r.currentWithoutBoundAutomaticReply
  ||r.currentMissingAiJob>r.currentWithoutBoundAutomaticReply||r.laterCustomerReplies>r.currentWithoutBoundAutomaticReply||r.customerControlled>r.currentWithoutBoundAutomaticReply||r.dueProgressChecks>r.currentWithoutBoundAutomaticReply
  ||r.reasons.reduce((sum,x)=>sum+x.count,0)>r.currentWithoutBoundAutomaticReply||new Set(r.reasons.map(x=>x.reason)).size!==r.reasons.length)return false;
 if(l.samples===0?(l.p50!==null||l.p90!==null||l.max!==null):(l.p50===null||l.p90===null||l.max===null||l.p50>l.p90||l.p90>l.max))return false;
 if((r.dueProgressChecks===0)!==(r.oldestDueSeconds===null)||(b.scheduledReviewsDue===0)!==(b.oldestDueSeconds===null))return false;
 return c.completed<=c.attempted&&c.humanResponses<=c.completed&&c.humanResponseUnknown===c.attempted-c.completed-(c.carrierUnanswered??0)
  &&o.quoteRecorded<=o.observedDeals&&o.acceptanceRecorded<=o.quoteRecorded&&o.currentQuoteSmsDelivered<=o.quoteRecorded
  &&o.verifiedPurchaseSigned<=o.observedDeals&&o.quotedWithoutAcceptance===o.quoteRecorded-o.acceptanceRecorded
  &&o.acceptedWithoutVerifiedPurchaseOnDeal<=o.acceptanceRecorded&&o.voiceQuoteDeliveryUnknown<=o.quoteRecorded
  &&b.scheduledReviewsDue+b.heldForHuman<=b.observed;
}
