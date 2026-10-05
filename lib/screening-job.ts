import {propertyContext} from './property-context.ts';
import {sellerCallFinancialGate} from './equity-screen.ts';
import {cashOfferPolicy} from './cash-offer-math.ts';
/** Pure processing of a server-owned licensed snapshot; never fetches data or authorizes outreach. */
export function runScreeningJob(snapshot: unknown, now=Date.now()) {
 const s=snapshot as {propertyId?:string;fetchedAt?:string;propertyType?:string;raw?:unknown;assignmentFeeCents?:number;sellerCostReserveCents?:number};
 if(!s||typeof s.propertyId!=='string'||typeof s.fetchedAt!=='string'||!Number.isFinite(now))throw new Error('INVALID_SNAPSHOT');
 const fetched=Date.parse(s.fetchedAt);
 if(!Number.isFinite(fetched)||fetched>now||now-fetched>86400000)throw new Error('INVALID_SNAPSHOT');
 const reserve=s.sellerCostReserveCents;
 if(reserve!==undefined&&(!Number.isSafeInteger(reserve)||reserve<0))throw new Error('INVALID_SNAPSHOT');
 const property=propertyContext(s.raw,s.propertyId,s.fetchedAt);
 // Historical snapshot assignmentFeeCents is retained as evidence only. New
 // preliminary offers all use the same current deal-size fee policy.
 const sellerOfferCents=s.propertyType==='house'?property.offerCalculation?.sellerCeilingCents??null:null;
 const financialCheck=s.propertyType!=='house'
  ?{status:'hold' as const,checkedAt:now,reason:'Separate land underwriting required.'}
  :sellerCallFinancialGate(property.financialScreening,{sellerOfferCents,sellerCostReserveCents:reserve??null,checkedAt:now});
 return {property,financialCheck,preliminarySellerCeilingCents:sellerOfferCents,calculationVersion:cashOfferPolicy.version,calculatedAt:new Date(now).toISOString(),
  nextAction:financialCheck.status==='eligible'?'permission_and_cost_check':'review',
  offerAuthorized:false,outreachAuthorized:false};
}

/** Recalculate arithmetic from an old snapshot without making its research fresh. */
export function recalculateSavedScreening(snapshot:unknown,previous:unknown,now=Date.now()){
 const s=snapshot as {propertyId?:string;fetchedAt?:string},old=previous as {property?:{propertyId?:string};calculationVersion?:string;preliminarySellerCeilingCents?:number;calculationHistory?:unknown[]};
 const fetched=Date.parse(s?.fetchedAt??'');
 if(!old?.property||old.property.propertyId!==s?.propertyId||!Number.isFinite(fetched)||fetched>now)throw Error('INVALID_SNAPSHOT');
 const fresh=runScreeningJob(snapshot,fetched);
 return {...fresh,calculatedAt:new Date(now).toISOString(),calculationHistory:[...(Array.isArray(old.calculationHistory)?old.calculationHistory.slice(-9):[]),{version:old.calculationVersion??'legacy_range_v0',sellerCeilingCents:old.preliminarySellerCeilingCents??null,replacedAt:new Date(now).toISOString()}],
  financialCheck:{status:'hold' as const,checkedAt:fetched,reason:'Saved numbers recalculated. Current property research is required before automated contact.'},nextAction:'review',offerAuthorized:false as const,outreachAuthorized:false as const};
}
