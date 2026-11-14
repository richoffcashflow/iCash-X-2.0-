import type {SupportContext,SupportReply} from './support-conversation.ts';

/** Current contact questions are distinct from takeover controls and activity
 * totals. Product guidance cannot verify a specific sender or delivery fault. */
export function supportContactPrivacyReply(context:SupportContext):SupportReply|null{
 const q=context.messages.findLast(m=>m.role==='user')?.content??'';
 if(/\b(?:refund|cancel|charged|payment|subscription|sign[ -]?in|login|code)\b/i.test(q))return null;
 const ownNumber=/\b(?:my|our) (?:own |personal |private )?(?:phone(?: number)?|number)\b/i.test(q);
 const contact=/\b(?:take ?over|calls?|calling|texts?|texting|messag\w*|seller|owner)\b/i.test(q);
 const privacyQuestion=/\b(?:will|would|can|could|does|do)\b/i.test(q)&&/\b(?:see|show|appear|display|reveal|expose|visible)\b/i.test(q);
 // A reported exposure needs investigation; do not substitute a general promise.
 const exposure=/\b(?:already|saw|showed|revealed|exposed|did see|has seen)\b/i.test(q);
 if(ownNumber&&contact&&privacyQuestion&&!exposure)return {reply:'Take over alone does not call or text anyone or show your personal number. Calls and texts sent through the property’s iCash X controls use a service-connected business number. Calling or texting outside iCash X from your own phone can show that phone’s number. These checks do not identify the exact sender used for a particular conversation.',status:'open',ai:false};
 if(/\bland[ -]?line\b/i.test(q)&&/\b(?:text\w*|sms|messag\w*)\b/i.test(q)&&/\b(?:why|because|could|is it|not|fail\w*|unable|cannot|can[’']?t)\b/i.test(q)&&!/\b(?:not a land[ -]?line|no longer|working now|delivered now)\b/i.test(q))return {reply:'A landline label alone does not establish why a text failed. The selected contact’s texting eligibility and the saved sending or delivery result need to be checked; account-wide call and text totals cannot identify that cause. Which property and error or delivery status do you see?',status:'open',ai:false};
 return null;
}
