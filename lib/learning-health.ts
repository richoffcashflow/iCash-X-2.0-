import {z} from 'zod';
const count=z.number().int().nonnegative();
const timestamp=z.string().datetime({offset:true}).nullable();
const component=z.object({lastAttemptAt:timestamp,lastSuccessAt:timestamp,lastErrorAt:timestamp,lastErrorCode:z.string().regex(/^[0-9A-Z]{5}$/).nullable()});
export const learningHealthSchema=z.object({
 checkedAt:z.string().datetime({offset:true}),status:z.enum(['ok','degraded']),fresh:z.boolean(),warningCount:count,
 queue:z.object({accounts:count,due:count,failed:count,stale:count,neverRefreshed:count,oldestDueAt:timestamp,oldestSuccessAt:timestamp}),
 refresh:component,conversion:component.extend({updatedAt:timestamp}),
});
export const improvementReviewSchema=z.object({lastReviewedAt:timestamp,proposals:z.array(z.object({
 id:z.string().regex(/^\d+$/),category:z.string().max(100),version:count.positive(),
 status:z.enum(['observed','candidate','offline_validated','limited_experiment','promoted','rolled_back']),observations:count,
 firstObservedAt:z.string().datetime({offset:true}),lastObservedAt:z.string().datetime({offset:true}),
 evidence:z.record(z.string(),z.unknown()),
})).max(30)});
export type LearningHealth=z.infer<typeof learningHealthSchema>;
