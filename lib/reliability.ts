import {z} from 'zod';
const component=z.object({status:z.enum(['ok','degraded','unavailable','standby']),checkedAt:z.string().datetime({offset:true}).nullable()});
const count=z.number().int().nonnegative();
export const reliabilitySchema=z.object({status:z.enum(['ok','degraded']),fresh:z.boolean(),components:z.object({worker:component,maintenance:component}),snapshot:z.object({
 checkedAt:z.string().datetime({offset:true}),issueCount:count,
 issues:z.array(z.object({kind:z.enum(['text_receipt','text_review','contract_delivery','contract_preparation','screening_lease','call_receipt','seller_response','buyer_fulfillment']),resourceId:z.guid(),accountId:z.guid(),since:z.string().datetime({offset:true})})).max(25),
 texts:z.object({accepted:count,delivered:count,review:count}),contracts:z.object({created:count,completed:count,review:count}),
}).nullable()});
export type ReliabilityReport=z.infer<typeof reliabilitySchema>;
export const reliabilityIssueLabels={text_receipt:'Text receipt not saved',text_review:'Text needs delivery review',contract_delivery:'Contract text awaiting delivery',contract_preparation:'Contract preparation needs review',screening_lease:'Property research stopped',call_receipt:'Call receipt not saved',seller_response:'Seller outreach has not started',buyer_fulfillment:'Buyer preparation is overdue'};
