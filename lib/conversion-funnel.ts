export type FunnelStep={key:string;count:number};
export type FunnelStage={key:string;label:string};
export const sellerFunnelStages:FunnelStage[]=[{key:'inbound',label:'Inbound leads'},{key:'assigned',label:'Assigned'},{key:'engaged',label:'Seller engaged'},{key:'contract',label:'Under contract'},{key:'buyer',label:'Buyer signed'},{key:'closed',label:'Deals closed'}];
export const webinarFunnelStages:FunnelStage[]=[{key:'viewers',label:'Started watching'},{key:'offer',label:'Reached offer'},{key:'selected',label:'Selected offer'},{key:'checkout',label:'Checkout started'},{key:'purchased',label:'Purchased'}];
export type WebinarFunnels={summary:FunnelStep[];webinars:{webinarId:string;steps:FunnelStep[]}[]};
export function validFunnelSteps(value:unknown,stages:FunnelStage[]):value is FunnelStep[]{
 if(!Array.isArray(value)||value.length!==stages.length)return false;
 return value.every((step,i)=>step!==null&&typeof step==='object'&&step.key===stages[i].key&&Number.isSafeInteger(step.count)&&step.count>=0&&(i===0||step.count<=value[i-1].count));
}
export function validWebinarFunnels(value:unknown):value is WebinarFunnels{
 if(!value||typeof value!=='object')return false;
 const v=value as WebinarFunnels;
 return validFunnelSteps(v.summary,webinarFunnelStages)&&Array.isArray(v.webinars)&&new Set(v.webinars.map(w=>w?.webinarId)).size===v.webinars.length&&v.webinars.every(w=>w&&typeof w.webinarId==='string'&&validFunnelSteps(w.steps,webinarFunnelStages)&&w.steps.every((s,i)=>s.count<=v.summary[i].count));
}
export function funnelPercent(n:number,total:number){return total>0?Math.round(n/total*1000)/10:null;}
export function funnelRows(steps:FunnelStep[],stages:FunnelStage[]){
 if(!validFunnelSteps(steps,stages))throw Error('Invalid funnel counts');
 return stages.map((stage,i)=>({...stage,count:steps[i].count,share:funnelPercent(steps[i].count,steps[0].count),drop:i===0?null:steps[i-1].count-steps[i].count,dropPercent:i===0?null:funnelPercent(steps[i-1].count-steps[i].count,steps[i-1].count)}));
}
