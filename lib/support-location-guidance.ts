import type {SupportContext,SupportReply} from './support-conversation.ts';
/** Geography questions are not import requests or evidence of missing outreach. */
export function supportLocationGuidance(context:SupportContext):SupportReply|null{
 const q=context.messages.filter(t=>t.role==='user').at(-1)?.content??'';
 if(/\b(?:refund|cancel|payment|charged|sign[ -]?in|upload|import|contract|buyer|phone number)\b/i.test(q))return null;
 if(!/\bleads?\b/i.test(q))return null;
 const origin=/\b(?:coming|come) (?:out of|from)\b/i.test(q);
 const geography=/\b(?:cities|city|states?|zip codes?|markets?|locations?|any ?where else)\b/i.test(q)&&/\b(?:why|where|choose|select|change|getting|find|get)\b/i.test(q);
 const request=/^(?:please )?(?:get|find|search for)(?: me)? leads? in [a-z .'-]+[.!?\s]*$/i.test(q.trim());
 if(!origin&&!geography&&!request)return null;
 return {reply:'The bot selects markets automatically. The workspace has no city, state or ZIP-code selector, and this chat has not changed your search area. Leads appearing in one area do not establish why other areas are missing; that needs a check of the saved search settings and property records.',status:'open',ai:false};
}
