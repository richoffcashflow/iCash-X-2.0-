import {z} from 'zod';
export const reliabilityAlertConfigurations=['disabled','unconfigured','ready','recipient_unverified'] as const;
export const reliabilityAlertReasons=['worker','maintenance','monitor','workflows'] as const;
export const reliabilityAlertStatusSchema=z.object({
 configuration:z.enum(reliabilityAlertConfigurations),checkedAt:z.string().datetime({offset:true}).nullable(),
 active:z.object({id:z.string().uuid(),openedAt:z.string().datetime({offset:true}),issueCount:z.number().int().nonnegative(),reasons:z.array(z.enum(reliabilityAlertReasons)).max(4)}).strict().nullable(),
 notifications:z.object({pending:z.number().int().nonnegative(),accepted:z.number().int().nonnegative(),needsReview:z.number().int().nonnegative()}).strict(),
 lastNotificationAt:z.string().datetime({offset:true}).nullable(),
}).strict();
export type ReliabilityAlertStatus=z.infer<typeof reliabilityAlertStatusSchema>;
export const reliabilityAlertClaimSchema=z.object({id:z.string().uuid(),incidentId:z.string().uuid(),event:z.enum(['detected','recovered']),openedAt:z.string().datetime({offset:true}),reasons:z.array(z.enum(reliabilityAlertReasons)).max(4),issueCount:z.number().int().nonnegative()}).strict();
