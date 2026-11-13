import type {SupportContext,SupportReply} from './support-conversation.ts';
import {supportCodeDelivery} from './support-code-delivery.ts';
import {currentAccessConversation} from './support-access-topic.ts';
import {supportRepeatedFailedSteps} from './support-learning-signals.ts';
import {supportAccountDeletionGuidance} from './support-account-deletion.ts';
import {supportAnswer,supportRenewalCancellationRequested} from './support-policy.ts';
import {supportMissingActivityConcern} from './support-account-review.ts';
import {supportActivityConfirmation} from './support-activity-confirmation.ts';
import {supportCaseReference} from './support-case-reference.ts';

const generic = /^(?:I don[’']t have (?:enough information|a confirmed answer)|I haven[’']t confirmed the cause yet|There[’']s no confirmed change|I couldn[’']t verify your account details)/i;
const stuck = /\b(?:still|again|already|same (?:issue|problem)|did(?:n[’']t| not) (?:help|work)|not (?:working|getting)|no (?:replies|response|code)|not getting anywhere|going in circles|frustrated|upset|you keep|all day)\b/i;
const reviewRequest = /\b(?:live (?:help|support)|human (?:help|support)|(?:want|need|request|get) (?:a |an )?(?:(?:real|live|actual) )?(?:human|person|agent|representative|manager|supervisor)|(?:manager|management|supervisor)(?: to| for)? review|(?:request|need|want|please flag|asking for) (?:a )?management review|escalate (?:this|my|the) (?:issue|case|ticket|chat|problem))\b/i;
const transferRequest = /(?:^|\b(?:can i|could i|may i|let me|i (?:want|need|would like) to|please|can you|could you) )(?:(?:speak|talk|connect|transfer|escalate|reach)\b.{0,36})\b(?:someone|person|human|agent|representative|management|manager|supervisor|owner)\b/i;
const briefRequest = /^(?:human|agent|representative|manager|management|supervisor|escalate(?: this)?)[.!?\s]*$/i;
const genericHuman = /^This is automated support|^I can help troubleshoot this here\./i;

function reviewExplanation(context:SupportContext,question:string,contactRequested=false){
 const earlier=context.messages.slice(0,context.messages.findLastIndex(turn=>turn.role==='user'));
 // An older complaint cannot override a later human finding or explicit success.
 const boundary=earlier.findLastIndex(turn=>turn.role==='operator'||turn.role==='user'&&/^(?:that worked|it worked|working now|fixed now|all fixed|problem solved)[.!\s]*$/i.test(turn.content.trim()));
 const history=earlier.slice(boundary+1).filter(turn=>turn.role==='user').map(turn=>turn.content).reverse();
 const issue=history.find(text=>supportMissingActivityConcern(text)||! /^(?:why|for what|review|anything yet|any update|how long.*|will i be contacted)[?!.\s]*$/i.test(text.trim())&&/\b(?:code|sign[ -]?in|receipt|access|not working|down|nothing today|no leads|no calls|no texts|delayed|restart time|no response|not getting|credit|charged|payment|contract|agreement)\b/i.test(text)&&/\b(?:no|not|never|missing|wrong|duplicate|unrecognized|error|failed|blocked|stuck|issue|problem|down|delayed|unconfirmed|nothing today|can[’']?t|cannot|didn[’']?t|doesn[’']?t|haven[’']?t)\b/i.test(text))??'';
 const reason=/\b(?:sign[ -]?in|receipt|access)\b|\b(?:no|missing) code\b/i.test(issue)?'Your case is still in management review for your unresolved purchase or sign-in access.':supportMissingActivityConcern(issue)||/\b(?:nothing today|no leads|no calls|no texts|delayed|restart time|not working|down)\b/i.test(issue)?'Your case is still in management review because you reported the bot’s work is delayed or missing.':/\b(?:charged|payment|credit)\b/i.test(issue)?'Your payment or credit issue is still in management review.':/\b(?:contract|agreement)\b/i.test(issue)?'Your agreement issue is still in management review.':'Your unresolved issue is still in management review.';
 const next=contactRequested?'Management can reply in this conversation; I can’t promise a phone call, email, text or response time.':/\b(?:contacted|call me|email me|reply|respond)\b/i.test(question)?'Management can reply in this conversation; I can’t promise a phone call or response time.':'I don’t have a confirmed fix or completion time.';
 return reason+' '+next;
}

/** Only the server's reply finisher can persist this decision, together with the
 * customer-visible reply. Model output and customer instructions cannot set it. */
export function supportManagementReview(context:SupportContext, answer:SupportReply):SupportReply {
 const index=context.messages.findLastIndex(turn=>turn.role==='user');
 if(index<0)return answer;
 const reference=supportCaseReference(context);
 if(reference)return reference;
 const deletion=supportAccountDeletionGuidance(context);
 if(deletion){
  // Keep independently actionable payment findings alongside the deletion review.
  const question=context.messages[index].content;
  const payment=/duplicate-charge report|do both statement entries match|reporting a charge you don’t recognize|statement details you supplied are saved/i.test(answer.reply)?answer.reply+' ':/\b(?:refund|money back)\b/i.test(question)?supportAnswer('refund',[],false)+' ':'';
  const wantsRenewalStop=supportRenewalCancellationRequested(question);
  const accessBlocked=/\b(?:can[’']?t|cannot|unable to) (?:sign in|log in)|\b(?:no code|missing code)\b/i.test(question);
  const renewal=wantsRenewalStop?(accessBlocked?'Your request to stop future renewals also needs review because sign-in is blocked. This chat has not cancelled the subscription. ':supportAnswer('cancel',[],false).split(' If you need account deletion,')[0]+' '):'';
  return {reply:payment+renewal+deletion+' '+(context.handedOff?'Your case is still in management review.':'I’ve flagged this conversation for management review.'),status:'open',managementReview:true,ai:false};
 }
 if(context.handedOff&&answer.status==='closed'){
  return {reply:'The refund policy still applies. Your case is still in management review, and your earlier details are saved here.',status:'open',managementReview:true,ai:false};
 }
 const activityConfirmation=supportActivityConfirmation(context);
 if(activityConfirmation)return {...activityConfirmation,reply:activityConfirmation.reply+' '+(context.handedOff?'Your case remains in management review.':'I’ve flagged this conversation for management review.')};
 const question=context.messages[index].content;
 const previous=context.messages.slice(0,index).findLast(turn=>turn.role==='assistant'||turn.role==='operator');
 // Requests for a response to this support case are not seller outreach.
 const caseContact=/\b(?:support|management|case|update|responds?)\b/i.test(question)&&/(?:\b(?:call me|text me|email me|my number)\b|email \[email removed\])/i.test(question)
  || /^(?:is there|do you have) (?:a |an )?(?:phone |support )?number (?:i can|to) (?:call|contact)[?!.\s]*$/i.test(question.trim());
 const separatePayment=supportRenewalCancellationRequested(question)||/\b(?:refund|money back|charged twice|duplicate charge|unrecognized charge)\b/i.test(question)||/duplicate-charge report|do both statement entries match|reporting a charge you don’t recognize|statement details you supplied are saved/i.test(answer.reply);
 if(context.handedOff&&caseContact&&!separatePayment&&!/\b(?:seller|buyer|lead|bot|homeowner|don[’']?t|do not|no need)\b/i.test(question))return {reply:reviewExplanation(context,question,true),status:'open',managementReview:true,ai:false};
 // Operator replies can clear the queue flag without resolving purchase access.
 // Only an immediate, explicitly access-related timing follow-up uses this record.
 const operator=context.messages[index-1];
 if(operator?.role==='operator'&&/\breview\b/i.test(operator.content)&&/\b(?:access|checkout email|email correction)\b/i.test(operator.content)
  &&/no confirmed completion time/i.test(operator.content)
  &&!/access (?:is|was|has been) (?:restored|granted)|(?:access|email correction) review (?:is |was )?(?:complete|closed|resolved)/i.test(operator.content)
  &&/(?:not|haven[’']t|hasn[’']t).{0,70}(?:restored|granted|changed)|access.{0,40}(?:unconfirmed|not)/i.test(operator.content)
  &&/\b(?:timeframe|time frame|how long|when|completion time)\b/i.test(question)
  &&/\b(?:access|email correction|sign[ -]?in)\b/i.test(question)
  &&!/\b(?:refund|cancel|seller|buyer|bot|contract|credits?|course|vip)\b/i.test(question)
  &&!/access (?:is|was|has been) (?:restored|granted)|i[’']?m in|that worked/i.test(question)){
  return {reply:'The operator’s last update says your access review is still open, with no confirmed completion time. I can’t give you a reliable timeframe yet or confirm that the email has changed or access has been restored. Your earlier details remain in this conversation for management review.',status:'open',managementReview:true,ai:false};
 }
 // A returning guest may have no queue flag after an operator response. Preserve
 // only the latest trusted, still-unverified purchase finding; topic changes end it.
 const latestOperator=context.messages.slice(0,index).findLastIndex(turn=>turn.role==='operator');
 const purchaseNote=latestOperator>=0?context.messages[latestOperator].content:'';
 const sinceOperator=context.messages.slice(latestOperator+1,index).filter(turn=>turn.role==='user');
 const updateQuestion=/^(?:any update|anything yet|is there an update)[.!?\s]*$/i;
 if(context.kind==='access'&&latestOperator>=0&&updateQuestion.test(question.trim())
  &&sinceOperator.every(turn=>updateQuestion.test(turn.content.trim()))
  &&/purchase ownership still needs verification/i.test(purchaseNote)
  &&/transaction (?:reference|id)/i.test(purchaseNote)
  &&/please (?:share|send|provide)/i.test(purchaseNote)
  &&!/(?:do not|don[’']t) (?:share|send|provide).{0,40}(?:transaction|reference)/i.test(purchaseNote)
  &&!/access (?:is|was|has been) restored|review (?:is |was )?(?:complete|closed|resolved)/i.test(purchaseNote)){
  return {reply:'The last operator update says purchase ownership still needs verification. The transaction reference requested there can help match the payment; you do not need to resend the same screenshots or pay again. I have no confirmed access change or completion time. I’ve flagged this conversation for management review.',status:'open',managementReview:true,ai:false};
 }
 const reviewFollowup=/management review|flagged this conversation/i.test(previous?.content??'')||/\b(?:management|review|any update|anything yet)\b/i.test(question);
 // A verified handoff plus the immediate support topic distinguishes waiting
 // for Support from seller follow-up. Assistant text alone cannot create a handoff.
 const waitForSupport=/^(?:(?:ok(?:ay)?|so)[,\s]+)?(?:(?:do|should|can) i (?:just )?wait for (?:(?:a |an |the |your )?(?:follow[ -]?up|reply|response|update)(?: from (?:support|management|you))?|(?:support|management) to (?:reach out|contact me|reply|respond)(?: (?:every ?time (?:this happens|i[’']m in this situation)))?)|will (?:support|management|you) follow up(?: with me)?|what (?:should i do|is the best thing for me to do) next)[.!?\s]*$/i.test(question.trim());
 const reviewStep=previous?.role==='assistant'&&/management review|flagged this conversation|committed to earlier work while its costs are confirmed|reserved for (?:unfinished|pending) work/i.test(previous.content);
 if(context.handedOff&&reviewStep&&waitForSupport){
  return {reply:reviewExplanation(context,'will someone reply')+' You can check this conversation for updates or add new details here; you don’t need to repeat the steps you already reported.',status:'open',managementReview:true,ai:false};
 }
 if(context.handedOff&&reviewFollowup&&/^(?:for what|why|review|what (?:unresolved )?issue|what (?:is|does) (?:the |management )?review(?: mean)?|why (?:is|was) (?:it|this|my case) (?:in |under )?review|anything yet|any update|how long(?: will (?:it|this) take)?|will i be contacted|will (?:someone|management) (?:reply|respond|contact me)|what happens now)[.!?\s]*$/i.test(question.trim())){
  return {reply:reviewExplanation(context,question),status:'open',managementReview:true,ai:false};
 }
 const partyQuestion=/\b(?:seller|buyer|homeowner|property owner|lead)\b/i.test(question)&&!/\b(?:support|supervisor|management|manager|ticket|escalate|representative)\b/i.test(question);
 const explicit=!partyQuestion&&(briefRequest.test(question.trim())||((reviewRequest.test(question)||transferRequest.test(question))&&!/(?:don[’']?t|do not|no need to) (?:want|need|escalate|speak|talk|transfer)/i.test(question)));
 const followup=stuck.test(question)||/^(?:i did|no|why|what now|i don[’']?t understand|what do you mean)[.!?\s]*$/i.test(question.trim());
 const missingCode=context.kind==='access'&&supportCodeDelivery(currentAccessConversation(context.messages))==='missing';
 const exhaustedAccess=missingCode&&answer.status==='open'&&!answer.reply.includes('?')&&!!previous;
 const proofAwaitingReview=answer.status==='open'&&/you[’']ve said you sent the receipt|purchase needs to be matched and ownership verified|earlier proof details are already/i.test(answer.reply);
 const recentReplies=context.messages.slice(0,index).filter(turn=>turn.role==='assistant'||turn.role==='operator').slice(-2);
 const repeatedDeadEnd=generic.test(answer.reply)&&recentReplies.length===2&&recentReplies.every(turn=>turn.role==='assistant'&&generic.test(turn.content));
 // Only trusted local answer branches can identify routine product guidance.
 // Repetition of that explanation alone is not a newly failed troubleshooting step.
 const failedAgain=previous?.role==='assistant'&&followup&&(
  generic.test(previous.content)&&generic.test(answer.reply)||
  (!answer.routineGuidance&&answer.status==='open'&&previous.content===answer.reply&&!answer.reply.includes('?'))
 );
 const paymentReview=/reporting a charge you don’t recognize|duplicate-charge report needs its own payment check|do both statement entries match|statement details you supplied are saved/i.test(answer.reply)&&!/\b(?:what if|hypothetically|if i (?:am|were)|could i be)\b/i.test(question);
 const genericReply=generic.test(answer.reply)||genericHuman.test(answer.reply)||/^Hi!|^Which page is this happening on\?/i.test(answer.reply);
 const failedSteps=['open','waiting_on_customer'].includes(answer.status)&&!answer.routineGuidance&&supportRepeatedFailedSteps(context.messages);
 const needsReview=answer.managementReview===true||paymentReview||explicit||exhaustedAccess||proofAwaitingReview||failedAgain||failedSteps||repeatedDeadEnd||context.handedOff&&genericReply;
 if(!needsReview)return answer;
 const note=context.handedOff?'Your case is still in management review.':'I’ve flagged this conversation for management review.';
 let detail=genericReply?'':answer.reply;
 if(failedSteps)detail='Those troubleshooting steps haven’t resolved the issue. You don’t need to repeat the same steps; the failed attempts are saved in this conversation.';
 if(explicit&&genericReply)detail='This is automated support, so there isn’t a live transfer.';
 if(missingCode&&genericReply)detail='Your sign-in code still hasn’t reached you. You don’t need to request another code or pay again.';
 if(context.handedOff&&previous?.content===answer.reply)detail='';
 if(context.handedOff&&!detail)return {...answer,reply:reviewExplanation(context,question),status:'open',managementReview:true};
 return {...answer,reply:[detail,note].filter(Boolean).join(' '),status:'open',managementReview:true};
}
