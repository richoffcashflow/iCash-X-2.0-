import {object} from './required-call-recording.ts';
import {sellerResponseDisposition,sellerResponsePatterns} from './seller-response-policy.ts';
import {isAutomatedCallMenu} from './automated-call-menu.ts';
import {sellerQuestion} from './seller-question-evidence.ts';

export type SellerSourceHold={kind:'opt_out'|'human_requested'|'review';sourceId:string;quote:string};

/** A new material fact cannot be resolved by repeating generic qualification.
 * Baseline debt/condition answers stay in their ordinary calculation paths. */
export function sellerMaterialSourceReview(source:string){
 const text=source.replace(/[’‘]/g,"'").replace(/[“”]/g,'"');
 const changes=/\b(?:(?:i|we)(?:'ve| have)? (?:already )?sold (?:it|this|that|(?:my|our|the|this|that) (?:house|home|property))|(?:the |my |our |this )?(?:house|home|property) (?:is|was|has been) (?:already )?sold|(?:i|we) (?:have|took out|got|added) (?:another|a new|an additional|a second) (?:mortgage|loan|lien)|(?:the |my |our |this )?(?:house|home|property|roof|foundation) (?:now )?(?:has|suffered|sustained) (?:new |major |severe )?(?:fire|flood|foundation|structural) damage|(?:the |my |our |this )?(?:house|home|property) (?:burned|burnt) down|(?:ownership|the owner|the owners) (?:has |have )?changed|(?:i|we) (?:have|added) (?:another|a new|an additional) (?:owner|co-owner))\b/gi;
 for(const match of text.matchAll(changes)){
  const prefix=text.slice(0,match.index).split(/[.!?;]|\bbut\b/i).at(-1)??'';
  const suffix=text.slice(match.index+match[0].length).match(/^[^.!?;]*[.!?;]?/)?.[0]??'';
  if((prefix.match(/"/g)?.length??0)%2===1||/\b(?:if|suppose|supposing|imagine|hypothetically)\b[^.!?;]*$/i.test(prefix)
   // An echo question is uncertain; an actual declaration followed by a
   // procedural question still reports the change, with or without a comma.
   ||/^\s*\?$/.test(suffix)||new RegExp(sellerResponsePatterns.nonRequest,'i').test(prefix)||new RegExp(sellerResponsePatterns.negatedIntroduction,'i').test(prefix))continue;
  return true;
 }
 return false;
}

/** A request for a person is different from asking whether this is a person,
 * quoting somebody else, a negated request, or an automated menu option. */
export function sellerRequestsHuman(source:string){
 if(isAutomatedCallMenu(source)||new RegExp(sellerResponsePatterns.machine,'i').test(source.trim()))return false;
 const text=source.replace(/[’‘]/g,"'").replace(/[“”]/g,'"');
 const request=/\b(?:(?:i|we)(?: (?:want|need|request|would like|prefer)|'d (?:like|prefer)) (?:to (?:speak|talk) (?:to|with) )?(?:(?:a|an|the|your|real|live|actual) )*(?:human|person|someone|somebody|manager|owner|supervisor|representative)|(?:can|could|may) (?:i|we) (?:speak|talk) (?:to|with) (?:(?:a|an|the|your|real|live|actual) )*(?:human|person|someone|somebody|manager|owner|supervisor|representative)|(?:please )?(?:let me|have me|connect me|transfer me) (?:speak to |talk to |to )(?:(?:a|an|the|your|real|live|actual) )*(?:human|person|someone|somebody|manager|owner|supervisor|representative))\b/gi;
 for(const match of text.matchAll(request)){
  const prefix=text.slice(0,match.index).split(/[.!?;]|\bbut\b/i).at(-1)??'';
  if((prefix.match(/"/g)?.length??0)%2===1||/\b(?:if|suppose|supposing|imagine|hypothetically)\b[^.!?;]*$/i.test(prefix)||/\b(?:not|never|didn't|did not|don't|do not) (?:say|mean|ask|want|need|request)(?:ing|ed)?\b[^.!?;]*$/i.test(prefix)
   ||/\b(?:he|she|they|you|my (?:wife|husband|tenant)|the (?:owner|agent)) (?:said|asked|wrote)\b[^.!?;]*$/i.test(prefix))continue;
  return true;
 }
 return false;
}

/** These source-backed holds require their existing explicit resolution path.
 * A generic later yes or recomputed qualification cannot silently resolve one. */
export function sellerPersistentSourceHold(conversations:unknown[]):SellerSourceHold|null{
 let hold:SellerSourceHold|null=null;
 for(const value of conversations){
  const conversation=object(value);if(!Array.isArray(conversation.transcript))continue;
  let question='';
  for(const raw of conversation.transcript){
   const row=object(raw);if(typeof row.message!=='string')continue;
   if(row.role==='agent'){question=sellerQuestion(row.message);continue;}if(row.role!=='user')continue;
   const quote=row.message;
   if(isAutomatedCallMenu(quote)||new RegExp(sellerResponsePatterns.machine,'i').test(quote.trim())){question='';continue;}
   const disposition=sellerResponseDisposition(quote);
   const availability=/\b(?:good time|time to (?:talk|chat)|have (?:a )?minute)\b/i.test(question)&&/^(?:no[, ]+)?(?:not now|not a good time|busy right now)[.! ]*$/i.test(quote.trim());
   const kind=disposition==='opt_out'?'opt_out':sellerRequestsHuman(quote)?'human_requested':sellerMaterialSourceReview(quote)||disposition==='review'&&!availability?'review':null;
   if(kind){const current={kind,quote,sourceId:String(row.sourceId??conversation.sourceId??'')} as SellerSourceHold;if(kind==='opt_out')return current;hold??=current;}
   question='';
  }
 }
 return hold;
}
