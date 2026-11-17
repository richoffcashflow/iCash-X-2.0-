/** A complete conversational question about our reason for contact. Never
 * infer ownership, interest, price acceptance or a requested callback from it. */
export const sellerContactPurposePattern="^(?:(?:um|uh|hmm|well)[,. -]+)*(?:(?:hi|hello|hey|yes|yeah|yep|sure|okay|ok|correct|right|absolutely)[,! .]+)?(?:how (?:can|may) i help(?: you)?(?: today)?|(?:can|may) i help you(?: today)?|what can i do for you|what (?:is|was) this (?:for|about|regarding)|what(?:'s|s) this (?:for|about|regarding)|what are you (?:calling|texting) (?:for|about)|why (?:are you|did you) (?:calling|texting|call|text)(?: me)?|what do you want)(?: please)?[?! .]*$";
export function sellerContactPurposeQuestion(value:string){
 const body=value.toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
 return body.length<=300&&new RegExp(sellerContactPurposePattern).test(body);
}
