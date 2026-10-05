import {cashOfferCalculation} from './cash-offer-math.ts';
/** House underwriting only; this calculation never authorizes sending an offer. */
export type OfferEstimate = { lowCents: number; highCents: number; reviewed: boolean; source: string };
export function calculateHouseOffer(input: {
 propertyType: 'house' | 'land'; arv: OfferEstimate | null; repairs: OfferEstimate | null;
 assignmentFeeCents?: number; ruleBasisPoints?: number;
}) {
 const money = (n:number) => Number.isSafeInteger(n) && n >= 0;
 const rule = input.ruleBasisPoints ?? 7000;
 if (input.assignmentFeeCents!==undefined&&!money(input.assignmentFeeCents) || !Number.isInteger(rule) || rule <= 0 || rule > 7000) throw new Error('Invalid offer policy');
 if (input.propertyType !== 'house') return {status:'needs_review' as const, reason:'Land requires separate underwriting', maxSellerOfferCents:null};
 for (const estimate of [input.arv,input.repairs]) {
  if (!estimate || !money(estimate.lowCents) || !money(estimate.highCents) || estimate.lowCents > estimate.highCents || !estimate.reviewed || !estimate.source.trim()) {
   return {status:'needs_review' as const,reason:'Reviewed ARV and repair evidence required',maxSellerOfferCents:null};
  }
 }
 // Low ARV and high repair estimate avoid optimistic range selection. Integer arithmetic prevents rounding up.
 const calculation=cashOfferCalculation(input.arv!.lowCents,input.repairs!.highCents,{assignmentFeeCents:input.assignmentFeeCents,ruleBasisPoints:rule})!;
 if (calculation.sellerCeilingCents===null) return {status:'no_viable_offer' as const,reason:'Repairs and fee exceed the offer ceiling',maxSellerOfferCents:null};
 return {status:'calculated' as const,maxSellerOfferCents:calculation.sellerCeilingCents,buyerCeilingCents:calculation.buyerCeilingCents,ruleBasisPoints:rule,assignmentFeeCents:calculation.assignmentFeeCents,calculation};
}
