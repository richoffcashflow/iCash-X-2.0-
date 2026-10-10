import {z} from 'zod';
import {validWebinarFunnels,type WebinarFunnels} from './conversion-funnel.ts';
export const reportQuery=z.object({period:z.enum(['today','yesterday','7d','30d']).default('today'),timezone:z.string().min(1).max(80).default('America/Chicago').refine(zone=>{try{new Intl.DateTimeFormat('en-US',{timeZone:zone});return true;}catch{return false;}},'Choose a valid reporting timezone.')}).strict();
export type ReportPeriod=z.infer<typeof reportQuery>['period'];
export type FunnelMetrics={viewers:number;addToCart:number;checkouts:number;purchases:number;buyers:number;cohortBuyers:number;revenueCents:number;leads:number;offerViews:number;startedSessions:number;averageWatchSeconds:number;averageWatchPercent:number;completions:number};
export type WebinarReport={period:ReportPeriod;timezone:string;startDate:string;endDate:string;startsAt:string;endsAt:string;generatedAt:string;summary:FunnelMetrics;webinars:(FunnelMetrics&{webinarId:string})[];recordings:(FunnelMetrics&{webinarId:string;version:'day'|'night'})[];days:(FunnelMetrics&{date:string})[];conversionFunnel?:WebinarFunnels};
export const periodLabels:Record<ReportPeriod,string>={today:'Today',yesterday:'Yesterday','7d':'Last 7 days','30d':'Last 30 days'};
export const emptyFunnel:FunnelMetrics={viewers:0,addToCart:0,checkouts:0,purchases:0,buyers:0,cohortBuyers:0,revenueCents:0,leads:0,offerViews:0,startedSessions:0,averageWatchSeconds:0,averageWatchPercent:0,completions:0};
export function dailyCloseRate(metrics:FunnelMetrics){return metrics.viewers?`${(metrics.cohortBuyers/metrics.viewers*100).toFixed(1)}%`:'—';}
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const date=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function validMetrics(value:unknown):boolean{
 const v=record(value);
 return Object.keys(emptyFunnel).every(key=>typeof v[key]==='number'&&Number.isFinite(v[key])&&(v[key] as number)>=0&&(key.startsWith('average')||Number.isSafeInteger(v[key])))&&(v.cohortBuyers as number)<=(v.viewers as number);
}
export function validWebinarReport(value:unknown,period:ReportPeriod,timezone:string):value is WebinarReport{
 const v=record(value);
 if(v.period!==period||v.timezone!==timezone||![v.startDate,v.endDate,v.startsAt,v.endsAt,v.generatedAt].every(date)||Date.parse(v.endsAt as string)<=Date.parse(v.startsAt as string)||!validMetrics(v.summary))return false;
 if(!Array.isArray(v.webinars)||!v.webinars.every(row=>typeof record(row).webinarId==='string'&&validMetrics(row)))return false;
 if(!Array.isArray(v.recordings)||!v.recordings.every(row=>typeof record(row).webinarId==='string'&&['day','night'].includes(record(row).version as string)&&validMetrics(row)))return false;
 if(!Array.isArray(v.days)||!v.days.every(row=>date(record(row).date)&&validMetrics(row)))return false;
 return v.conversionFunnel===undefined||validWebinarFunnels(v.conversionFunnel)&&v.conversionFunnel.summary[0].count===record(v.summary).viewers;
}
