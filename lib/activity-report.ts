export const activityPeriods=[{days:1,label:'Today'},{days:7,label:'7 days'},{days:30,label:'30 days'}] as const;
export type ActivityDays=typeof activityPeriods[number]['days'];
export type ActivityReport={days:ActivityDays;timezone:string;startAt:string;endAt:string;leads:number;calls:number;texts:number;contracts:number};
export function validActivityReport(value:unknown,days:ActivityDays):value is ActivityReport{
 if(!value||typeof value!=='object')return false;
 const r=value as ActivityReport;
 return r.days===days&&typeof r.timezone==='string'&&Number.isFinite(Date.parse(r.startAt))&&Number.isFinite(Date.parse(r.endAt))&&Date.parse(r.startAt)<=Date.parse(r.endAt)&&[r.leads,r.calls,r.texts,r.contracts].every(n=>Number.isSafeInteger(n)&&n>=0);
}
