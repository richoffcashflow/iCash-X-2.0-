/** Owner gate only. Entire response must consist of one to six clear affirmative clauses.
 * No substring extraction, fuzzy matching, semantic model, or punctuation-driven negation removal.
 * Keep the PostgreSQL helper in owner-recording-natural-consent-v3.sql byte-equivalent in behavior.
 */
export const ownerNaturalAffirmativePattern='^((yes|yeah|yep|sure|okay|ok|absolutely|certainly)( please)?|(that is|it is) (okay|ok|fine)( with me)?|(it is |that is )?(okay|ok|fine) to record( (this|the) call)?|(you (can|may) record|please record)( (this|the) call)?|record (this|the) call|(you (can|may) )?go ahead( (and )?record( (this|the) call)?)?|i (agree|consent)( to (recording|you recording)( (this|the) call)?)?|i am (okay|ok|fine) with (that|you recording( (this|the) call)?))( (and )?((yes|yeah|yep|sure|okay|ok|absolutely|certainly)( please)?|(that is|it is) (okay|ok|fine)( with me)?|(it is |that is )?(okay|ok|fine) to record( (this|the) call)?|(you (can|may) record|please record)( (this|the) call)?|record (this|the) call|(you (can|may) )?go ahead( (and )?record( (this|the) call)?)?|i (agree|consent)( to (recording|you recording)( (this|the) call)?)?|i am (okay|ok|fine) with (that|you recording( (this|the) call)?))){0,5}$';
const affirmative=new RegExp(ownerNaturalAffirmativePattern);
export function ownerNaturalAffirmative(text:string|null):boolean{
 if(typeof text!=='string'||text.length===0||text.length>120||text.includes('..')||!/^[A-Za-z \t\r\n\f\v\u00a0,.!?'’‘]+$/.test(text))return false;
 // ASR punctuation is inferred: only a sole direct affirmative may carry a question mark.
 if(text.includes('?'))return /^(yes|yeah|yep|sure|okay|ok|absolutely|certainly)[,.!? ]*$/.test(text.toLowerCase().replace(/[ \t\r\n\f\v\u00a0]+/g,' ').trim());
 const normalized=text.toLowerCase().replace(/[’‘]/g,"'").replaceAll("that's",'that is').replaceAll("it's",'it is').replaceAll("i'm",'i am').replace(/[,\.!]/g,' ').replace(/[ \t\r\n\f\v\u00a0]+/g,' ').trim();
 return affirmative.test(normalized);
}
/** Shape diagnostics contain no transcript, transformed transcript, identifying tokens or hash. */
export function ownerSpeechShape(text:string|null){
 return {comma:typeof text==='string'&&text.includes(','),curlyApostrophe:typeof text==='string'&&/[’‘]/.test(text),question:typeof text==='string'&&text.includes('?'),repeatedAffirmative:typeof text==='string'&&/\b(yes|yeah|yep|sure|okay|ok)[ ,.!]+\1\b/i.test(text)};
}
