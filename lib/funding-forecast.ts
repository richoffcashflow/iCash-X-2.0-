/** Capacity ceiling, not a promise of lead quality or conversion. One blended quote must cover the complete cycle. */
export function fundingForecast(budgetCents:number,days:number,cycleChargeCents:number|null,conversion?:{sampleSize:number;qualifiedLow:number;qualifiedHigh:number}){
 if(!Number.isSafeInteger(budgetCents)||budgetCents<2000||!Number.isInteger(days)||days<1||days>7)throw new Error('Invalid funding selection');
 const dailyLimitCents=Math.floor(budgetCents/days);
 if(cycleChargeCents===null||!Number.isSafeInteger(cycleChargeCents)||cycleChargeCents<=0)return {dailyLimitCents,cycles:null,qualified:null};
 const cycles=Math.floor(budgetCents/cycleChargeCents);
 const usable=conversion&&Number.isSafeInteger(conversion.sampleSize)&&conversion.sampleSize>=100&&conversion.qualifiedLow>=0&&conversion.qualifiedHigh<=1&&conversion.qualifiedLow<=conversion.qualifiedHigh;
 return {dailyLimitCents,cycles,qualified:usable?{low:Math.floor(cycles*conversion.qualifiedLow),high:Math.floor(cycles*conversion.qualifiedHigh)}:null};
}
export type PlanningPrices={lookup_cents:number;voice_minute_cents:number;lookup_share_percent:number;call_minutes_low:number;call_minutes_high:number};
export function planningEstimate(budgetCents:number,p:PlanningPrices){
 if(!Number.isSafeInteger(budgetCents)||budgetCents<2000||!Object.values(p).every(Number.isSafeInteger)||p.lookup_cents<=0||p.voice_minute_cents<=0||p.lookup_share_percent<0||p.lookup_share_percent>100||p.call_minutes_low<=0||p.call_minutes_high<p.call_minutes_low)throw new Error('Invalid planning inputs');
 const lookupBudget=Math.floor(budgetCents*p.lookup_share_percent/100),minutes=Math.floor((budgetCents-lookupBudget)/p.voice_minute_cents);
 return {lookups:Math.floor(lookupBudget/p.lookup_cents),minutes,callsLow:Math.floor(minutes/p.call_minutes_high),callsHigh:Math.floor(minutes/p.call_minutes_low)};
}
