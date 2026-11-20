import {supportMarketSelectionAnswer} from './support-product-guide.ts';
import type {SupportContext,SupportReply} from './support-conversation.ts';
/** Geography questions are not import requests or evidence of missing outreach. */
export function supportLocationGuidance(context:SupportContext):SupportReply|null{
 const q=context.messages.filter(t=>t.role==='user').at(-1)?.content??'';
 if(/\b(?:refund|cancel|payment|charged|sign[ -]?in|upload|import|contract|buyer|phone number|off[ -]the[ -]market|off[ -]market)\b/i.test(q))return null;
 // A city mentioned inside an activity complaint is not a separate location
 // request. Only independent location clauses may be removed for composition.
 if(/\b(?:not (?:working|calling|texting|doing|running)|no (?:calls|texts)|stalled|blocked|missing activity)\b/i.test(q))return null;
 const searchLocation=/\b(?:search|target)(?:ing)? (?:locations?|areas?|markets?)\b/i.test(q)&&/\b(?:how|where|choose|select|set|change)\b/i.test(q);
 const focusRequest=/^(?:please |i (?:want|need) (?:you|the bot) to )?(?:only )?focus(?: my bot| the bot)? (?:only )?on (?:cities|states|markets)(?: like| such as| in)?\b/i.test(q.trim());
 const dealSearchLocation=/\b(?:cities|city|states?|markets?)\b/i.test(q)&&/\b(?:look|search|find)(?:ing)?(?: for)? deals?\b/i.test(q)&&/\b(?:want|would like|how)\b/i.test(q)&&!/\b(?:seller|do not|don[’']?t|no longer)\b/i.test(q);
 const propertySearch=!/\bseller\b/i.test(q)&&/\b(?:propert(?:y|ies)|houses?|homes?)\b/i.test(q)&&/\bsearch(?:es|ing)?\b/i.test(q)&&/\b(?:choose|select|set|change|prioriti[sz]e)\b/i.test(q)&&!/^(?:please )?(?:do not|don[’']t|i (?:do not|don[’']t) want to)\b/i.test(q.trim());
 const nationwidePriority=/\b(?:can|how)\b/i.test(q)&&/\bprioriti[sz]e\b/i.test(q)&&/\bsearch(?:es|ing)? nationwide\b/i.test(q)&&!/\bseller\b/i.test(q);
 if(!/\bleads?\b/i.test(q)&&!searchLocation&&!focusRequest&&!dealSearchLocation&&!propertySearch&&!nationwidePriority)return null;
 const origin=/\bleads?\b[^.!?]{0,30}\b(?:coming|come) (?:out of|from)\s+[a-z]/i.test(q);
 const geography=/\b(?:cities|city|states?|zip codes?|markets?|locations?|any ?where else)\b/i.test(q)&&/\b(?:why|where|choose|select|change|getting|find|get)\b/i.test(q);
 const request=/^(?:please )?(?:get|find|search for)(?: me)? leads? in [a-z .'-]+[.!?\s]*$/i.test(q.trim());
 if(!origin&&!geography&&!request&&!searchLocation&&!focusRequest&&!dealSearchLocation&&!nationwidePriority)return null;
 return {reply:'The bot selects markets automatically. The workspace has no city, state or ZIP-code selector, and this chat has not changed your search area. Leads appearing in one area do not establish why other areas are missing; that needs a check of the saved search settings and property records.',status:'open',ai:false};
}

const otherWorkspace=/^(?:is there|do i have|can i (?:switch to|use)) (?:another|a different|a second) workspace[?!.\s]*$/i;
const anotherSignup=/^(?:can|could|may|should) i (?:sign up for|create|open) (?:another|a different|a second) (?:one|workspace|account)[?!.\s]*$/i;
const signupForMarket=/^(?:can|could|may|should) i (?:sign up for|create|open) (?:another|a different|a second) (?:workspace|account) to (?:choose|pick|target|select) (?:a |my |another |a different )?(?:state|city|market)[?!.\s]*$/i;

/** A short workspace or signup question inherits market selection only from
 * the adjacent customer topic. An operator or another subject ends the link. */
function workspaceMarketFollowup(context:SupportContext):SupportReply|null{
 const index=context.messages.findLastIndex(turn=>turn.role==='user');
 const question=context.messages[index]?.content.trim()??'';
 const explicitMarketSignup=signupForMarket.test(question);
 const signup=explicitMarketSignup||anotherSignup.test(question);
 if(!signup&&!otherWorkspace.test(question))return null;
 const prior=context.messages.slice(0,index);
 const sinceOperator=prior.slice(prior.findLastIndex(turn=>turn.role==='operator')+1);
 const topics=sinceOperator.filter(turn=>turn.role==='user');
 // A signup question can also refer to the immediately preceding question
 // about another workspace. Earlier assistant guesses are not access evidence.
 const anchor=signup&&otherWorkspace.test(topics.at(-1)?.content.trim()??'')?topics.at(-2):topics.at(-1);
 if(!explicitMarketSignup){
  if(!anchor)return null;
  const curatedLocation=supportLocationGuidance({...context,messages:[anchor]})??supportMarketSelectionAnswer(anchor.content);
  if(!curatedLocation)return null;
 }
 const reply=signup
  ?'I can’t confirm whether you can open a second workspace. I wouldn’t sign up again just to choose a market. The bot selects markets automatically.'
  :'I can’t see which other workspaces you have access to. If you’re looking for a way to choose where the bot searches, the bot selects markets automatically.';
 return {reply,status:'open',ai:false};
}

/** Split only explicit current-turn questions. Never split a location out of
 * older customer or operator turns, or strip a complaint inside one clause. */
export function supportLocationParts(context:SupportContext){
 const followup=workspaceMarketFollowup(context);
 if(followup)return {answer:followup,remaining:''};
 const q=context.messages.findLast(t=>t.role==='user')?.content??'';
 const clauses=q.replace(/^\s*\d+[.)]\s+/gm,'').split(/(?<=[?!;])\s*|\n+|(?<=\.)\s+(?=[A-Z])|\s+and\s+(?=(?:how|where|why|what|can)\b)/i)
  .map(s=>s.replace(/^\s*also[,\s]+/i,'').trim()).filter(Boolean);
 const locationClauses=clauses.filter(content=>supportLocationGuidance({...context,messages:[{role:'user',content}]}));
 if(!locationClauses.length)return null;
 const answer=supportLocationGuidance({...context,messages:[{role:'user',content:locationClauses[0]}]})!;
 // These current-turn statements qualify an explicit search question; they
 // are not requests to set up voice or evidence that an older fault is fixed.
 // Keep every actual secondary question/fault for the existing composition.
 const contextOnly=(s:string)=>/^(?:(?:i (?:am not|not) asking about|keep) (?:my|the|[a-z]+[’']s) (?:cloned |custom )?voice(?: unchanged)?|(?:my|the|[a-z]+[’']s) (?:cloned |custom )?voice is (?:already )?working|that is already working|i want to change (?:the |my |[a-z]+[’']s )?(?:real estate )?property search settings|please answer yes or no(?: and tell me (?:exactly )?where (?:the|those) settings are(?: located(?: in iCash X)?)?)?)[.!\s]*$/i.test(s);
 return {answer,remaining:clauses.filter(s=>!locationClauses.includes(s)&&!contextOnly(s)).join(' ')};
}
