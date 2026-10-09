import {createHash} from 'node:crypto';
import {buyerAnswerPrompt,buyerAnswerInstructions} from './buyer-answer-policy.ts';
import {buyerValidatedEntryInstructions} from './buyer-validated-policy.ts';
import {buyerTurnModel} from './buyer-turn-policy.ts';
import {buyerConversationGuardrail,buyerConversationToolInstruction} from './buyer-conversation-policy.ts';
import {selectedRoleInstructions,unknownRoleInstructions} from './buyer-role-policy.ts';

// A separately fingerprinted voice candidate. Complete-response guardrails are
// unsupported for streaming speech, so only the existing streaming price guard
// is present. Scenario results, never this model choice, authorize activation.
export const buyerSpeakingPolicy='automatic_offer_v18';
export const buyerSpeakingPrompt=buyerAnswerPrompt;
export const buyerSpeakingInstructions=buyerAnswerInstructions;
export const buyerSpeakingEntryInstructions=buyerValidatedEntryInstructions;
export const buyerSpeakingModel={...buyerTurnModel,llm:'gpt-5.4'};
export function buyerSpeakingModelMatches(prompt:Record<string,unknown>){return Object.entries(buyerSpeakingModel).every(([key,value])=>key==='thinking_budget'?(prompt[key]===0||prompt[key]==null):prompt[key]===value);}
export const buyerSpeakingGuardrail=buyerConversationGuardrail;
export function selectedSpeakingRoleInstructions(status:unknown,sellerPrompt:string){return status==='buyer'?buyerSpeakingInstructions:selectedRoleInstructions(status,sellerPrompt);}
export function buyerSpeakingPolicyHash(sellerPrompt:string){return createHash('sha256').update(JSON.stringify({policy:buyerSpeakingPolicy,prompt:buyerSpeakingPrompt,entry:buyerSpeakingEntryInstructions,buyer:buyerSpeakingInstructions,model:buyerSpeakingModel,seller:selectedRoleInstructions('matched',sellerPrompt),unknown:unknownRoleInstructions,guardrail:buyerSpeakingGuardrail,toolInstruction:buyerConversationToolInstruction})).digest('hex');}
