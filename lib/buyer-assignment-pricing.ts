/** Internal only. Buyer-facing output uses the authorized total and deposit. */
export type BuyerAssignmentPricing={ready:boolean;reason?:string;assignmentFeeCents?:number;assignmentDepositCents?:number;askingPriceCents?:number;buyerCeilingCents?:number;targetFeeCents?:number};
export function buyerPricingReviewMessage(pricing:BuyerAssignmentPricing|null){
 if(!pricing||pricing.ready)return null;
 switch(pricing.reason){
  case 'rounded_purchase_required':return 'Buyer pricing needs review: this purchase price cannot produce both a whole $1,000 fee and a whole $1,000 buyer price. Review the agreement before changing signed terms.';
  case 'insufficient_margin':return 'Buyer marketing is held: the current ARV and repairs do not leave room for the $10,000 minimum fee. Review the estimates and purchase terms.';
  case 'fee_exceeds_buyer_budget':return 'Buyer marketing is held: the saved fee puts the buyer price above the deal budget. Review the fee and deal numbers.';
  case 'rounded_fee_required':return 'Buyer marketing is held: use a fee in whole $1,000 increments, at least $10,000, before preparing buyer terms.';
  default:return 'Buyer pricing needs review: confirm the purchase price, ARV and repair estimate before marketing.';
 }
}
