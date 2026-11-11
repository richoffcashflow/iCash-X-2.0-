import type {SupportContext,SupportReply} from './support-conversation.ts';

/** A bare purchase-mismatch complaint is not a request for today's usage.
 * Match the entire current turn: concrete faults, billing requests, property
 * purchases and changed topics must retain their existing evidence routes. */
export function supportPurchaseMismatch(question:string):boolean{
 return /^(?:(?:this|that|it)(?: (?:software|service|app|product))? )?(?:is not|was not|isn[’']t|wasn[’']t|not) what i (?:paid for|bought|purchased)[.!\s]*$/i.test(question.trim());
}

export function supportPurchaseComplaintReply(context:SupportContext):SupportReply|null{
 const index=context.messages.findLastIndex(turn=>turn.role==='user');
 if(index<0||!supportPurchaseMismatch(context.messages[index].content))return null;
 // A human finding must not be replaced by generic clarification.
 if(context.messages[index-1]?.role==='operator')return {reply:'Your earlier details and the operator’s finding remain in this conversation. I haven’t confirmed that the purchase complaint is resolved.',status:'open',ai:false};
 return {reply:'I understand you’re reporting that the software did not match what you expected. Usage totals alone do not establish that the expected feature or service was delivered. Which feature or service was different, and what happened when you tried it?',status:'waiting_on_customer',ai:false};
}
