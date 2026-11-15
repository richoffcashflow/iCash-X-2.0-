import type {SupportContext,SupportReply} from './support-conversation.ts';

/** Explain only the reported review label; never infer a seller action or repair. */
export function supportReviewScreenReply(context:SupportContext):SupportReply|null{
 const latest=context.messages.filter(m=>m.role==='user').at(-1)?.content.trim()??'';
 const answer=(reply:string):SupportReply=>({reply,status:'open',ai:false});
 if(/\b(?:refund|cancel|charged|payment|subscription|sign.?in|log.?in)\b/i.test(latest))return null;
 if(/^(?:am i the only (?:one|person|customer|user) (?:experiencing|having|with) (?:this|this issue|this problem)|(?:are|is) (?:other customers|anyone else) (?:having|experiencing) (?:this|this issue|this problem))[?.!\s]*$/i.test(latest))return answer('I don’t have a verified count of customers with the same underlying problem. I can’t say that you are the only one or that everyone is affected. Your reported issue remains open; this does not confirm a repair or completion time.');
 const label=/\breview next step\b/i;
 const empty=/\b(?:empty|blank|nothing (?:there|shows|appears)|nothing)\b/i;
 const excluded=/\b(?:works? now|working now|fixed|shows? (?:the |all )?(?:details|tasks)|do not have|don[’']t have|not empty|not blank|what if|if .*were|my friend|another customer)\b/i;
 const short=/^(?:(?:there(?: is|’s|'s)|it(?: is|’s|'s)) (?:still )?nothing(?: there)?|still (?:empty|blank))[.!\s]*$/i.test(latest);
 let issue=latest;
 if(short){
  // Only the nearest substantive user turn can supply a label. An operator
  // finding ends inheritance, so later corrections cannot be overwritten.
  const prior=context.messages.slice(0,-1);
  const boundary=prior.findLastIndex(m=>m.role==='operator');
  issue=prior.slice(boundary+1).findLast(m=>m.role==='user'&&!/^(?:there is nothing(?: there)?|still (?:empty|blank))[.!\s]*$/i.test(m.content.trim()))?.content??'';
 }
 if(!label.test(issue)||!empty.test(issue)||excluded.test(issue))return null;
 return answer('“Review next step” can flag a blocked workflow; it does not necessarily mean there is a seller message or a task you can complete. You have reported an empty screen, so you do not need to repeat the same screen checks. The cause still needs review; this chat has not cleared the alert, restarted work or confirmed a repair.');
}
