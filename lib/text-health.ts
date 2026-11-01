import {z} from 'zod';
const count=z.number().int().nonnegative();
const date=z.string().datetime({offset:true});
export const textHealthSchema=z.object({checkedAt:date,startAt:date,todayAt:date,timezone:z.literal('America/Chicago'),providerComplaintReports:z.null(),lines:z.array(z.object({
 phone:z.string().regex(/^\+[1-9][0-9]{7,14}$/),enabled:z.boolean(),propertyAcceptedToday:count,propertyAccepted24h:count,propertyRecipients24h:count,
 propertyDelivered24h:count,propertyReview24h:count,blockedNotices24h:count,replyRecipients24h:count,optOutRecipients24h:count,refusalRecipients24h:count,
 complaintWordingRecipients24h:count,interestedRecipients24h:count,customerUpdatesToday:count,lastIncomingAt:date.nullable(),incomingStatus:z.enum(['paused','blocking_reported','observed','unverified'])
})).max(50)});
export type TextHealth=z.infer<typeof textHealthSchema>;
export const incomingStatusLabels={paused:'Outreach paused',blocking_reported:'Carrier blocking notice received',observed:'Incoming message observed',unverified:'Incoming delivery unverified'};
