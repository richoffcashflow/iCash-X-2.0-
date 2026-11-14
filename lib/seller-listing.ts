import {object} from './required-call-recording.ts';

/** A short answer belongs to the latest question, not an earlier acknowledgement
 * in the same agent turn. Otherwise "not listed ... interested in selling?" +
 * "yes" silently reverses the seller's already established listing status. */
function asksListingStatus(message:string):boolean{
 const sentence=message.split(/[.!?;\n]+/).map(part=>part.trim()).filter(Boolean).at(-1)??'';
 const starts=[...sentence.matchAll(/\b(?:is|are|do|does|have|has)\s+(?:you|it|(?:your|the|this|that)\s+(?:property|home|house|listing))\b/gi)];
 const last=starts.at(-1);if(!last)return false;
 const question=sentence.slice(last.index);
 return /\b(listed|listing)\b/i.test(question)&&/\b(agent|realtor|broker)\b/i.test(question)
  // Bare yes/no to a negative question is ambiguous; require an explicit answer.
  &&! /\b(?:not|isn['’]t|aren['’]t|no longer)\b/i.test(question);
}

/** Only the actual latest seller turn can establish listing status. */
export function sellerListingEvidence(value:unknown,input:Record<string,unknown>):boolean|null{
 if(input.action!=='report_change')return null;
 const transcript=object(value).transcript;if(!Array.isArray(transcript))return null;
 const turns=transcript.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const i=turns.findLastIndex(t=>t.role==='user'),answer=String(turns[i]?.message??'').trim();
 if(!answer||answer!==String(input.sellerStatement??'').trim())return null;
 const question=String(turns.slice(0,i).findLast(t=>t.role==='agent')?.message??'');
 const listingQuestion=asksListingStatus(question);
 // A choice between agent listing and self-sale needs an explicit choice;
 // a bare yes/no must not answer both alternatives.
 if(/\bor\b/i.test(question)&&/selling (?:it )?yourself/i.test(question)
  &&/^(?:yes|no|yeah|nope|correct)[.! ]*$/i.test(answer))return null;
 if(/\b(?:but|however|although|except)\b/i.test(answer)&&/\b(?:agent|realtor|broker|agreement|listed|listing)\b/i.test(answer))return null;
 // Speech transcripts include fillers and complete short replies such as
 // "No, it's not." Bind these only to the actual positive listing question;
 // never interpret an unrelated no or a contradictory added clause as evidence.
 const shortAnswer=answer.replace(/’/g,"'").replace(/\b(?:um|uh)\b/gi,' ').replace(/[,!.]/g,' ').replace(/\s+/g,' ').trim();
 if(listingQuestion&&/^(?:no|nope)(?: (?:no|nope))?(?: (?:it(?:'s| is) not|it isn't|not currently|not anymore))?$/i.test(shortAnswer))return false;
 if(listingQuestion&&/^(?:yes|yeah|yep|correct)(?: it is)?$/i.test(shortAnswer))return true;
 if(listingQuestion&&/^(no|nope|not currently|not anymore)[.! ]*$/i.test(answer))return false;
 if(listingQuestion&&/^(yes|yeah|yep|correct|it is)[.! ]*$/i.test(answer))return true;
 if(/\b(not|isn['’]t|is not|no longer)\s+(currently\s+)?listed\b/i.test(answer))return false;
 if(/\b(listing|agent agreement)\s+(has\s+)?(expired|ended|was cancelled|was canceled)\b/i.test(answer))return false;
 if(/^(?:(?:i am|i'm|we are|we're) )?(?:selling (?:it )?(?:myself|ourselves)|for sale by owner|fsbo)[.! ]*$/i.test(answer))return false;
 if(/\b(listed|listing)\b/i.test(answer)&&/\b(agent|realtor|broker)\b/i.test(answer)
  &&! /\b(not|no|never|was|used to|might|maybe|planning|considering|expired|cancelled|canceled)\b/i.test(answer))return true;
 return null;
}
