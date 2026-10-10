import {finalSalePolicy} from './final-sale-policy.ts';
const priceLabel=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents%100?2:0}).format(cents/100);
export const autoRechargeVersion='recharge-2026-10-10.1';
export const autoRechargeThresholdCents=500;
export function autoRechargeSummary(cents:number){return `Automatically add ${priceLabel(cents)} when credits fall below $5, up to once every 24 hours. Turn off anytime.`;}
export function autoRechargeTerms(cents:number){return `I authorize iCash X to save my card and charge ${priceLabel(cents)} for ${priceLabel(cents)} of work credits when available credits fall below $5, at most once every 24 hours, until I turn off auto recharge in Add money. No automatic charge while my bot is paused or my subscription is inactive. A payment already processing may finish. The monthly software subscription is separate. ${finalSalePolicy}`;}
