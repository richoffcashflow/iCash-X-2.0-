import type {SupportContext,SupportReply} from './support-conversation.ts';
/** Geography questions are not import requests or evidence of missing outreach. */
export function supportLocationGuidance(context:SupportContext):SupportReply|null{
 const q=context.messages.filter(t=>t.role==='user').at(-1)?.content??'';
 if(/\b(?:refund|cancel|payment|charged|sign[ -]?in|upload|import|contract|buyer|phone number|off[ -]the[ -]market|off[ -]market)\b/i.test(q))return null;
 // A city mentioned inside an activity complaint is not a separate location
 // request. Only independent location clauses may be removed for composition.
 if(/\b(?:not (?:working|calling|texting|doing|running)|no (?:calls|texts)|stalled|blocked|missing activity)\b/i.test(q))return null;
 const searchLocation=/\b(?:search|target)(?:ing)? (?:locations?|areas?|markets?)\b/i.test(q)&&/\b(?:how|where|choose|select|set|change)\b/i.test(q);
 if(!/\bleads?\b/i.test(q)&&!searchLocation)return null;
 const origin=/\bleads?\b[^.!?]{0,30}\b(?:coming|come) (?:out of|from)\s+[a-z]/i.test(q);
 const geography=/\b(?:cities|city|states?|zip codes?|markets?|locations?|any ?where else)\b/i.test(q)&&/\b(?:why|where|choose|select|change|getting|find|get)\b/i.test(q);
 const request=/^(?:please )?(?:get|find|search for)(?: me)? leads? in [a-z .'-]+[.!?\s]*$/i.test(q.trim());
 if(!origin&&!geography&&!request&&!searchLocation)return null;
 return {reply:'The bot selects markets automatically. The workspace has no city, state or ZIP-code selector, and this chat has not changed your search area. Leads appearing in one area do not establish why other areas are missing; that needs a check of the saved search settings and property records.',status:'open',ai:false};
}

/** Split only explicit current-turn questions. Never inherit a location from
 * older customer or operator turns, or strip a complaint inside one clause. */
export function supportLocationParts(context:SupportContext){
 const q=context.messages.findLast(t=>t.role==='user')?.content??'';
 const clauses=q.replace(/^\s*\d+[.)]\s+/gm,'').split(/(?<=[?!;])\s*|\n+|(?<=\.)\s+(?=[A-Z])|\s+and\s+(?=how (?:do|can) i (?:choose|select|set|change))/i)
  .map(s=>s.replace(/^\s*also[,\s]+/i,'').trim()).filter(Boolean);
 const locationClauses=clauses.filter(content=>supportLocationGuidance({...context,messages:[{role:'user',content}]}));
 if(!locationClauses.length)return null;
 const answer=supportLocationGuidance({...context,messages:[{role:'user',content:locationClauses[0]}]})!;
 return {answer,remaining:clauses.filter(s=>!locationClauses.includes(s)).join(' ')};
}
