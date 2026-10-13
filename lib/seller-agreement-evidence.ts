import {object} from './required-call-recording.ts';
import {agreementTextRequested,spokenMoneyAmounts} from './call-offer-evidence.ts';
import {offerPricePresentation} from './automatic-call-offer.ts';
import type {DealTerms} from './deal-documents.ts';

const words=(n:number)=>n===0?'zero':offerPricePresentation(n*100).spokenPrice.replace(/ dollars?$/,'');
const pattern=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll('-','[ -]');
const ordinals=['','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth','twentieth','twenty-first','twenty-second','twenty-third','twenty-fourth','twenty-fifth','twenty-sixth','twenty-seventh','twenty-eighth','twenty-ninth','thirtieth','thirty-first'];
function dateSpoken(text:string,date:string,now:number){
 const [year,month,day]=date.split('-').map(Number);
 const monthName=new Intl.DateTimeFormat('en-US',{month:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 const dayPattern=`(?:${day}(?:st|nd|rd|th)?|${pattern(words(day))}|${pattern(ordinals[day])})`;
 const yearPattern=`(?:${year}|${pattern(words(year)).replace('thousand ','thousand (?:and )?')}|${pattern(words(Math.floor(year/100))+' '+words(year%100))})`;
 if(new RegExp(`\\b(?:${date}|0?${month}[/.-]0?${day}[/.-]${year})\\b`,'i').test(text))return true;
 const namedDate=new RegExp(`\\b(?:${monthName}(?: the)?[ ,]+${dayPattern}|(?:the )?${dayPattern}(?: of)?[ ,]+${monthName})\\b`,'gi');
 const localParts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(now);
 const local=(type:string)=>Number(localParts.find(part=>part.type===type)?.value);
 const currentYear=local('year');
 const nextYear=Date.UTC(currentYear,month-1,day)<Date.UTC(currentYear,local('month')-1,local('day'))?currentYear+1:currentYear;
 for(const match of text.matchAll(namedDate)){
  const suffix=text.slice(match.index!+match[0].length).replace(/^[ ,]+/,'');
  if(new RegExp(`^${yearPattern}\\b`,'i').test(suffix))return true;
  // An omitted year means the next occurrence of that calendar date. An
  // explicit different year must never fall through as an omitted year.
  const explicitYear=/^(?:\d{4}\b|(?:one|two|three)[ -]thousand\b|(?:nineteen|twenty|twenty-one)[ -](?:\d|[a-z]))/i.test(suffix);
  if(!explicitYear&&year===nextYear)return true;
 }
 return false;
}
/** Model-authored booleans are not spoken confirmation. Require a real terms
 * readback and an unqualified answer authorizing this exact agreement text. */
export function sellerAgreementEvidence(value:unknown,terms:DealTerms,now=Date.now()){
 const rows=object(value).transcript;if(!Array.isArray(rows))return false;
 const turns=rows.map(object).filter(t=>['agent','user'].includes(String(t.role))&&typeof t.message==='string');
 const days=`(?:${terms.inspectionDays}|${pattern(words(terms.inspectionDays))})`;
 const inspection=new RegExp(`\\b(?:${days}[ -](?:calendar[ -])?days?.{0,30}inspection|inspection.{0,30}${days}[ -](?:calendar[ -])?days?)\\b`,'i');
 let pending=false,confirmed=false,previousQuestion='';
 for(const turn of turns){
  const text=String(turn.message).trim();
  if(turn.role==='agent'){
   previousQuestion=text;
   pending=spokenMoneyAmounts(text).includes(Number(terms.priceCents))&&dateSpoken(text,terms.closingDate,now)&&inspection.test(text)&&/\b(?:text|send)\b/i.test(text)&&!/\b(?:waive|waived|no inspection|without inspection)\b/i.test(text);
   if(!pending&&/\b(?:text|send)\b/i.test(text)&&/\b(?:price|closing|inspection)\b/i.test(text))confirmed=false;
   continue;
  }
  const answer=text.replace(/^(?:(?:um|uh|hmm|well)\b[\s,.-]*)+/i,'');
  // "No other owners" answers an ownership question, not the agreement. Only
  // this complete, unambiguous answer is exempt; an added withdrawal still stops.
  const noOtherOwners=/\b(?:other|else|anyone|anybody)\b/i.test(previousQuestion)&&/\b(?:owners?|decision makers?|agree)\b/i.test(previousQuestion)&&/^no[,. ]+(?:(?:there are )?no other owners?(?: or decision makers?)?|(?:just|only) me|nobody else|no one else)[.!]?$/i.test(answer);
  const objection=(!noOtherOwners&&/\b(?:no|not|don['’]?t|do not|but|if|unless|wait|stop|cancel|hold off|instead|changed|change|different|maybe|think|later|tomorrow|spouse|wife|husband|partner|attorney|lawyer)\b/i.test(answer))||spokenMoneyAmounts(answer).some(amount=>amount!==Number(terms.priceCents))||/\b(?:need|want|prefer)\b.{0,60}\b(?:closing|close|inspection|date|days?)\b/i.test(answer);
  if(objection)confirmed=false;
  if(pending)confirmed=!objection&&(/^(?:yes|yeah|yep|correct|sure|okay|ok|i agree|that works|sounds good|please (?:text|send)|(?:text|send)(?: me)? (?:the |that )?(?:agreement|contract))\b/i.test(answer)||agreementTextRequested(answer));
  pending=false;
 }
 return confirmed;
}
export function sellerAgreementConfirmationHold(terms:DealTerms){
 const date=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(terms.closingDate+'T12:00:00Z'));
 const nextQuestion=`The purchase price is ${offerPricePresentation(Number(terms.priceCents)).displayPrice} cash, closing ${date}, with a ${terms.inspectionDays}-day inspection period. Do those terms work, and may I text you the agreement for review now?`;
 return {sent:false,status:'confirmation_needed',reason:'terms_confirmation_required',nextQuestion,instruction:'This is a missing spoken confirmation, not a sending error. Read nextQuestion aloud and wait for the seller. Keep their saved name, owners and other answers. After an unqualified yes, call confirm_and_send with the same terms. Do not retry before their answer or tell them to contact the company themselves.'};
}
