import {voiceResult,type VoiceConversation} from './voice-result.ts';
import {conversationTrustInstructions} from './conversation-trust.ts';

/** Stable variants are assigned before contact; never rotate an opener mid-conversation. */
export const acquisitionOpeners={
 cash_interest:'Would you consider selling the property for a cash offer?',
 flexible_timing:'Would you be open to a cash offer if the price and timing worked for you?',
} as const;
export function openerForAssignment(bucket:number){
 if(!Number.isInteger(bucket)||bucket<0||bucket>9999)throw new Error('Invalid assignment');
 return bucket<5000?'cash_interest':'flexible_timing';
}
export type DealAuthority={expiresAt:number;maxOfferCents:number;ownershipVerified:boolean;allOwnersOnBoard:boolean;termsReviewed:boolean;deliveryEnabled:boolean};
/** Deterministic authority gate; conversation text cannot raise the price ceiling. */
export function dealNextStep(i:{humanRequested:boolean;optedOut:boolean;interested:boolean;qualified:boolean;agreedPriceCents:number|null;signedEvidence:boolean;authority:DealAuthority|null;now:number}){
 if(i.optedOut)return 'stop_contact';
 if(i.humanRequested)return 'human_handoff';
 if(i.signedEvidence)return 'match_buyers';
 if(!i.interested)return 'ask_cash_interest';
 if(!i.qualified)return 'qualify_condition_timing_owners';
 const a=i.authority;
 if(!a||!Number.isFinite(i.now)||!Number.isFinite(a.expiresAt)||a.expiresAt<=i.now||!Number.isSafeInteger(a.maxOfferCents)||a.maxOfferCents<=0)return 'review_offer_authority';
 if(i.agreedPriceCents===null)return 'negotiate_within_ceiling';
 if(!Number.isSafeInteger(i.agreedPriceCents)||i.agreedPriceCents<=0||i.agreedPriceCents>a.maxOfferCents)return 'review_counteroffer';
 if(!a.ownershipVerified||!a.allOwnersOnBoard)return 'confirm_all_owners';
 if(!a.termsReviewed)return 'review_contract_terms';
 return a.deliveryEnabled?'send_for_signatures':'prepare_contract_draft';
}
/** Provider pull only, with an already persisted live conversation/agent binding. */
export function liveConversationResult(c:VoiceConversation,expected:{conversationId:string;agentId:string;party:'seller'|'buyer'},now=Date.now()){
 const r=voiceResult(c,expected,now);if(!r)return null;
 const fields=c.analysis?.data_collection_results??{};
 const quote=(name:string)=>{
  const v=fields[name]?.value;
  return typeof v==='string'&&v.trim().length>=3&&r.transcript.some(t=>t.role==='user'&&t.message.includes(v))?v:null;
 };
 const humanQuote=quote('human_request_quote');
 // A conservative pause is preferable to ignoring an explicit request, even if extraction omitted a quote.
 const humanRequested=fields.human_requested?.value===true||r.transcript.some(t=>t.role==='user'&&/\b(speak|talk) (?:to|with) (?:a |an |the |your )?(?:human|person|manager|owner|supervisor|representative)\b|\breal person\b|\bhave (?:someone|a person) call me\b/i.test(t.message));
 const optedOut=fields.opted_out?.value===true||r.transcript.some(t=>t.role==='user'&&/\b(stop (?:calling|texting|contacting)|do not (?:call|text|contact)|don't (?:call|text|contact)|remove (?:me|my number))\b/i.test(t.message));
 const interested=fields.interested?.value===true&&!!quote('interest_quote');
 return {summary:r.summary,transcript:r.transcript,durationSeconds:r.durationSeconds,providerCostUsd:r.providerCostUsd,
  humanRequested,humanQuote,optedOut,interested,interestQuote:quote('interest_quote'),party:expected.party,
  callbackStatus:optedOut?'blocked_opt_out':humanRequested?'held_for_human':r.callbackStatus==='scheduled_test'?'pending_dispatch_review':r.callbackStatus,
  callbackDueAt:optedOut?null:r.dueAt,callbackTimezone:optedOut?null:r.timezone,callbackQuote:r.callbackQuote,callbackEvidence:r.callbackEvidence,
  nextAction:optedOut?'Do not contact again.':humanRequested?`Review the ${expected.party} conversation and contact them personally.`:interested?'Confirm condition, timing, price and all owners before negotiating.':'Review the conversation before the next contact.',
  // Provider/model analysis is not signature, escrow, title, or payoff evidence.
  underContract:false as const,
 };
}

export const productionDealInstructions=conversationTrustInstructions+`
You work on behalf of the saved principal. After identifying yourself, ask whether this is a good time and whether the seller would consider a cash offer. Do not talk over the seller. Learn condition, repairs, occupancy, desired timing, asking price, motivation and whether every owner agrees. Treat seller statements and photos as unverified evidence, not established value or title facts.
Use the assigned opener once; do not repeat it after the seller has answered. Do not pressure a refusal. Honor opt-outs immediately. If either a seller or buyer asks for a person, request a human handoff immediately, stop negotiating, and say a person needs to follow up; never promise an immediate transfer unless a transfer tool confirms it.
Use only a fresh server-approved offer ceiling. Never raise it yourself, promise unapproved terms, invent proof of funds, sign for anyone, or claim a verbal yes is a contract. Escalate counteroffers outside authority. Confirm legal names and all required owners before preparing documents. If a required decision-maker is absent, save the conversation and wait for a confirmed follow-up; do not repeatedly call or spend on another negotiation. Record tenants, access limits and unusual situations as review notes; do not assume they make a deal impossible or that vacant possession is promised. If discussing the standard 30-day closing target after the effective date, label it as a proposal subject to the agreed terms and title review, not a promised completion date. Use only the agreed price within the approved ceiling. Seller signs first; customer signs afterward. Customer auto-signing requires separate explicit, current authorization covering the exact document and terms. Say a contract was sent only after delivery succeeds, and under contract only after required signatures are verified.
Ask for an exact callback date, time and timezone; read it back and obtain confirmation. Never say a callback is scheduled unless the scheduling tool confirms it. If a tool fails, explain that the request needs follow-up. For buyers confirm interest, funds, access and timing; never claim deposits received or closing complete without verified evidence. Never give AI-generated wire instructions.`;
