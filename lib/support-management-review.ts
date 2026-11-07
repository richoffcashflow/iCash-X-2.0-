import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportCodeDelivery} from './support-code-delivery.ts';
import {currentAccessConversation} from './support-access-topic.ts';

const generic = /^(?:I don[’']t have (?:enough information|a confirmed answer)|I haven[’']t confirmed the cause yet|There[’']s no confirmed change|I couldn[’']t verify your account details)/i;
const stuck = /\b(?:still|again|already|same (?:issue|problem)|did(?:n[’']t| not) (?:help|work)|not (?:working|getting)|no (?:replies|response|code)|not getting anywhere|going in circles|frustrated|upset|you keep|all day)\b/i;
const reviewRequest = /\b(?:live (?:help|support)|human (?:help|support)|(?:want|need|request|get) (?:a |an )?(?:(?:real|live|actual) )?(?:human|person|agent|representative|manager|supervisor)|(?:manager|management|supervisor)(?: to| for)? review|(?:request|need|want|please flag|asking for) (?:a )?management review|escalate (?:this|my|the) (?:issue|case|ticket|chat|problem))\b/i;
const transferRequest = /(?:^|\b(?:can i|could i|may i|let me|i (?:want|need|would like) to|please|can you|could you) )(?:(?:speak|talk|connect|transfer|escalate|reach)\b.{0,36})\b(?:someone|person|human|agent|representative|management|manager|supervisor|owner)\b/i;
const briefRequest = /^(?:human|agent|representative|manager|management|supervisor|escalate(?: this)?)[.!?\s]*$/i;
const genericHuman = /^This is automated support|^I can help troubleshoot this here\./i;

function reviewExplanation(context:SupportContext,question:string){
 const history=context.messages.filter(turn=>turn.role==='user').slice(0,-1).map(turn=>turn.content).reverse();
 const issue=history.find(text=>! /^(?:why|for what|review|anything yet|any update|how long.*|will i be contacted)[?!.\s]*$/i.test(text.trim())&&/\b(?:code|sign[ -]?in|receipt|access|not working|down|nothing today|no leads|no calls|no texts|delayed|restart time|no response|not getting|credit|charged|payment|contract|agreement)\b/i.test(text)&&/\b(?:no|not|never|missing|wrong|duplicate|unrecognized|error|failed|blocked|stuck|issue|problem|down|delayed|unconfirmed|nothing today|can[’']?t|cannot|didn[’']?t|doesn[’']?t|haven[’']?t)\b/i.test(text))??'';
 const reason=/\b(?:sign[ -]?in|receipt|access)\b|\b(?:no|missing) code\b/i.test(issue)?'The review concerns your unresolved purchase or sign-in access.':/\b(?:nothing today|no leads|no calls|no texts|delayed|restart time|not working|down)\b/i.test(issue)?'The review concerns your report that the bot’s work is delayed or missing.':/\b(?:charged|payment|credit)\b/i.test(issue)?'The review concerns the payment or credit issue you reported.':/\b(?:contract|agreement)\b/i.test(issue)?'The review concerns the agreement issue you reported.':'The review concerns the unresolved issue you reported earlier in this conversation.';
 const next=/\b(?:contacted|call me|email me|reply|respond)\b/i.test(question)?'Management can reply in this conversation; I can’t promise a phone call or response time.':'I don’t have a confirmed fix or completion time. You can check for updates in this conversation.';
 return reason+' '+next;
}

/** Only the server's reply finisher can persist this decision, together with the
 * customer-visible reply. Model output and customer instructions cannot set it. */
export function supportManagementReview(context:SupportContext, answer:SupportReply):SupportReply {
 const index=context.messages.findLastIndex(turn=>turn.role==='user');
 if(index<0)return answer;
 if(context.handedOff&&answer.status==='closed'){
  return {reply:'The refund policy still applies. Your case is still in management review, and your earlier details are saved here.',status:'open',managementReview:true,ai:false};
 }
 const question=context.messages[index].content;
 const previous=context.messages.slice(0,index).findLast(turn=>turn.role==='assistant'||turn.role==='operator');
 const reviewFollowup=/management review|flagged this conversation/i.test(previous?.content??'')||/\b(?:management|review|any update|anything yet)\b/i.test(question);
 if(context.handedOff&&reviewFollowup&&/^(?:for what|why|review|what (?:is|does) (?:the |management )?review(?: mean)?|why (?:is|was) (?:it|this|my case) (?:in |under )?review|anything yet|any update|how long(?: will (?:it|this) take)?|will i be contacted|will (?:someone|management) (?:reply|respond|contact me)|what happens now)[.!?\s]*$/i.test(question.trim())){
  return {reply:reviewExplanation(context,question)+' Your case is still in management review.',status:'open',managementReview:true,ai:false};
 }
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
 const genericReply=generic.test(answer.reply)||genericHuman.test(answer.reply)||/^Hi!|^Which page is this happening on\?/i.test(answer.reply);
 const needsReview=answer.managementReview===true||paymentReview||explicit||exhaustedAccess||proofAwaitingReview||failedAgain||repeatedDeadEnd||context.handedOff&&genericReply;
 if(!needsReview)return answer;
 const note=context.handedOff?'Your case is still in management review.':'I’ve flagged this conversation for management review.';
 let detail=genericReply?'':answer.reply;
 if(explicit&&genericReply)detail='This is automated support, so there isn’t a live transfer.';
 if(missingCode&&genericReply)detail='Your sign-in code still hasn’t reached you. You don’t need to request another code or pay again.';
 if(context.handedOff&&previous?.content===answer.reply)detail='';
 if(context.handedOff&&!detail)detail=reviewExplanation(context,question);
 return {...answer,reply:[detail,note].filter(Boolean).join(' '),status:'open',managementReview:true};
}
