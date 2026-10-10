export type OverviewFilters={days:1|7|30;includeOwner:boolean;query:string;page:number};
export type OverviewLead={id:string;name:string;address:string;phone:string;email:string|null;state:string;source:string;campaign:string|null;assignedTo:string|null;createdAt:string};
export type OwnerOverview=OverviewFilters & {
 pageSize:25;timezone:'America/Chicago';startAt:string;endAt:string;
 leadCount:number;reviewCount:number;matchedCount:number;leads:OverviewLead[];
 usage:{completedCount:number;missingChargeCount:number;chargedCents:number|null;coveredCents:number;knownCostMicros:number;costMicros:number|null;marginMicros:number|null;missingCostCount:number;estimatedCount:number;pendingCount:number};
};
const record=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validOwnerOverview(value:unknown,filters:OverviewFilters):value is OwnerOverview{
 const v=record(value),u=record(v.usage);
 if(v.days!==filters.days||v.includeOwner!==filters.includeOwner||v.query!==filters.query||v.page!==filters.page||v.pageSize!==25||v.timezone!=='America/Chicago'||!date(v.startAt)||!date(v.endAt)||Date.parse(v.endAt)<Date.parse(v.startAt))return false;
 if(!['leadCount','reviewCount','matchedCount'].every(k=>count(v[k]))||!['completedCount','missingChargeCount','coveredCents','knownCostMicros','missingCostCount','estimatedCount','pendingCount'].every(k=>count(u[k])))return false;
 if(!['chargedCents','costMicros'].every(k=>u[k]===null||count(u[k]))||!(u.marginMicros===null||typeof u.marginMicros==='number'&&Number.isSafeInteger(u.marginMicros)))return false;
 if((u.missingChargeCount===0)!==(u.chargedCents!==null)||(u.missingCostCount===0)!==(u.costMicros!==null))return false;
 if(['missingChargeCount','missingCostCount','estimatedCount'].some(k=>(u[k] as number)>(u.completedCount as number))||u.costMicros!==null&&u.costMicros!==u.knownCostMicros)return false;
 if(u.chargedCents!==null&&u.costMicros!==null){if(u.marginMicros!==(u.chargedCents as number)*10000-(u.costMicros as number))return false;}else if(u.marginMicros!==null)return false;
 if(!Array.isArray(v.leads)||v.leads.length!==Math.min(25,Math.max(0,(v.matchedCount as number)-(filters.page-1)*25))||(v.matchedCount as number)>(v.leadCount as number)||(v.reviewCount as number)>(v.leadCount as number))return false;
 return v.leads.every(lead=>{const l=record(lead);return ['id','name','address','phone','state','source'].every(k=>typeof l[k]==='string')&&['email','campaign','assignedTo'].every(k=>l[k]===null||typeof l[k]==='string')&&date(l.createdAt);});
}
export function overviewMoney(amount:number|null,unit:'cents'|'micros'='micros'){
 return amount===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(amount/(unit==='cents'?100:1000000));
}
export function overviewTime(value:string){return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value));}
export function overviewLeadStatus(state:string){
 const labels:Record<string,string>={received:'New',looking_up:'Checking property',checking:'Checking property',qualified:'Awaiting match',assigned:'Assigned',review:'Needs review',numbers_review:'Needs review',market_review:'Needs review',unmatched:'Check address',suppressed:'Contact stopped',rejected:'Not qualified'};
 return labels[state]??'Needs review';
}
