import type Stripe from 'stripe';
export const disputeIdPattern=/^dp_[A-Za-z0-9]{1,240}$/;
export const paymentIdPattern=/^pi_[A-Za-z0-9]{1,240}$/;
export const referenceId=(value:string|{id:string}|null|undefined)=>typeof value==='string'?value:value?.id??null;
export const disputeNeedsResponse=(status:string)=>status==='needs_response'||status==='warning_needs_response';
export type DisputeSummary={id:string;customer:string|null;amountCents:number;currency:string;reason:string;status:string;createdAt:string;dueAt:string|null;paymentId:string|null;chargeId:string;hasEvidence:boolean;pastDue:boolean;stripeUrl:string};
export function summarizeDispute(d:Stripe.Dispute):DisputeSummary{
 if(!disputeIdPattern.test(d.id)||!Number.isSafeInteger(d.amount)||d.amount<0||!referenceId(d.charge))throw Error('Invalid dispute');
 return {id:d.id,customer:d.evidence?.customer_email_address??d.evidence?.customer_name??null,amountCents:d.amount,currency:d.currency,reason:d.reason,status:d.status,createdAt:new Date(d.created*1000).toISOString(),dueAt:d.evidence_details.due_by?new Date(d.evidence_details.due_by*1000).toISOString():null,paymentId:referenceId(d.payment_intent),chargeId:referenceId(d.charge)!,hasEvidence:d.evidence_details.has_evidence,pastDue:d.evidence_details.past_due,stripeUrl:`https://dashboard.stripe.com/${d.livemode?'':'test/'}disputes/${d.id}`};
}
export function disputeGuidance(reason:string){
 switch(reason){
 case 'fraudulent':return 'Show authorization, authentication results and account activity. A refund policy alone does not prove the cardholder authorized payment. Check Stripe for CE 3.0 eligibility.';
 case 'subscription_canceled':return 'Compare the payment date with the cancellation request and confirmed cancellation. Include the accepted renewal terms and relevant communications.';
 case 'product_not_received':return 'Show when access or credits were delivered and which services actually completed. Payment and final-sale terms alone do not prove delivery.';
 case 'product_unacceptable':return 'Compare the offer accepted at checkout with the service delivered. Include the specific complaint and relevant support response.';
 case 'duplicate':return 'Compare both payment references and demonstrate distinct authorized purchases. Do not contest an actual duplicate charge.';
 case 'credit_not_processed':return 'Include the refund decision and any refund payment reference. Verify whether a credit was promised.';
 default:return 'Address the specific claim with the relevant payment, accepted terms, delivery records and customer communication.';
 }
}
export type EvidenceSection={title:string;lines:string[]};
export type EvidencePacket={dispute:DisputeSummary;generatedAt:string;customer:string;guidance:string;gaps:string[];sections:EvidenceSection[]};
export function disputeMoney(cents:number,currency='usd'){return new Intl.NumberFormat('en-US',{style:'currency',currency:currency.toUpperCase()}).format(cents/100);}
export function disputeTime(value:string|null){return value?new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short',hour12:true}).format(new Date(value))+' CT':'Not provided';}
