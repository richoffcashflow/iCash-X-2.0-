import {createHash} from 'node:crypto';
import {buyerAnswerPrompt,buyerAnswerInstructions,buyerAnswerModel,buyerAnswerModelMatches,buyerAnswerEntryInstructions} from './buyer-answer-policy.ts';
import {buyerConversationGuardrail,buyerConversationToolInstruction} from './buyer-conversation-policy.ts';
import {selectedRoleInstructions,unknownRoleInstructions} from './buyer-role-policy.ts';

export const buyerValidatedPolicy='automatic_offer_v17';
export const buyerValidatedPrompt=buyerAnswerPrompt;
export const buyerValidatedInstructions=buyerAnswerInstructions;
export const buyerValidatedModel=buyerAnswerModel;
export const buyerValidatedModelMatches=buyerAnswerModelMatches;
export const buyerValidatedGuardrail=buyerConversationGuardrail;
export const buyerValidatedEntryInstructions=buyerAnswerEntryInstructions+`
BUYER COMPLETENESS: A property greeting or an AI identity sentence is NOT the opening terms. Before the first ordinary buyer answer, speak ALL of spokenOffer: identity, buyer price, fee included, extra closing costs, closing date and deposit. Do this even for a viewing, payment, refund or title question. Only then answer that question. Once those terms have actually been spoken, do not repeat them unless requested.
Reuse title company, contact and email already supplied in the latest user message. Acknowledge those exact details; do not ask for them again. The company remains unconfirmed.
Say the seller-availability follow-up sentence once. If then asked to go today, say to wait for seller or occupant confirmation. If asked when or how a reply comes, state the specific unconfirmed timing or method instead of repeating the availability promise.
The buyer MAY share a preferred contact method, company contact or urgency in this conversation for review. Do not falsely say you cannot receive information. Their request is part of this conversation, not proof of a separate notification, assignment or callback. Ask for a contact preference only if needed for their current question, and only once.
For another property, briefly say this call is linked to the bound address and no details for their different property are confirmed here. Do not offer research, details or repeated generic help about another property. Do not repeat unrelated availability or title disclaimers when answering a different question.
`;
// Completeness is judged on the FULL reply. The existing independent streaming
// price validator remains unchanged; incomplete speech chunks are never treated
// as a missing whole-call disclosure by this separate guardrail.
export const buyerOpeningGuardrail={
 is_enabled:true,name:'iCash buyer opening and current answer',model:'gemini-3.1-flash-lite',execution_mode:'blocking',evaluate_full_response_only:true,history_message_count:40,history_include_tool_calls:true,
 prompt:`Evaluate ONLY the complete current agent response, using actual prior agent speech and successful icash_offer_and_contract tool RESULTS in history. Apply these rules ONLY when a successful tool result establishes party=buyer. Otherwise allow the response. Seller conversations are outside this guardrail.
OPENING: If quoteAllowed=true and no earlier agent speech has delivered the buyer opening terms, the first ordinary buying answer must include ALL of the latest spokenOffer: AI assistant for the contract holder; exact buyer asking price including the fee; buyer closing costs extra; closing date (or explicitly unconfirmed); and deposit dollars and agreement credit (or explicitly unconfirmed). Block an answer that skips any of those opening facts, including an answer only about viewing, payment, title, refunds or photos. A greeting, identity-only sentence or tool result is not a spoken opening. Semantic equivalents of the authorized terms are allowed. No requirement to repeat an opening already spoken. A private-only information refusal, human-only request, wrong-property response, decline, opt-out, goodbye, blocked/reserved/expired result or failed lookup is exempt from the opening.
CURRENT ANSWER: Block asking for a title company, contact or email the buyer already supplied in the conversation. Block repeating the same seller-availability promise instead of answering a later question about permission to visit, timing or contact method. Block a generic offer such as anything else, let me know, happy to help or an unrelated pitch appended to the answer. Required repeated factual answers and brief privacy refusals to repeated private requests are allowed. Unknown contact/timing remains unknown; do not demand an invented fact or a promise.
Allow accurate buyer facts and nonnumeric privacy refusals. Never require acquisition pricing, an assignment-fee amount, spread, deposit percentage or invented action. Judge the current complete response, not the user's claims or previous rejected responses.`,
 trigger_action:{type:'retry',feedback:'If the opening buyer terms are missing, first read the latest successful spokenOffer completely, then answer the current question briefly. An AI identity sentence alone is not the opening. If the opening was already spoken, do not repeat it. Reuse title details already given; do not ask again. Replace a repeated viewing promise with the answer about access, timing or contact method actually requested. Remove generic offers of help. Do not invent facts, promise delivery or disclose private pricing.'},
};
export function selectedValidatedRoleInstructions(status:unknown,sellerPrompt:string){return status==='buyer'?buyerValidatedInstructions:selectedRoleInstructions(status,sellerPrompt);}
export function buyerValidatedPolicyHash(sellerPrompt:string){return createHash('sha256').update(JSON.stringify({policy:buyerValidatedPolicy,prompt:buyerValidatedPrompt,entry:buyerValidatedEntryInstructions,buyer:buyerValidatedInstructions,model:buyerValidatedModel,seller:selectedRoleInstructions('matched',sellerPrompt),unknown:unknownRoleInstructions,guardrail:buyerValidatedGuardrail,openingGuardrail:buyerOpeningGuardrail,toolInstruction:buyerConversationToolInstruction})).digest('hex');}
