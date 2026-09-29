/** No signature, acceptance, title clearance or delivery can be inferred from dialogue. */
export function contractReadiness(i:{agreedPriceCents:number|null;approvedCeilingCents:number;allDecisionMakersPresent:boolean;allOwnersConfirmed:boolean;legalDescription:string|null;legalDescriptionReviewed:boolean;sellerSignaturesVerified:boolean;customerSignatureVerified:boolean;autoSignAuthorization:{active:boolean;expiresAt:number;maxPriceCents:number;documentHash:string}|null;documentHash:string;now:number}){
 if(!i.allDecisionMakersPresent||!i.allOwnersConfirmed)return 'wait_for_decision_makers';
 if(!Number.isSafeInteger(i.agreedPriceCents)||i.agreedPriceCents!<=0||!Number.isSafeInteger(i.approvedCeilingCents)||i.approvedCeilingCents<=0||i.agreedPriceCents!>i.approvedCeilingCents)return 'review_price';
 if(!i.legalDescription?.trim()||!i.legalDescriptionReviewed)return 'review_legal_description';
 if(!i.sellerSignaturesVerified)return 'seller_signs_first';
 if(i.customerSignatureVerified)return 'fully_signed';
 const a=i.autoSignAuthorization;
 return a?.active&&Number.isFinite(i.now)&&Number.isFinite(a.expiresAt)&&a.expiresAt>i.now&&Number.isSafeInteger(a.maxPriceCents)&&a.maxPriceCents>=i.agreedPriceCents!&&i.documentHash.length>=32&&a.documentHash===i.documentHash?'authorized_customer_signature_pending':'request_customer_signature';
}
/** Proposed timeline only. Compute from an agreed effective date, never from first contact. */
export function proposedClosingDate(effectiveDate:string,days=30){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)||!Number.isInteger(days)||days<1||days>365)throw new Error('Invalid closing timeline');
 const d=new Date(effectiveDate+'T12:00:00Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==effectiveDate)throw new Error('Invalid effective date');
 d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
