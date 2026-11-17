import {object} from './required-call-recording.ts';
import {asksListingStatus,sellerListingEvidence} from './seller-listing.ts';

export const sellerListingClarificationQuestion='I mean a cash purchase, not listing your home. Is the property currently listed with a real estate agent?';

/** This narrow prospective reply changes no property fact. Other unmatched
 * answers can contain material corrections and keep their existing handling. */
export function sellerProspectiveListingReply(value:unknown,input:Record<string,unknown>): 'ask'|'unresolved'|null{
 if(input.action!=='report_change')return null;
 const transcript=object(value).transcript;if(!Array.isArray(transcript))return null;
 const turns=transcript.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const index=turns.findLastIndex(t=>t.role==='user'),answer=String(turns[index]?.message??'').trim();
 if(answer!==String(input.sellerStatement??'').trim()||!/^it (?:can|could) be with you[.!? ]*$/i.test(answer))return null;
 const question=String(turns.slice(0,index).findLast(t=>t.role==='agent')?.message??'');
 if(!asksListingStatus(question)||sellerListingEvidence(value,input)!==null)return null;
 for(let prior=0;prior<index;prior++){
  if(turns[prior].role!=='user'||!/^it (?:can|could) be with you[.!? ]*$/i.test(String(turns[prior].message).trim()))continue;
  const previousQuestion=String(turns.slice(0,prior).findLast(t=>t.role==='agent')?.message??'');
  if(asksListingStatus(previousQuestion))return 'unresolved';
 }
 return 'ask';
}

// Applied only to normal matched seller runtime prompts, before history budgeting.
// It neither changes a provider branch nor supplies source or offer authority.
export const sellerListingClarificationInstructions=`\nCURRENT LISTING ANSWERS: Ask agent-listing status before quoting unless answered. Save new answer verbatim with report_change; wait for its result. Only reason listed_with_agent confirms exclusion: say we do not buy currently agent-listed homes, then close using existing tools. Never claim a listing or save before success. If listed: no negotiation, agreement, callback, cancellation/removal advice or future-offer promises; refer listing changes to their agent. "It can be with you" or "It could be with you" is unclear. For listing_clarification_required, ask nextQuestion once and wait. For listing_status_unconfirmed, follow instruction without repeating. Other holds, including property_facts_changed, do not mean listed. Honor refusals/opt-outs. Clarification adds no offer/contact authority.`;

export function sellerListingClarificationPrompt(prompt:string){
 if(prompt.split(/\r?\n/).includes(sellerListingClarificationInstructions.trimStart()))return prompt;
 // Replace only the original instruction line, never JSON-quoted caller data.
 const legacy=/^LISTED PROPERTIES: Before the cash offer, ask once whether the property is currently listed with a real estate agent,[^\n]+/m;
 return legacy.test(prompt)?prompt.replace(legacy,sellerListingClarificationInstructions.trimStart()):prompt+sellerListingClarificationInstructions;
}

export function outboundSellerListingPrompt(prompt:string,scope:{party:string;intake:boolean;limited:boolean;cancellation:boolean;automaticOffer:boolean}){
 return scope.party==='seller'&&!scope.intake&&!scope.limited&&!scope.cancellation&&scope.automaticOffer?sellerListingClarificationPrompt(prompt):prompt;
}
