/** A short answer only has meaning with the actual immediately preceding turn.
 * These patterns are mirrored by the database final-contact policy. */
export const sellerCallAnswerPatterns={
 ownership:"\\b(?:is this|are you|am i (?:speaking|talking) (?:to|with)) (?:the )?(?:property )?owner\\b|\\bdo you (?:still )?own\\b|\\bis .{1,100} (?:your (?:house|home|property)|yours)\\b",
 interest:"\\b(?:interested.{0,35}(?:sell|cash offer)|consider (?:selling|a cash offer)|want to sell|open to.{0,15}cash offer)\\b",
 specificPrice:"\\$\\s*[0-9]|\\b[0-9][0-9,.]*\\s*(?:dollars?|grand|thousand|million|k|m)\\b|\\b(?:hundred|thousand|million) (?:dollars?|cash|offer)\\b",
 negative:"^(?:no|nope|nah|naw)(?:[,! .]+(?:thanks|thank you|gracias|sir|ma'am|maam|i (?:am not|don't|do not)|i'm not|we (?:are not|don't|do not)|that's not me))?[.! ,]*$|^(?:not me|i am not|i'm not|i don't|i do not|we are not|we don't|we do not)[.! ,]*$",
 negativeStart:"^(?:no|nope|nah|naw)\\b",
 politeNegative:"^no[,! .]+(?:thanks|thank you|gracias)[.! ,]*$",
};
const normalize=(s:string)=>s.toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
export function sellerCallAnswerDisposition(question:string,answer:string):'declined'|'review'|null{
 const q=normalize(question),a=normalize(answer);
 // Multiple questions or a final unrelated question must not borrow an earlier
 // ownership question. Unclear identity remains a review, never an opt-out.
 const questions=q.split('?').filter(part=>part.trim());
 const last=questions.at(-1)??'';
 if(new RegExp(sellerCallAnswerPatterns.ownership).test(last)){
  if(new RegExp(sellerCallAnswerPatterns.negative).test(a))return 'declined';
  if(new RegExp(sellerCallAnswerPatterns.negativeStart).test(a))return 'review';
 }
 // Rejecting an actual amount does not reject selling in general.
 if(new RegExp(sellerCallAnswerPatterns.specificPrice).test(last))return null;
 if(new RegExp(sellerCallAnswerPatterns.interest).test(last)&&new RegExp(sellerCallAnswerPatterns.negative).test(a))return 'declined';
 return null;
}
