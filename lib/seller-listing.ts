import {object} from './required-call-recording.ts';

/** Only the actual latest seller turn can establish listing status. */
export function sellerListingEvidence(value:unknown,input:Record<string,unknown>):boolean|null{
 if(input.action!=='report_change')return null;
 const transcript=object(value).transcript;if(!Array.isArray(transcript))return null;
 const turns=transcript.map(object).filter(t=>['user','agent'].includes(String(t.role))&&typeof t.message==='string');
 const i=turns.findLastIndex(t=>t.role==='user'),answer=String(turns[i]?.message??'').trim();
 if(!answer||answer!==String(input.sellerStatement??'').trim())return null;
 const question=String(turns.slice(0,i).findLast(t=>t.role==='agent')?.message??'');
 const listingQuestion=/\b(listed|listing)\b/i.test(question)&&/\b(agent|realtor|broker)\b/i.test(question);
 if(/\b(?:but|however|although|except)\b/i.test(answer)&&/\b(?:agent|realtor|broker|agreement|listed|listing)\b/i.test(answer))return null;
 if(listingQuestion&&/^(no|nope|not currently|not anymore)[.! ]*$/i.test(answer))return false;
 if(listingQuestion&&/^(yes|yeah|yep|correct|it is)[.! ]*$/i.test(answer))return true;
 if(/\b(not|isn['’]t|is not|no longer)\s+(currently\s+)?listed\b/i.test(answer))return false;
 if(/\b(listing|agent agreement)\s+(has\s+)?(expired|ended|was cancelled|was canceled)\b/i.test(answer))return false;
 if(/\b(listed|listing)\b/i.test(answer)&&/\b(agent|realtor|broker)\b/i.test(answer)
  &&! /\b(not|no|never|was|used to|might|maybe|planning|considering|expired|cancelled|canceled)\b/i.test(answer))return true;
 return null;
}
