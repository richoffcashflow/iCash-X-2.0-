import {z} from 'zod';
const count=z.number().int().nonnegative();
const date=z.string().datetime({offset:true});
export const textIngressHealthSchema=z.object({monitoredSince:date,windowStartedAt:date,failedRequests24h:count,lastFailureAt:date.nullable(),failures:z.array(z.object({kind:z.enum(['authenticated_rejected','unregistered_destination','processing_failed']),stage:z.enum(['parse_incoming','parse_other','sender_registration','lifecycle_routing','delivery_receipt','property_ingestion','reply_preparation']),requests:count,lastAt:date})).max(10)});
export const textHealthSchema=z.object({checkedAt:date,startAt:date,todayAt:date,timezone:z.literal('America/Chicago'),providerComplaintReports:z.null(),ingress:textIngressHealthSchema.optional(),lines:z.array(z.object({
 phone:z.string().regex(/^\+[1-9][0-9]{7,14}$/),enabled:z.boolean(),propertyAcceptedToday:count,propertyAccepted24h:count,propertyRecipients24h:count,
 propertyDelivered24h:count,propertyReview24h:count,blockedNotices24h:count,replyRecipients24h:count,optOutRecipients24h:count,refusalRecipients24h:count,
 complaintWordingRecipients24h:count,interestedRecipients24h:count,customerUpdatesToday:count,lastIncomingAt:date.nullable(),incomingStatus:z.enum(['paused','blocking_reported','observed','unverified']),
 propertyReplyRecipients24h:count.optional(),otherIncoming24h:count.optional(),lastPropertyIncomingAt:date.nullable().optional(),propertyIncomingStatus:z.enum(['paused','blocking_reported','observed','unverified']).optional()
})).max(50)});
export type TextHealth=z.infer<typeof textHealthSchema>;
export const incomingStatusLabels={paused:'Outreach paused',blocking_reported:'Carrier blocking notice received',observed:'Incoming message observed',unverified:'Incoming delivery unverified'};
export const propertyIncomingStatusLabels={paused:'Outreach paused',blocking_reported:'Carrier blocking notice received',observed:'Routed property reply observed',unverified:'Property reply routing unverified'};
export const textIngressStageLabels={parse_incoming:'Incoming message format rejected',parse_other:'Other or unknown event format rejected',sender_registration:'Sender registration',lifecycle_routing:'Conversation routing',delivery_receipt:'Delivery receipt',property_ingestion:'Property message ingestion',reply_preparation:'Reply preparation'};
