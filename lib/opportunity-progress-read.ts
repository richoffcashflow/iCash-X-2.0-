import {db} from '@/lib/stripe-test';
import type {ActivityDays} from './activity-report';
import {validOpportunityProgress} from './opportunity-progress';

export function opportunityPeriod(params:URLSearchParams){
 if([...params.keys()].some(key=>!['days','timezone'].includes(key)||params.getAll(key).length!==1))return null;
 const period=params.get('days')??'1',timezone=params.get('timezone')??'UTC';
 if(!['1','7','30'].includes(period)||timezone.length>100)return null;
 try{new Intl.DateTimeFormat('en-US',{timeZone:timezone});}catch{return null;}
 return {days:Number(period) as ActivityDays,timezone};
}

// Funding controls and activity history have different lifetimes. Only the
// period report supplies counts; a top-up must never reset completed activity.
export async function readOpportunityProgress(accountId:string,days:ActivityDays,timezone:string,signal?:AbortSignal){
 const [budget,report]=await Promise.all([
  db<Record<string,unknown>|null>('rpc/icash_prospecting_progress','POST',{p_account:accountId},signal),
  db<Record<string,unknown>>('rpc/icash_opportunity_progress_report','POST',{p_account:accountId,p_days:days,p_timezone:timezone},signal),
 ]);
 // Validate the report on its own: missing counts must never inherit the
 // legacy funding-scoped zeros from the budget response.
 const progress={...report,status:budget?.status??'waiting'};
 if(!validOpportunityProgress(progress,days,timezone))throw Error('Invalid opportunity progress');
 return {...budget,...progress};
}
