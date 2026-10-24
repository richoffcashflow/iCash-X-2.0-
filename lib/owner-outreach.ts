import {z} from 'zod';

export const outreachStatuses=['all','responded','interested','queued','held'] as const;
export type OutreachStatus=typeof outreachStatuses[number];
export type OutreachFilters={days:1|7|30;includeOwner:boolean;query:string;page:number;status:OutreachStatus};
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const stamp=z.string().refine(value=>Number.isFinite(Date.parse(value)));
const activity={calls:count,conversations:count,callResponses:count,unanswered:count,busy:count,failed:count,textsAccepted:count,textsDelivered:count,textReplies:count,queuedCalls:count,queuedTexts:count,heldCalls:count,heldTexts:count};
const leadSchema=z.object({id:z.guid(),accountId:z.guid(),account:z.string().min(1),address:z.string().min(1),paused:z.boolean(),eligible:z.boolean(),responded:z.boolean(),interested:z.boolean(),optedOut:z.boolean(),latestAt:stamp,...activity});
const reportSchema=z.object({days:z.union([z.literal(1),z.literal(7),z.literal(30)]),includeOwner:z.boolean(),query:z.string().max(100),page:z.number().int().min(1).max(100000),status:z.enum(outreachStatuses),pageSize:z.literal(25),timezone:z.literal('America/Chicago'),startAt:stamp,endAt:stamp,matchedCount:count,totals:z.object({researched:count,eligible:count,accounts:count,respondedProperties:count,interestedProperties:count,...activity}),leads:z.array(leadSchema).max(25)});
export type OwnerOutreach=z.infer<typeof reportSchema>;
export type OutreachLead=OwnerOutreach['leads'][number];
export function validOwnerOutreach(value:unknown,filters:OutreachFilters):value is OwnerOutreach{
 const parsed=reportSchema.safeParse(value);if(!parsed.success)return false;
 const r=parsed.data,t=r.totals;
 if(r.days!==filters.days||r.includeOwner!==filters.includeOwner||r.query!==filters.query||r.page!==filters.page||r.status!==filters.status||Date.parse(r.startAt)>Date.parse(r.endAt))return false;
 if(r.leads.length!==Math.max(0,Math.min(25,r.matchedCount-(r.page-1)*25))||new Set(r.leads.map(l=>l.id)).size!==r.leads.length)return false;
 if(t.eligible>t.researched||t.callResponses>t.conversations||t.interestedProperties>t.respondedProperties||t.unanswered+t.busy+t.failed>t.calls)return false;
 return r.leads.every(l=>l.callResponses<=l.conversations&&l.unanswered+l.busy+l.failed<=l.calls&&(!l.interested||(l.responded&&!l.optedOut))&&Date.parse(l.latestAt)<=Date.parse(r.endAt));
}
export function outreachLeadStatus(lead:OutreachLead){
 if(lead.optedOut)return 'Contact stopped';
 if(lead.interested)return 'Interested seller';
 if(lead.responded)return 'Seller responded';
 if(lead.paused)return 'Account paused';
 if(lead.queuedCalls+lead.queuedTexts>0)return 'Outreach queued';
 if(lead.heldCalls+lead.heldTexts>0)return 'On hold';
 if(lead.calls+lead.textsAccepted+lead.textsDelivered>0)return 'Awaiting response';
 return lead.eligible?'Eligible property':'Research / review';
}
