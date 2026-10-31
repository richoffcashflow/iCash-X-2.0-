import {z} from 'zod';
const component=z.object({status:z.enum(['ok','degraded','unavailable','standby']),checkedAt:z.string().datetime({offset:true}).nullable()});
const count=z.number().int().nonnegative();
const issue=z.object({kind:z.enum(['text_receipt','text_review','contract_delivery','contract_preparation','screening_lease','call_receipt','seller_response','buyer_fulfillment','owner_export']),resourceId:z.guid(),accountId:z.guid(),since:z.string().datetime({offset:true})});
export const reliabilitySchema=z.object({status:z.enum(['ok','degraded']),fresh:z.boolean(),components:z.object({worker:component,maintenance:component}),snapshot:z.object({
 checkedAt:z.string().datetime({offset:true}),issueCount:count,
 issues:z.array(issue).max(25),
 acknowledgedCount:count.optional(),
 acknowledgedIssues:z.array(issue.extend({disposition:z.enum(['provider_failure_confirmed','terminal_call_receipt_pending','provider_outcome_unknown','outreach_blocked']),acknowledgedAt:z.string().datetime({offset:true})})).max(25).optional(),
 texts:z.object({accepted:count,delivered:count,review:count}),contracts:z.object({created:count,completed:count,review:count}),
}).nullable()});
export type ReliabilityReport=z.infer<typeof reliabilitySchema>;
export const reliabilityIssueLabels={text_receipt:'Text receipt not saved',text_review:'Text needs delivery review',contract_delivery:'Contract text awaiting delivery',contract_preparation:'Contract preparation needs review',screening_lease:'Property research stopped',call_receipt:'Call receipt not saved',seller_response:'Seller outreach has not started',buyer_fulfillment:'Buyer preparation is overdue',owner_export:'Owner-contact export needs review'};
export const reliabilityAcknowledgementLabels={provider_failure_confirmed:'Provider confirmed failure',terminal_call_receipt_pending:'Call ended; final receipts pending',provider_outcome_unknown:'Provider outcome still unknown',outreach_blocked:'Outreach still blocked'};
