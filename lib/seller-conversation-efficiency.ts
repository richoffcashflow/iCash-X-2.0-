import {sellerResponseDisposition} from './seller-response-policy.ts';
import {opportunityConversationInstructions} from './outreach-conversation.ts';

/** A direct request for our price advances the conversation, not price authority.
 * Only the caller's own words qualify; refusals and reported offers do not. */
export function sellerRequestsPrice(message:string):boolean{
 const text=message.replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
 if(sellerResponseDisposition(text)!==null)return false;
 return /^(?:(?:okay|ok|yeah|yes|sure|well|so|then|but)[,.!? ]+)*(?:(?:how much|what) (?:would|will|can|could|do|are) (?:you|you'll|you all) (?:give|pay|offer)(?: me| us)?\b|(?:how much|what) (?:you'll|you) (?:give|pay|offer)(?: me| us)?\b|what(?:'s| is) your (?:cash )?offer\b|(?:can|could|would|will) you (?:make|give|send)(?: me| us)? (?:a |an |your )?(?:cash )?offer\b)/i.test(text);
}

export const sellerConversationEfficiencyInstructions=`A direct request for our price answers availability/interest, not ownership or property facts. Use get_offer and its nextQuestion; never restart answered questions, invent a price or override a refusal. On an explicit voicemail greeting, record-after-tone instruction or disconnected announcement, end_call immediately without a pitch or repeated silence checks. Screening assistants get one truthful AI/business identity; wait for a person, then end_call if unavailable. Machines and silence are not seller interest.`;

/** Keep room for actual seller answers within the unchanged provider limit.
 * The frozen provider policy stays intact; this is the outbound runtime prompt. */
export function efficientSellerPrompt(prompt:string){
 return prompt.replace(opportunityConversationInstructions,'PROPERTY OPPORTUNITY FLOW: Never invent a prior inquiry. Confirm the bound owner, then offer interest. Keep AI/business identity truthful; honor refusals. Never reveal acquisition sources or scores.')
  .replace(/NEXT STEP:[^\n]+/,'NEXT STEP: Read priorExchanges and recentSms first. After accept_offer, reuse confirmed closing date, legal name, sole ownership and inspection answers. Read them back with the actual prepared inspection period; ask if correct and whether to text the agreement now. Wait for confirmation before confirm_and_send.')
  .replace(/DELIVERY FAILURE RESPONSE:[^\n]+/,'DELIVERY FAILURE RESPONSE: If confirm_and_send returns sent=false, apologize that the agreement text failed. Promise retries, later delivery or human contact only with a successful queue result; otherwise say later delivery is unconfirmed. Do not offer unrelated help. Answer concrete questions, then end politely when done. These limits also govern goodbye.')+'\n'+sellerConversationEfficiencyInstructions;
}
