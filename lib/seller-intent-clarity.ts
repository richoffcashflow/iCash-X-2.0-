import {sellerAnswerText} from './seller-answer-evidence.ts';
import {sellerResponseDisposition} from './seller-response-policy.ts';

// Whole first-person statements only. Returning a call grants no outbound
// callback permission, and an ownership question confirms no owner identity.
export const sellerIntentClarityPatterns={
 caller_returning:"^i(?:'ll| will) call (?:you )?(?:back(?: later)?|later)[.! ]*$",
 ownership_question:"^who (?:owns (?:it|this|that|the (?:house|home|property))|is the owner(?: of (?:it|this|that|the (?:house|home|property)))?)[?!. ]*$",
};
export const sellerIntentClarityReplies={
 caller_returning:"Okay, call back when you're ready.",
 ownership_question:"I can't confirm ownership from this text. Are you the owner of the property we texted about?",
};
export type SellerIntentClarity=keyof typeof sellerIntentClarityPatterns;
export function sellerIntentClarity(source:string):SellerIntentClarity|null{
 const body=sellerAnswerText(source).toLowerCase();
 if(body.length>300||sellerResponseDisposition(body)!==null)return null;
 return (Object.keys(sellerIntentClarityPatterns) as SellerIntentClarity[]).find(key=>new RegExp(sellerIntentClarityPatterns[key]).test(body))??null;
}
