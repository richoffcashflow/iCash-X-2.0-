import {createHash} from 'node:crypto';
import {buyerReceptionPrompt,buyerReceptionVariables,buyerReceptionGreeting} from './buyer-reception-context.ts';
import {sellerOfferPresentation,sellerQualificationAndOfferInstructions} from './seller-offer-presentation.ts';

export const sellerOfferReceptionPolicy='seller_offer_v2';
// Keep v1 byte-for-byte stable for historical and currently active branches.
export const sellerOfferReceptionPrompt=buyerReceptionPrompt.replace(
 'When status is matched, confirm whether the caller owns the supplied address and ask about a cash sale. No seller offer price is authorized in this inbound session. Never give a buyer price to a seller.',
 'When status is matched, this is a SELLER conversation. Confirm ownership unless already confirmed in the bound conversation. Establish selling interest and continue with the seller sequence below. Only a supplied sellerOffer is an authorized nonbinding cash proposal for this exact property. It is not a buyer asking price or proof of verified title, funds or identity. Never give a buyer price to a seller. If sellerOffer is null, qualify briefly and explain that the numbers need review; do not invent an offer or keep repeating qualification.'
).replace('Only the public buyer opportunity fields in buyer context may be discussed after property confirmation.','Only the public buyer opportunity fields or the matched public seller proposal may be discussed after the corresponding property and role confirmation.')+sellerQualificationAndOfferInstructions+'\nINBOUND CAPABILITIES: You may explain the proposal and record the seller response in this conversation. You cannot send a contract, book a callback or claim a saved agreement in this call. If they accept, confirm the proposed price and say the agreement needs to be prepared for review. Never claim a successful handoff, delivery or signature without a tool result.';
export const sellerOfferReceptionPolicyHash=createHash('sha256').update(JSON.stringify({policy:sellerOfferReceptionPolicy,greeting:buyerReceptionGreeting,prompt:sellerOfferReceptionPrompt})).digest('hex');
export function sellerOfferReceptionEnabled(c:Record<string,unknown>){return c.context_policy===sellerOfferReceptionPolicy&&c.context_policy_hash===sellerOfferReceptionPolicyHash&&typeof c.context_approval_reference==='string'&&c.context_approval_reference.trim().length>=10;}
export function sellerOfferReceptionVariables(value:unknown,now=Date.now()){
 const base=buyerReceptionVariables(value),safe=JSON.parse(base.icash_property_context);
 if(safe?.status!=='matched')return base;
 const source=value as Record<string,unknown>,proposal=source.dealStage==='draft'&&source.agreementPending===false
  ?sellerOfferPresentation(source.screeningSnapshot,safe.address,now):null;
 // Screening and SMS records are server-only. Only these explicitly selected
 // nonbinding proposal fields reach the voice provider, never debt or raw data.
 return {...base,icash_property_context:JSON.stringify({...safe,sellerOffer:proposal})};
}
