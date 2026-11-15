import {sellerCallAnswerDisposition,sellerCallAnswerPatterns} from './seller-call-answer.ts';
import {isAutomatedCallMenu} from './automated-call-menu.ts';
/** Source-word policy, not sentiment scoring. A soft refusal pauses automation;
 * explicit stops and the owner's strong-rejection policy establish suppression.
 * Keep the SQL implementation and parity fixtures in sync. */
export type SellerResponseDisposition='opt_out'|'declined'|'review'|null;
export const sellerResponsePatterns={
 optOut:"\\b(?:do not|don't|dont) send (?:me|us) (?:any |more |any more )?(?:texts?|messages?|emails?)(?: again)?\\b|(?:^|[.!?;] +)(?:please )?stop(?: please)?[.! ,]*$|\\b(?:stop|quit) (?:asking|bothering|harassing) (?:me|us)\\b|\\bplease unsubscribe(?: me)?\\b|(?:^|[,;.!] +)(?:please )?(?:unsubscribe|dnc)(?: me)?[.! ,]*$|^(?:please )?(?:stop|stopall|unsubscribe|cancel|end|quit|revoke|opt out|dnc)(?: please)?(?:[.! ,]*$|\\s*[,;.!]\\s*(?:please\\b|call\\b|text\\b|but\\b))|\\b(?:(?:do not|don't|dont) want (?:you|your (?:company|business)) to (?:ever )?(?:call|text|email|contact)\\b|(?:do not|don't|dont|never) (?:ever )?(?:call|text|email|message|contact)(?:ing)?(?: (?:me|us))?\\b(?! (?:it|that|the house|the property)\\b)|(?:stop|quit) (?:(?:calling|texting|emailing|messaging|contacting)\\b|(?:call|text|email|message|contact)\\b(?! (?:it|that|the house|the property)\\b))|(?:unsubscribe|remove|delete) (?:me|us|(?:my|our|this) (?:phone )?number)\\b|take (?:me|us|(?:my|our|this) (?:phone )?number) off\\b|leave (?:me|us) alone\\b|(?:put|add|place) (?:me|us|(?:my|our|this) (?:phone )?number) (?:on|in) (?:your |the )?(?:dnc|do not call)(?: list)?\\b|(?:i am|i'm) (?:already )?on (?:the |your )?(?:dnc|do not call) list\\b)",
 declined:"\\b(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no\\b|\\b(?:i|we) (?:will not|won't|wont) (?:ever )?sell\\b|\\b(?:no thanks|no thank you|wrong (?:phone )?number|not (?:up )?for sale|(?:i am|i'm|we are|we're) not (?:the )?owner|(?:i|we) (?:do not|don't|dont) own (?:the |this |that |my |our )?(?:house|home|property)|not (?:(?:super|very|really|that|at all) )?interested|(?:do not|don't|dont) want to sell|not selling(?: (?:my|our|the) (?:house|home|property))?|no quiero vender|no me interesa vender)\\b",
 review:"\\b(?:tired|sick) of (?:these|your|the) (?:texts|messages|calls)\\b|\\b(?:scam|scammer|scammers|fraud|fraudulent|suspicious|(?:i am|i'm|we are|we're) not (?:comfortable|ready)|need to think|never agreed|hold off|not for me|no interest|not looking to sell|(?:do not|don't|dont) trust|not now|not sure (?:about|i want)|stop bothering|waste of (?:my )?time)\\b|^(?:not comfortable|not ready)[.! ,]*$",
 nonRequest:"(?:\\b(?:not|never|did not|didn't|don't|do not|was not|wasn't) (?:say|saying|said|mean|meaning|ask|asking|asked|request|requesting|want|wanted)\\b[^.!?;]{0,100}|\\b(?:you|they|he|she|the tenant|my tenant|the owner|the agent|my wife|my husband) (?:said|say|wrote|asked)\\b[^.!?;]{0,100}|\\b(?:word|phrase|example)\\b[^.!?;]{0,60}|\\b(?:do not|don't|dont|never|not) )$",
 negatedIntroduction:"\\b(?:not|never|did not|didn't|don't|do not) (?:say|saying|mean|meaning|ask|asking|request|requesting)[ ,\"']*$",
 machine:"^(?:(?:hi|hello)[,.! ]+)?(?:you.{0,8}(?:have reached|ve reached)|(?:this is |welcome to ).{0,60}(?:voice[ -]?mail|mailbox|automated (?:system|assistant))|(?:please )?leave.{0,25}(?:message|name|number)|after.{0,12}(?:tone|beep)|(?:the person|the subscriber|the number|your call|the call|this number).{0,80}(?:not available|unavailable|forwarded|disconnected|not in service)|no se ha grabado nada[.! ]|no one is available|press [0-9]|comunicarte.{0,30}no est[aá] disponible|(?:buz[oó]n de voz|correo de voz)|(?:graba|grabe|deja|deje).{0,25}mensaje)",
};
const normalize=(body:string)=>body.toLowerCase().replace(/[’‘]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').trim();
export const sellerStandaloneStopPattern="(?:^|[.!?;] +)(?:please )?stop[.!;](?: +|$)";
export const sellerWithdrawalPattern="(?:^|[.!?;] +)(?:(?:ok(?:ay)?|yes)[, ]+)?(?:never mind|nevermind|forget it|go away|go to hell)(?: please)?[.! ,]*$";
/** Direct hostility/contact objections only. Profanity about repairs, a price
 * objection, or ordinary lawyer/title questions are not contact withdrawal. */
export const sellerHardStopPatterns={
 stop:String.raw`^(?:please )?(?:stop|stopall|unsubscribe|opt out|dnc)(?:[.!?,;]+(?: |$)| +(?=(?:who|what|why|how|your offer)\b))|\b(?:stop|quit) sending (?:me |us )?(?:any |more |any more )?(?:fucking |damn )?(?:texts?|messages?|emails?)\b`,
 hostile:String.raw`\b(?:fuck (?:you|off)|go fuck yourself|shut (?:the (?:fuck|hell) )?up|go (?:the fuck )?away|go to hell|(?:stop|quit) (?:fucking|damn) (?:calling|texting|contacting|bothering|harassing)(?: me| us)?|(?:are you|you are|you're|youre|you) (?:a |an )?(?:fucking |goddamn )(?:idiot|moron)|(?:you are|you're|youre|you) (?:a |an )?(?:fucking |goddamn )?(?:asshole|assholes|bastard|bastards|motherfucker|motherfuckers|piece of shit))\b`,
 legal:String.raw`\b(?:(?:i|we) (?:will|'ll|am going to|are going to|am gonna|are gonna) (?:sue you|sue your (?:company|business)|take legal action against you|report (?:you|your (?:company|business)) to (?:the )?(?:police|fcc|ftc|attorney general))|(?:i'm|we're|im|were) (?:going to|gonna) (?:sue you|report (?:you|your (?:company|business)) to (?:the )?(?:police|fcc|ftc|attorney general))|(?:i'll|we'll) (?:sue you|report (?:you|your (?:company|business)) to (?:the )?(?:police|fcc|ftc|attorney general))|(?:i|we) (?:have )?(?:already )?reported (?:you|your (?:company|business)) to (?:the )?(?:police|fcc|ftc|attorney general)|this is harassment|(?:this|your) (?:call|text|contact|calling|texting) (?:is|constitutes) (?:illegal|harassment)|(?:you are|you're|youre) (?:harassing me|violating (?:the )?(?:do not call|dnc|tcpa))|(?:my|our) (?:lawyer|attorney) (?:will|is going to) (?:sue you|contact you about (?:these|your) (?:calls|texts)))\b`,
 dnc:String.raw`\b(?:(?:i am|i'm|im|we are|we're|were|my (?:phone )?number is|this (?:phone )?number is) (?:already )?on (?:the |your |a |the national |the federal )?(?:dnc|do[ -]not[ -]call)(?: (?:list|registry))?|(?:put|place|add) (?:me|us|my (?:phone )?number|this (?:phone )?number) (?:on|in) (?:the |your |a )?(?:do[ -]not[ -]call|dnc)(?: (?:list|registry))?)\b`,
 strong:String.raw`\b(?:(?:i|we)(?:'ve)? (?:(?:have|already) ){0,2}told (?:you|yall|y'all|you all) no|(?:i|we) (?:will never|would never|am never going to|are never going to) sell|(?:i'm|we're|im|were) never (?:going to sell|selling)|(?:absolutely|definitely|completely) not interested(?: in selling)?|not (?:at all|remotely|even slightly|fucking) interested(?: in selling)?|not interested (?:at all|whatsoever)|(?:i|we) have (?:absolutely )?(?:zero|no) interest in selling|(?:zero|no) fucking interest(?: in selling)?)\b(?! in (?!selling\b))(?![^.!?;]*(?:\b(?:unless|if|until|when|price|offer|amount|(?:for|at) (?:that|this|[0-9]))\b|\$))`,
};
export const sellerHardStopNonRequestPattern=String.raw`(?:\b(?:won't|wont|will not|wouldn't|wouldnt|would not|can't|cannot) (?:say|tell|use|repeat)\b[^.!?;]{0,100}|\b(?:my|our|the|a) (?:seller|buyer|lawyer|attorney|tenant|agent|friend) (?:said|says|wrote|asked)\b[^.!?;]{0,100}|\b(?:what does|what do you mean by|meaning of|definition of) ["']?)$`;
function directMatch(body:string,pattern:string,unquotedOnly=false){
 for(const match of body.matchAll(new RegExp(pattern,'g'))){
  // Hard-stop phrases inside a reported quotation remain reported, even when
  // ASR punctuation splits the quotation into multiple sentences.
  if(unquotedOnly&&(body.slice(0,match.index).match(/"/g)?.length??0)%2===1)continue;
  const sentence=body.slice(0,match.index).split(/[.!?;]|\bbut\b/).at(-1)??'';
  // A reported quote stays in its reporting clause; a fresh demand after a comma does not.
  const quoted=(sentence.match(/"/g)?.length??0)%2===1;
  const prefix=quoted?sentence:sentence.split(',').at(-1)??'';
  if(unquotedOnly&&new RegExp(sellerHardStopNonRequestPattern).test(sentence))continue;
  if(!new RegExp(sellerResponsePatterns.nonRequest).test(prefix)&&!new RegExp(sellerResponsePatterns.negatedIntroduction).test(sentence))return true;
 }
 return false;
}
export function sellerResponseDisposition(source:string):SellerResponseDisposition{
 const body=normalize(source);
 if(Object.values(sellerHardStopPatterns).some(pattern=>directMatch(body,pattern,true)))return 'opt_out';
 if(directMatch(body,sellerResponsePatterns.optOut)||directMatch(body,sellerStandaloneStopPattern))return 'opt_out';
 if(directMatch(body,sellerWithdrawalPattern))return 'declined';
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
 if(words.some(t=>!isAutomatedCallMenu(t)&&sellerResponseDisposition(t)==='opt_out'))return 'opt_out';
 if(!words.some(t=>/[a-z0-9]/i.test(t)))return null;
 let disposition:SellerResponseDisposition=null,lastAgent='';
 for(const turn of transcript){
  if(turn.role==='agent'){lastAgent=turn.message??'';continue;}
  if(turn.role!=='user'||typeof turn.message!=='string')continue;
  if(isAutomatedCallMenu(turn.message)||new RegExp(sellerResponsePatterns.machine,'i').test(turn.message.trim())){lastAgent='';continue;}
  let current=sellerResponseDisposition(turn.message);
  const answerDisposition=sellerCallAnswerDisposition(lastAgent,turn.message);
  // A polite no to repairs or a call invitation is not a refusal to sell.
  if(current==='declined'&&lastAgent.trim()&&new RegExp(sellerCallAnswerPatterns.politeNegative).test(normalize(turn.message)))current=answerDisposition;
  if(!current)current=answerDisposition;
  if(current==='opt_out')return current;
  if(current==='declined'||!disposition)disposition=current;
  lastAgent='';
 }
 return disposition;
}
