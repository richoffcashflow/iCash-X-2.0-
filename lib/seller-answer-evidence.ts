import {sellerContactPurposeQuestion} from './seller-contact-purpose.ts';
/** Narrow conversational evidence, never price, ownership or contact authority.
 * Preserve the original quote; normalization is for matching only. */
export function sellerAnswerText(value:string){
 return value.replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
}
export function sellerAffirmation(value:string){
 const text=sellerAnswerText(value);
 return /^(?:(?:um|uh|well)[, .]+)*(?:(?:yes|yeah|yep|yup|y|sure|correct|absolutely|i am|it is|that's right|that is right)\b|(?:i (?:said|already said)|i(?:'ve| have)? (?:already )?told you(?: once)?)(?:[, .]+(?:mr\.? ai[, .]+)?)?[, .]*(?:yes|yeah|sure|i (?:am|would|do|will))\b)/i.test(text)
  && !/\b(?:not|never|didn't|did not|if|unless|only if)\b/i.test(text);
}
export function sellerExplicitUnknown(value:string){
 return /\b(?:i (?:do not|don't) know|not sure|unknown|rather not (?:say|discuss|guess)|prefer not to (?:say|discuss)|haven't decided|have not decided)\b/i.test(sellerAnswerText(value));
}
/** These complete informational questions already have deterministic replies.
 * Punctuation is optional in SMS and transcripts; the question is not a name
 * or a property answer. An explicit name introduction remains a separate text. */
export function sellerInformationQuestion(value:string):'costs'|'process'|null{
 const text=sellerAnswerText(value);
 if(/^(?:who pays (?:the )?closing costs|(?:are there|what about|what are|any) (?:the |any )?fees)[?! .]*$/i.test(text))return 'costs';
 if(/^(?:how (?:does|will) (?:this|it) work|what happens next)[?! .]*$/i.test(text))return 'process';
 return null;
}
/** A request about the transaction is never a person's legal name. */
export function sellerIdentityInterruption(value:string){
 return sellerUnrelatedAnswer(value)||value.includes('?')||/^(?:(?:yes|okay|ok)[,. ]+)?(?:please )?(?:send|text|email|show|give)(?: me| us)?\b/i.test(value.trim());
}
export function sellerStatementText(value:string){
 return (value.match(/[^.!?]+[.!?]?/g)??[]).filter(clause=>!clause.trim().endsWith('?')).join(' ');
}
export function sellerUnrelatedAnswer(value:string){
 const text=sellerAnswerText(value);
 return sellerContactPurposeQuestion(text)||sellerInformationQuestion(text)!==null||/\b(?:(?:he|she|they|my agent|my realtor|the buyer) (?:said|asked|wrote)|who (?:are you|is this)|how did you (?:get|find)|where did you (?:get|find)|why (?:are you|did you) (?:calling|call|texting|text)|call (?:me|you)|(?:text|email)(?: me)? (?:only|instead)|system prompt|ignore (?:all|previous)|wire|bank account)\b/i.test(text)
  || /^(?:email|text|stop|hello|what|pardon|sorry)[.!? ]*$/i.test(text);
}
export function sellerPropertyAnswer(kind:'condition'|'occupancy'|'timing'|'situation',value:string){
 const text=sellerAnswerText(value);
 if(sellerUnrelatedAnswer(text))return false;
 if(sellerExplicitUnknown(text))return true;
 const patterns={
  condition:/\b(?:excellent|good|fair|poor|bad|perfect|great|fine|average|livable|habitable|gutted|renovat\w*|remodel\w*|repair\w*|updat\w*|roof|paint|plumbing|electrical|foundation|damage|kitchen|bathroom|floor\w*|hvac|nothing.*(?:need|done)|no work|no (?:it|there)|none|nope)\b|^no[.! ]*$/i,
  occupancy:/\b(?:occup(?:ied|ancy)|vacant|unoccupied|empty|tenants?|rent\w*|(?:i|we|they|nobody|no one|family) (?:do|live|lives|are)|(?:my|our) (?:brother|sister|mother|father|spouse|wife|husband|son|daughter|family|parents?)|yes|yeah|no|nope)\b/i,
  timing:/\b(?:whenever|anytime|any time|asap|soon|immediately|no rush|no deadline|flexible|today|tomorrow|next|within|in \d+|days?|weeks?|months?|years?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b\d{4}-\d{2}-\d{2}\b/i,
  situation:/\b(?:moving|relocat\w*|inherited|inheritance|tired|downsizing|upkeep|afford|maintain|sell|selling|retir\w*|divorc\w*|job|family|taxes|mortgage|vacant|don't (?:use|need)|do not (?:use|need)|get rid)\b/i,
 };
 // A question alone is not an answer, even if it repeats the topic word.
 return patterns[kind].test(text)&&(!text.includes('?')||text.split(/(?<=[.!])\s+/).some(part=>!part.includes('?')&&patterns[kind].test(part)));
}
