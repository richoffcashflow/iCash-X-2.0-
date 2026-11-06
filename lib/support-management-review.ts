import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportCodeDelivery} from './support-code-delivery.ts';
import {currentAccessConversation} from './support-access-topic.ts';

const generic = /^(?:I don[’']t have (?:enough information|a confirmed answer)|I haven[’']t confirmed the cause yet|There[’']s no confirmed change|I couldn[’']t verify your account details)/i;
const stuck = /\b(?:still|again|already|same (?:issue|problem)|did(?:n[’']t| not) (?:help|work)|not (?:working|getting)|no (?:replies|response|code)|not getting anywhere|going in circles|frustrated|upset|you keep|all day)\b/i;
const reviewRequest = /\b(?:live (?:help|support)|human (?:help|support)|(?:want|need|request|get) (?:a |an )?(?:(?:real|live|actual) )?(?:human|person|agent|representative|manager|supervisor)|(?:manager|management|supervisor)(?: to| for)? review|(?:request|need|want|please flag|asking for) (?:a )?management review|escalate (?:this|my|the) (?:issue|case|ticket|chat|problem))\b/i;
const transferRequest = /(?:^|\b(?:can i|could i|may i|let me|i (?:want|need|would like) to|please|can you|could you) )(?:(?:speak|talk|connect|transfer|escalate|reach)\b.{0,36})\b(?:someone|person|human|agent|representative|management|manager|supervisor|owner)\b/i;
const briefRequest = /^(?:human|agent|representative|manager|management|supervisor|escalate(?: this)?)[.!?\s]*$/i;
const genericHuman = /^This is automated support|^I can help troubleshoot this here\./i;

/** Only the server's reply finisher can persist this decision, together with the
 * customer-visible reply. Model output and customer instructions cannot set it. */
export function supportManagementReview(context:SupportContext, answer:SupportReply):SupportReply {
 const index=context.messages.findLastIndex(turn=>turn.role==='user');
 if(index<0)return answer;
 const question=context.messages[index].content;
 const previous=context.messages.slice(0,index).findLast(turn=>turn.role==='assistant'||turn.role==='operator');
 const partyQuestion=/\b(?:seller|buyer|homeowner|property owner|lead)\b/i.test(question)&&!/\b(?:support|supervisor|management|manager|ticket|escalate|representative)\b/i.test(question);
 const explicit=!partyQuestion&&(briefRequest.test(question.trim())||((reviewRequest.test(question)||transferRequest.test(question))&&!/(?:don[’']?t|do not|no need to) (?:want|need|escalate|speak|talk|transfer)/i.test(question)));
 const followup=stuck.test(question)||/^(?:i did|no|why|what now|i don[’']?t understand|what do you mean)[.!?\s]*$/i.test(question.trim());
 const missingCode=context.kind==='access'&&supportCodeDelivery(currentAccessConversation(context.messages))==='missing';
 const exhaustedAccess=missingCode&&answer.status==='open'&&!answer.reply.includes('?')&&!!previous;
 const proofAwaitingReview=answer.status==='open'&&/you[’']ve said you sent the receipt|purchase needs to be matched and ownership verified|earlier proof details are already/i.test(answer.reply);
 const recentReplies=context.messages.slice(0,index).filter(turn=>turn.role==='assistant'||turn.role==='operator').slice(-2);
 const repeatedDeadEnd=generic.test(answer.reply)&&recentReplies.length===2&&recentReplies.every(turn=>turn.role==='assistant'&&generic.test(turn.content));
 const failedAgain=previous?.role==='assistant'&&followup&&(
  generic.test(previous.content)&&generic.test(answer.reply)||
  (answer.status==='open'&&previous.content===answer.reply&&!answer.reply.includes('?'))
 );
 const paymentReview=/reporting a charge you don’t recognize|duplicate-charge report needs its own payment check|do both statement entries match|statement details you supplied are saved/i.test(answer.reply)&&!/\b(?:what if|hypothetically|if i (?:am|were)|could i be)\b/i.test(question);
 const needsReview=paymentReview||explicit||exhaustedAccess||proofAwaitingReview||failedAgain||repeatedDeadEnd;
 if(!needsReview)return answer;
 const note=context.handedOff?'Your case is still in management review.':'I’ve flagged this conversation for management review.';
 const genericReply=generic.test(answer.reply)||genericHuman.test(answer.reply)||/^Hi!|^Which page is this happening on\?/i.test(answer.reply);
 let detail=genericReply?'':answer.reply;
 if(explicit&&genericReply)detail='This is automated support, so there isn’t a live transfer.';
 if(missingCode&&genericReply)detail='Your sign-in code still hasn’t reached you. You don’t need to request another code or pay again.';
 if(context.handedOff&&previous?.content===answer.reply)detail='';
 return {...answer,reply:[detail,note].filter(Boolean).join(' '),status:'open',managementReview:true};
}
