import {sellerResponseDisposition} from './seller-response-policy.ts';
import {opportunityConversationInstructions} from './outreach-conversation.ts';

/** A direct request for our price advances the conversation, not price authority.
 * Only the caller's own words qualify; refusals and reported offers do not. */
export function sellerRequestsPrice(message:string):boolean{
 const text=message.replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
 if(sellerResponseDisposition(text)!==null)return false;
 if(/^(?:(?:okay|ok|yeah|yes|sure|well|so|then|but)[,.!? ]+)*(?:how much(?: for (?:it|the (?:house|property)))?|what(?:'s| is) the (?:cash )?offer)[?!. ]*$/i.test(text))return true;
 return /^(?:(?:okay|ok|yeah|yes|sure|well|so|then|but)[,.!? ]+)*(?:(?:how much|what) (?:would|will|can|could|do|are) (?:you|you'll|you all) (?:give|pay|offer)(?: me| us)?\b|(?:how much|what) (?:you'll|you) (?:give|pay|offer)(?: me| us)?\b|what(?:'s| is) your (?:cash )?offer\b|(?:can|could|would|will) you (?:make|give|send)(?: me| us)? (?:a |an |your )?(?:cash )?offer\b)/i.test(text);
}

export const sellerConversationEfficiencyInstructions=`A direct request for our price answers availability/interest, not ownership or property facts. Use get_offer and its nextQuestion; never restart answered questions, invent a price or override a refusal. On an explicit voicemail greeting, record-after-tone instruction or disconnected announcement, end_call immediately without a pitch or repeated silence checks. Screening assistants get one truthful AI/business identity; wait for a person, then end_call if unavailable. Machines and silence are not seller interest.`;

/** Keep room for actual seller answers within the unchanged provider limit.
 * The frozen provider policy stays intact; this is the outbound runtime prompt. */
export function efficientSellerPrompt(prompt:string){
 return prompt.replace(opportunityConversationInstructions,'PROPERTY OPPORTUNITY FLOW: Never invent a prior inquiry. Confirm the bound owner, then offer interest. Keep AI/business identity truthful; honor refusals. Never reveal acquisition sources or scores.')
  .replace(/^OPENING SEQUENCE OVERRIDE:[^\n]+/m,line=>line
   .replace('Keep turns to one or two short sentences, with one question, then wait. ','')
   .replace('Do not ask two opening questions at once. ','')
   .replace('The opening confirms whether the person owns the exact bound property address. ','')
   .replace('Do not repeat a cold-prospect pitch. ','')
   .replace('Ask one short question at a time. ','')
   .replace('Answer one question at a time; do not pressure or invent urgency. ','Do not pressure or invent urgency. '))
  // Compact equivalent delivery rules before adding runtime cadence. Bound
  // history is JSON data (escaped newlines), never a target of these line rules.
  .replace(/^VOICE DELIVERY:[^\n]+/m,'VOICE DELIVERY: Quote successful spokenPrice/displayPrice verbatim, then all tool conditions; ask one question and wait. quoteAllowed=true permits a conditional quote even if contractAllowed=false, which blocks agreement sending only. Do not replay heard sentences after interruption. Price retries never justify ending; end only for goodbye, opt-out or completed conversation.')
  .replace(/^PACE:[^\n]+/m,'PACE: Use 1–2 short sentences. Before a tool calculation say "Let me check that." once; call immediately. Never repeat the preface or get_offer after report_change/update_repairs returned current price and revision. No repeated repair/holding explanations. Tool delay is not grounds to hang up.')
  .replace(/^NEXT STEP:[^\n]+/m,'NEXT STEP: Read priorExchanges and recentSms first. After accept_offer, reuse confirmed closing date, legal name, sole ownership and inspection answers. Read them back with the actual prepared inspection period; ask if correct and whether to text the agreement now. Wait for confirmation before confirm_and_send.')
  .replace(/^DELIVERY FAILURE RESPONSE:[^\n]+/m,'DELIVERY FAILURE RESPONSE: If confirm_and_send returns sent=false, apologize that the agreement text failed. Promise retries, later delivery or human contact only with a successful queue result; otherwise say later delivery is unconfirmed. Do not offer unrelated help. Answer concrete questions, then end politely when done. These limits also govern goodbye.')+'\n'+sellerConversationEfficiencyInstructions;
}
