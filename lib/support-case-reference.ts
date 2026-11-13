import type {SupportContext,SupportReply} from './support-conversation.ts';

/** Only a server-bound conversation reference is a reference, never a number
 * copied from a customer, earlier model answer or unrelated operator finding. */
export function supportCaseReference(context:SupportContext):SupportReply|null{
 if(!context.handedOff)return null;
 const question=context.messages.findLast(turn=>turn.role==='user')?.content??'';
 if(/\b(?:seller|buyer|property|refund|money back|cancel|cancelling|canceling|duplicate charge|charged twice|receipt|don[’']t|do not|no need)\b/i.test(question))return null;
 const reference=/\b(?:support ticket|case|conversation) (?:reference )?(?:number|id|reference)\b/i.test(question);
 const email=/\b(?:support|technical support|manager|management)\b/i.test(question)&&/\bemail(?: address)?\b/i.test(question)&&/\b(?:contact|direct|provide|what|where)\b/i.test(question);
 if(!reference&&!email)return null;
 const id=context.conversationReference;
 const verified=typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
 const identity=verified?`Your conversation reference is ${id}. It identifies this conversation, not a separate ticket.`:'I cannot verify a separate ticket or conversation reference from these checks.';
 return {reply:identity+' You can email support@geticashx.com; it is the support inbox, not a direct line to a named person. Your case remains in management review. I cannot verify a named human assignee or promise a date for your next update.',status:'open',managementReview:true,ai:false};
}
