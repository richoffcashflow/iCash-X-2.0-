import {finalSalePolicy} from './final-sale-policy.ts';
export const vipTermsVersion='vip-2026-10-10.2';
export const standardMonthlyCents=5000;
export const vipMonthlyCents=10000;
export const vipUpgradeCents=5000;
export function vipActive(m:{state:string;paid_through:string|null;vip_until?:string|null}|null,now=Date.now()){
 return !!m&&m.state==='active'&&Date.parse(m.paid_through??'')>now&&Date.parse(m.vip_until??'')>now;
}
export function vipPrice(standardCents:number,_kind:'lead'|'usage'){
 if(!Number.isSafeInteger(standardCents)||standardCents<0)throw Error('Invalid price');
 return Math.ceil(standardCents*80/100);
}
export const vipBenefits=['Ask AI Bot — answers about your leads, offers and next steps','Platform Buyer Network — match deals with opted-in buyers across iCash X','20% off AI work','20% off leads','Priority for eligible new leads','Your own AI voice'];

export const vipPurchaseTerms='$50 once today for VIP in the current billing period. VIP renews at $100/month total on the existing renewal date, before any existing subscription discount. Work credits are separate. Cancel from the account menu. '+finalSalePolicy;
export const vipCheckoutSummary=vipPurchaseTerms.replace(' Work credits are separate.','');
export const vipRetentionVersion='vip-retention-50-ongoing-v1';
export const vipRetentionCents=5000;
export const vipRetentionTerms='VIP starts now with no additional charge today. I authorize $50/month total on my existing renewal date while this subscription remains active. This replaces any existing subscription discount. Work credits are separate. I can cancel from the account menu at any time. '+finalSalePolicy;
