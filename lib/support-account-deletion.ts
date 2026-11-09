import type {SupportContext} from './support-conversation.ts';

const request=/\b(?:delete|remove|erase) (?:my|the|this) (?:icash(?: x)? )?account\b(?! (?:number|details|photo|name|email))|\b(?:my|this) account (?:to be )?(?:deleted|removed|erased)\b|\b(?:request|want|need) (?:my )?account deletion\b/i;
const withdrawn=/\b(?:don[’']?t|do not|never|no longer) (?:want |need |wish |intend |plan )?(?:to )?(?:delete|remove|erase|(?:my|this) account)|\b(?:stop|cancel|withdraw) (?:my |the )?(?:account )?deletion (?:request|process)\b/i;
const hypothetical=/\b(?:what if|hypothetically|if i (?:were to|wanted to)|would (?:canceling|cancelling|cancellation))\b/i;
const followup=/^(?:thanks|thank you|okay|ok|any update|anything yet|what happens now|how long(?: will (?:it|this) take)?|i (?:already )?(?:gave|sent|provided) you (?:my |the |all (?:my |the )?)?(?:details|information|email)|i gave you all the info i have|i (?:can[’']?t|cannot) (?:sign in|log in|(?:get to|access|open) (?:the |my )?(?:account )?menu))[.!?\s]*$/i;

/** A request is review intent, never authority to delete or change an account. */
export function supportAccountDeletionGuidance(context:SupportContext):string|null{
 const users=context.messages.filter(m=>m.role==='user');
 const question=users.at(-1)?.content??'';
 if(withdrawn.test(question)||hypothetical.test(question))return null;
 // A short continuation belongs only to the latest substantive user subject.
 const subject=followup.test(question.trim())?users.slice(-7,-1).reverse().find(m=>!followup.test(m.content.trim()))?.content??'':question;
 if(!request.test(subject)||withdrawn.test(subject)||hypothetical.test(subject))return null;
 const operator=context.messages.findLast(m=>m.role==='operator')?.content??'';
 const recorded=/account (?:deletion|itself)|deletion request/i.test(operator)&&/not (?:been )?deleted|unresolved|remains? open|for review/i.test(operator);
 const opening=recorded?'The earlier operator update recorded account deletion as unresolved.':'You’re asking for account deletion, which is separate from stopping subscription renewals.';
 return opening+' I haven’t confirmed that the account has been deleted. Deletion requires identity and record checks; the details you already supplied remain in this conversation, so you don’t need to resend them here. This chat has not changed your account or billing.';
}
