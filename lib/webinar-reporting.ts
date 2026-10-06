import {z} from 'zod';
export const reportQuery=z.object({period:z.enum(['today','yesterday','7d','30d']).default('today'),timezone:z.string().min(1).max(80).default('America/Chicago').refine(zone=>{try{new Intl.DateTimeFormat('en-US',{timeZone:zone});return true;}catch{return false;}},'Choose a valid reporting timezone.')}).strict();
export type ReportPeriod=z.infer<typeof reportQuery>['period'];
export type FunnelMetrics={viewers:number;addToCart:number;checkouts:number;purchases:number;buyers:number;cohortBuyers:number;revenueCents:number;leads:number;offerViews:number;startedSessions:number;averageWatchSeconds:number;averageWatchPercent:number;completions:number};
export type WebinarReport={period:ReportPeriod;timezone:string;startDate:string;endDate:string;startsAt:string;endsAt:string;generatedAt:string;summary:FunnelMetrics;webinars:(FunnelMetrics&{webinarId:string})[];recordings:(FunnelMetrics&{webinarId:string;version:'day'|'night'})[];days:(FunnelMetrics&{date:string})[]};
export const periodLabels:Record<ReportPeriod,string>={today:'Today',yesterday:'Yesterday','7d':'Last 7 days','30d':'Last 30 days'};
export const emptyFunnel:FunnelMetrics={viewers:0,addToCart:0,checkouts:0,purchases:0,buyers:0,cohortBuyers:0,revenueCents:0,leads:0,offerViews:0,startedSessions:0,averageWatchSeconds:0,averageWatchPercent:0,completions:0};
export function dailyCloseRate(metrics:FunnelMetrics){return metrics.viewers?`${(metrics.cohortBuyers/metrics.viewers*100).toFixed(1)}%`:'—';}
