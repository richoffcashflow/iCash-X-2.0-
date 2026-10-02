import {propertyContext} from './property-context.ts';
import {sellerCallFinancialGate} from './equity-screen.ts';
/** Pure processing of a server-owned licensed snapshot; never fetches data or authorizes outreach. */
export function runScreeningJob(snapshot: unknown, now=Date.now()) {
 const s=snapshot as {propertyId?:string;fetchedAt?:string;propertyType?:string;raw?:unknown;assignmentFeeCents?:number;sellerCostReserveCents?:number};
 if(!s||typeof s.propertyId!=='string'||typeof s.fetchedAt!=='string'||!Number.isFinite(now))throw new Error('INVALID_SNAPSHOT');
 const fetched=Date.parse(s.fetchedAt);
 if(!Number.isFinite(fetched)||fetched>now||now-fetched>86400000)throw new Error('INVALID_SNAPSHOT');
 const fee=s.assignmentFeeCents??1000000, reserve=s.sellerCostReserveCents;
 if(!Number.isSafeInteger(fee)||fee<0||(reserve!==undefined&&(!Number.isSafeInteger(reserve)||reserve<0)))throw new Error('INVALID_SNAPSHOT');
 const property=propertyContext(s.raw,s.propertyId,s.fetchedAt);
 const ceiling=property.screeningBuyerCeilingCents;
 const sellerOfferCents=ceiling!==null&&ceiling>fee?ceiling-fee:null;
 const financialCheck=s.propertyType!=='house'
  ?{status:'hold' as const,checkedAt:now,reason:'Separate land underwriting required.'}
  :sellerCallFinancialGate(property.financialScreening,{sellerOfferCents,sellerCostReserveCents:reserve??null,checkedAt:now});
 return {property,financialCheck,preliminarySellerCeilingCents:sellerOfferCents,calculationVersion:'provider_repair_scalar_v1' as const,
  nextAction:financialCheck.status==='eligible'?'permission_and_cost_check':'review',
  offerAuthorized:false,outreachAuthorized:false};
}
