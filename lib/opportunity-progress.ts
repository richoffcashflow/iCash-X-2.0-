import type {ActivityDays} from './activity-report';

export type OpportunityProgressData={
 days:ActivityDays;timezone:string;startAt:string;endAt:string;
 budgetId?:number;startedAt?:string;spentCents?:number;pendingCents?:number;remainingCents?:number;
 queued:number;screened:number;eligible:number;contacted:number;responded:number;
 status:'paused'|'membership_required'|'settling'|'paced'|'budget_reached'|'working'|'ready'|'waiting';
};
const statuses=new Set(['paused','membership_required','settling','paced','budget_reached','working','ready','waiting']);
export function validOpportunityProgress(value:unknown,days:ActivityDays,timezone:string):value is OpportunityProgressData{
 if(!value||typeof value!=='object')return false;
 const p=value as OpportunityProgressData;
 return p.days===days&&p.timezone===timezone&&typeof p.startAt==='string'&&typeof p.endAt==='string'
  &&Number.isFinite(Date.parse(p.startAt))&&Number.isFinite(Date.parse(p.endAt))&&Date.parse(p.startAt)<=Date.parse(p.endAt)
  &&[p.queued,p.screened,p.eligible,p.contacted,p.responded].every(n=>Number.isSafeInteger(n)&&n>=0)
  &&statuses.has(p.status);
}
