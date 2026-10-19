/** Source-word policy, not sentiment scoring. A soft refusal pauses automation;
 * only an actual stop-contact request establishes permanent suppression.
 * Keep the SQL implementation and parity fixtures in sync. */
export type SellerResponseDisposition='opt_out'|'declined'|'review'|null;
export const sellerResponsePatterns={
 optOut:"\\bplease unsubscribe(?: me)?\\b|(?:^|[,;.!] +)(?:please )?(?:unsubscribe|dnc)(?: me)?[.! ,]*$|^(?:please )?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt out|dnc)(?: please)?(?:[.! ,]*$|\\s*[,;.!]\\s*(?:please\\b|call\\b|text\\b|but\\b))|\\b(?:(?:do not|don't|dont) want (?:you|your (?:company|business)) to (?:ever )?(?:call|text|email|contact)\\b|(?:do not|don't|dont|never) (?:ever )?(?:call|text|email|message|contact)(?:ing)?(?: (?:me|us))?\\b(?! (?:it|that|the house|the property)\\b)|(?:stop|quit) (?:calling|texting|emailing|messaging|contacting)\\b|(?:unsubscribe|remove|delete) (?:me|my number)\\b|take (?:me|my number) off\\b|leave (?:me|us) alone\\b|(?:put|add|place) (?:me|my number) (?:on|in) (?:your |the )?(?:dnc|do not call)(?: list)?\\b|(?:i am|i'm) (?:already )?on (?:the |your )?(?:dnc|do not call) list\\b)",
 declined:"\\b(?:no thanks|no thank you|wrong number|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\\b",
 review:"\\b(?:scam|scammer|scammers|fraud|fraudulent|suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\\b|^(?:not comfortable|not ready)[.! ,]*$",
 nonRequest:"(?:\\b(?:not|never|did not|didn't|don't|do not|was not|wasn't) (?:say|saying|said|mean|meaning|ask|asking|asked|request|requesting|want|wanted)\\b[^.!?;]{0,100}|\\b(?:you|they|he|she|the tenant|my tenant|the owner|the agent|my wife|my husband) (?:said|say|wrote|asked)\\b[^.!?;]{0,100}|\\b(?:word|phrase|example)\\b[^.!?;]{0,60}|\\b(?:do not|don't|dont|never|not) )$",
 negatedIntroduction:"\\b(?:not|never|did not|didn't|don't|do not) (?:say|saying|mean|meaning|ask|asking|request|requesting)[ ,\"']*$",
 machine:"^(?:(?:hi|hello)[,.! ]+)?(?:you.{0,8}(?:have reached|ve reached)|(?:this is |welcome to ).{0,60}(?:voice[ -]?mail|mailbox|automated (?:system|assistant))|(?:please )?leave.{0,25}(?:message|name|number)|after.{0,12}(?:tone|beep)|(?:the person|the subscriber|the number|your call|the call|this number).{0,80}(?:not available|unavailable|forwarded|disconnected|not in service)|no one is available|press [0-9]|comunicarte.{0,30}no est[aá] disponible|(?:buz[oó]n de voz|correo de voz)|(?:graba|grabe|deja|deje).{0,25}mensaje)",
};
const normalize=(body:string)=>body.toLowerCase().replace(/[’‘]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').trim();
function directMatch(body:string,pattern:string){
 for(const match of body.matchAll(new RegExp(pattern,'g'))){
  const sentence=body.slice(0,match.index).split(/[.!?;]|\bbut\b/).at(-1)??'';
  // A reported quote stays in its reporting clause; a fresh demand after a comma does not.
  const quoted=(sentence.match(/"/g)?.length??0)%2===1;
  const prefix=quoted?sentence:sentence.split(',').at(-1)??'';
  if(!new RegExp(sellerResponsePatterns.nonRequest).test(prefix)&&!new RegExp(sellerResponsePatterns.negatedIntroduction).test(sentence))return true;
 }
 return false;
}
export function sellerResponseDisposition(source:string):SellerResponseDisposition{
 const body=normalize(source);
 if(directMatch(body,sellerResponsePatterns.optOut))return 'opt_out';
 // Exclude only the channel preference, never a separate refusal in the same message.
 const declineBody=/\b(?:call|talk)\b/.test(body)?body.replace(/\bnot (?:(?:super|very|really|that|at all) )?interested in (?:texting|emailing|emails|texts)\b/g,''):body;
 if(directMatch(declineBody,sellerResponsePatterns.declined)){
  // Price conditions are not a permanent opt-out, but do stop automated pursuit.
  return /\b(?:unless|if|but)\b|\$|\bprice\b/.test(body)?'review':'declined';
 }
 if(directMatch(body,sellerResponsePatterns.review)){
  if(!body.includes('?')&&/\b(?:not|isn't|is not|wasn't|was not) (?:a )?(?:scam|fraud)\b/.test(body)
   &&!directMatch(body,sellerResponsePatterns.review.replace('scam|scammer|scammers|fraud|fraudulent|','')))return null;
  return 'review';
 }
 return null;
}
export function sellerCallDisposition(transcript:{role:string;message?:string|null}[]):SellerResponseDisposition{
 const words=transcript.filter(t=>t.role==='user'&&typeof t.message==='string').map(t=>t.message!);
 if(words.some(t=>sellerResponseDisposition(t)==='opt_out'))return 'opt_out';
 if(!words.some(t=>/[a-z0-9]/i.test(t)))return null;
 let disposition:SellerResponseDisposition=null,lastAgent='';
 for(const turn of transcript){
  if(turn.role==='agent'){lastAgent=turn.message??'';continue;}
  if(turn.role!=='user'||typeof turn.message!=='string')continue;
  if(new RegExp(sellerResponsePatterns.machine,'i').test(turn.message.trim())){lastAgent='';continue;}
  let current=sellerResponseDisposition(turn.message);
  if(!current&&/^no(?:[,! .]+(?:thanks|thank you|gracias))?[.! ]*$/i.test(turn.message.trim())
   &&/interested.{0,35}(sell|cash offer)|consider selling|want to sell|open to.{0,15}cash offer/i.test(lastAgent))current='declined';
  if(current==='opt_out')return current;
  if(current==='declined'||!disposition)disposition=current;
  lastAgent='';
 }
 return disposition;
}
