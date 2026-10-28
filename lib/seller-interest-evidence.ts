import {sellerCallDisposition} from './seller-response-policy.ts';
import {hasHumanCallWords} from './call-contact-evidence.ts';

// Deliberately narrow source evidence. Ownership, permission to talk, price
// questions, model summaries and a conditional/maybe answer are not interest.
export const sellerInterestPatterns={
 affirmative:"^(yes|yeah|yep|sure|interested|i am interested|i'm interested|yes i am|yes,? i am interested|yes,? interested)[.! ,]*$",
 explicit:"^((i am|i'm|we are|we're) (interested in|open to) selling|(i|we) (want|would like) to sell)( (my|our|the) (house|home|property))?[.! ]*$",
 question:"(would you (be (interested in|open to)|consider)|are you (interested in|open to)|do you want to) (sell(ing)?|a cash offer)",
 ambiguousQuestion:"\\b(owner|own|hearing|hear|discuss|talk|information|send|permission|not|never|if|unless|maybe|learn|learning)\\b",
};
const normalize=(s:string)=>s.toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
export function sellerInterestQuote(transcript:{role:string;message?:string|null}[]):string|null{
 const turns=transcript.filter((t):t is {role:string;message:string}=>typeof t.message==='string');
 if(sellerCallDisposition(turns)!==null)return null;
 let question='',evidence:string|null=null;
 for(const turn of turns){
  if(turn.role==='agent'){question=normalize(turn.message);continue;}
  if(turn.role!=='user'){question='';continue;}
  const body=normalize(turn.message);
  if(hasHumanCallWords(turn.message)&&(
   new RegExp(sellerInterestPatterns.explicit).test(body)||
   (new RegExp(sellerInterestPatterns.affirmative).test(body)&&new RegExp(sellerInterestPatterns.question).test(question)
    &&question.endsWith('?')&&(question.match(/\?/g)?.length??0)===1&&!new RegExp(sellerInterestPatterns.ambiguousQuestion).test(question))
  ))evidence=turn.message;
  question='';
 }
 return evidence;
}
