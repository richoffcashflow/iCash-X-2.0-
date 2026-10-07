export type RefillHistory = {price_cents:number;credited_at:string|null;auto_recharge?:boolean|null};
export type RefillUsage = {delta_cents:number;created_at:string};
const minimum=1000,maximum=100000;
const validCents=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=minimum&&n<=maximum;
/** A suggestion, never a charge or a promise to complete a task. */
export function creditRefillRecommendation(balanceCents:number,history:RefillHistory[],usage:RefillUsage[],now=Date.now()){
 const available=Number.isSafeInteger(balanceCents)&&balanceCents>=0?balanceCents:0;
 const recent=history.filter(p=>p.auto_recharge!==true&&validCents(p.price_cents)&&p.credited_at&&Date.parse(p.credited_at)<=now&&Date.parse(p.credited_at)>now-30*86400000)
  .sort((a,b)=>Date.parse(b.credited_at!)-Date.parse(a.credited_at!)).slice(0,5).map(p=>p.price_cents).sort((a,b)=>a-b);
 // Use a typical amount the customer actually chose; one unusual deposit cannot dominate.
 const usualCents=recent.length?recent[Math.floor((recent.length-1)/2)]:minimum;
 const settled=usage.length<=1000?usage.filter(u=>Number.isSafeInteger(u.delta_cents)&&u.delta_cents<0&&Date.parse(u.created_at)<=now&&Date.parse(u.created_at)>now-7*86400000):[];
 const total=settled.reduce((sum,u)=>sum-u.delta_cents,0);
 const days=settled.length?Math.min(7,Math.max(1,Math.ceil((now-Math.min(...settled.map(u=>Date.parse(u.created_at))))/86400000))):1;
 const dailyCents=Number.isSafeInteger(total)?Math.ceil(total/days):0;
 const gap=Math.max(0,dailyCents-available);
 // Preserve their usual custom amount. Only round a larger usage-based suggestion to $5.
 const amountCents=Math.min(maximum,Math.max(usualCents,Math.ceil(gap/500)*500));
 return {amountCents,usualCents,lowBalanceCents:Math.max(500,Math.ceil(usualCents*.2)),basis:gap>usualCents?'recent_usage' as const:recent.length?'usual_refill' as const:'starter' as const};
}
export function fundingReasonAtAmount(reason:string,amountCents:number|null){
 return reason.replace(/Add \$[\d,]+(?:\.\d{2})? in credits/,amountCents===null?'Choose an amount in credits':`Add ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:amountCents%100?2:0}).format(amountCents/100)} in credits`);
}
