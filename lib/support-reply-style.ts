import type {SupportEvidence} from './support-policy.ts';
import {supportHowToQuestion,supportSimpleProductAnswer} from './support-product-guide.ts';

type Turn={role:string;content:string};
const supportTurn=(turn:Turn)=>turn.role==='assistant'||turn.role==='operator';
const questions=(text:string)=>text.match(/[^.!?\n]+\?/g)?.map(value=>value.trim())??[];
const normalize=(text:string)=>text.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

/** Replies to a support question are details about the current issue, not new topics. */
export function supportContinuation(text:string){
 const value=normalize(text);
 return /^(?:yes|no|ok|okay|nothing|done|ready|running|active|pause bot|hello|hi|thanks|thank you|could be anytime|so anytime|where is that(?: at)?|where do i find that|what do you mean|please troubleshoot|please trouble shoot)$/.test(value)
  || /^(?:still\b|same\b|already\b|any update\b|it says\b|it (?:still|just)\b|i (?:already |still )?(?:did|tried)\b|the workspace\b)/.test(value)
  || /^(?:its|it is|the bot is|my bot is) (?:active|running|on|not paused)[.!\s]*$/.test(value)
  || /^(?:so )?(?:what should i do|how should i reply|how do i reply|is that enough|am i doing something wrong|can you confirm (?:it|that)|well can you confirm (?:it|that)|i know but (?:it|its|it is) (?:not working|still not working))$/.test(value)
  || /^it (?:dont|doesnt|does not) (?:show|say)\b/.test(value)
  || /^(?:ok(?:ay)?(?: because)? )?(?:but )?i want (?:the|my) bot to do the work$/.test(value)
  || /^i (?:sent|made) (?:the|that) (?:text|message|call)\b.*\b(?:wasnt|was not|not) (?:the )?bot\b/.test(value)
  || /^(?:\d+ (?:leads?|matches|properties)\s*)+$/.test(value);
}

/** Keep short follow-ups attached to the latest named issue, not the first issue in the thread. */
export function currentSupportIssue(messages:Turn[]){
 const users=messages.filter(turn=>turn.role==='user');
 const latest=users.at(-1)?.content??'';
 // Only a short continuation inherits the previous topic. A new question or
 // complaint (including a topic we do not recognize) must not inherit billing.
 const continuation=supportContinuation;
 const named=/\b(?:card|payment|billing|charge|credits?|balance|subscription|bot|leads?|seller|calls?|texts?|contract|course|sign.?in|log.?in|code|refund|cancel|photos?|images?|pictures?|videos?|documents?|notifications?)\b/i;
 const detail=/^(?:it(?:[’']s| is) active|(?:my |the )?bot is (?:running|active)|\d+ (?:leads?|matches)|i (?:sent|made) (?:the|that) (?:text|message|call))/i.test(latest.trim());
 if(!continuation(latest)||(named.test(latest)&&!detail))return latest;
 const confirmed=users.findLastIndex(turn=>/\b(?:that worked|it worked|working now|fixed now|all fixed|problem solved)\b/i.test(turn.content)&&!/(?:not|still|but)\b/i.test(turn.content));
 return users.slice(confirmed+1,-1).findLast(turn=>!continuation(turn.content)&&! /^(?:hi|hello|hey|thanks|thank you)[.!?\s]*$/i.test(turn.content.trim()))?.content??latest;
}

const workFailure=(issue:string)=>/\b(?:bot|automation|outreach|calls?|calling|texts?|texting|leads?|research)\b.{0,60}\b(?:stopped|stuck|not|never|no|missing|failing|failed|waiting|running|working|status)\b|\b(?:not|no|never|isn[’']?t|doesn[’']?t|won[’']?t|cannot|can[’']?t)\b.{0,60}\b(?:bot|calls?|calling|texts?|texting|leads?|research)\b/i.test(issue);

export function supportCreditRelevant(messages:Turn[],evidence:SupportEvidence[]){
 const issue=currentSupportIssue(messages);
 if(/\bcredits?\b(?![\s-]+cards?\b)|\b(?:balance|funds?|funding|spend(?:ing)?|usage|add(?:ing)? money|top.?up)\b/i.test(issue))return true;
 if(supportHowToQuestion(issue)||supportSimpleProductAnswer(issue))return false;
 const stopped=workFailure(issue),payment=/\b(?:payments?|paid|checkout)\b/i.test(issue);
 return evidence.some(e=>e.status==='attention'&&((stopped&&e.key==='credits'&&e.code==='no_available_credit')||((stopped||payment)&&e.key==='payments'&&e.code==='payment_uncredited')));
}

export function supportReplyEvidence(messages:Turn[],evidence:SupportEvidence[]){
 // Private preparation metadata is not a customer issue or model input.
 evidence=evidence.filter(check=>check.key!=='refund_case');
 const question=messages.filter(turn=>turn.role==='user').at(-1)?.content??'';
 if(supportHowToQuestion(question)||supportSimpleProductAnswer(question))return [];
 const issue=currentSupportIssue(messages);
 const keys=new Set<string>();
 if(/\b(?:card|payments?|paid|checkout|billing|bill|charges?|charged|renewal|subscription)\b/i.test(issue))for(const key of ['membership_payments','subscription','billing'])keys.add(key);
 if(/\b(?:payments?|paid|checkout)\b/i.test(issue))keys.add('payments');
 if(supportCreditRelevant(messages,evidence))for(const key of ['credits','payments'])keys.add(key);
 if(/\b(?:course|training|tutorial|lesson|video|pdf)\b/i.test(issue))keys.add('course');
 if(workFailure(issue)){
  keys.add('work');keys.add('outreach');
  if(/\b(?:calls?|calling)\b/i.test(issue))keys.add('voice');
  if(/\b(?:leads?|research)\b/i.test(issue))keys.add('screening');
 }
 // Passing background checks are not an answer. Global readiness is relevant
 // only to an explicit readiness question, not every failure in the interface.
 if(/\breadiness\b|\b(?:bot|account)\b.{0,20}\bready\b/i.test(issue))keys.add('readiness');
 return evidence.filter(check=>keys.has(check.key));
}

export function supportAskedQuestions(messages:Turn[]){
 return messages.filter(supportTurn).flatMap(turn=>questions(turn.content));
}

function questionKind(text:string){
 if(/\b(?:error|message)\b/i.test(text)&&/\b(?:see|show|shown|appear|display|say|says|text|exact)\b/i.test(text))return 'screen-message';
 if(/\b(?:which|what) (?:screen|page)\b/i.test(text))return 'screen';
 if(/\b(?:which|what) (?:device|browser)\b/i.test(text))return 'browser';
 if(/\b(?:bot|automation)\b/i.test(text)&&/\b(?:paused|running|active|status|switched on)\b/i.test(text))return 'bot-status';
 return null;
}

function repeatedQuestion(question:string,messages:Turn[]){
 const normalized=normalize(question),kind=questionKind(question);
 if(kind==='bot-status'&&messages.some(turn=>turn.role==='user'&&/\b(?:running|active|not paused|switched on)\b/i.test(turn.content)))return true;
 if(kind==='screen-message'&&messages.some(turn=>turn.role==='user'&&/\bno (?:error|message)|nothing (?:appears|shows)|doesn.t (?:say|show) anything/i.test(turn.content)))return true;
 return supportAskedQuestions(messages).some(prior=>normalize(prior)===normalized||(kind!==null&&questionKind(prior)===kind));
}

/** The local fallback must not repeat questions even when the model is unavailable. */
export function supportSafetyOnly(reply:string){
 return /^(?:please\s+)?(?:(?:don[’']t|do not|never)\s+(?:share|send|post|include)\s+(?:any\s+|the\s+|your\s+)?(?:sign[ -]?in\s+)?(?:code(?: itself)?|codes|passwords?|card (?:details|numbers))|leave out (?:the |your )?(?:codes?|passwords?|card details))[.!\s]*$/i.test(reply.trim());
}

export function removeRepeatedSupportQuestions(reply:string,messages:Turn[]){
 let result=reply;
 for(const question of questions(reply))if(repeatedQuestion(question,messages))result=result.replace(question,'');
 result=result.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 if(!result||supportSafetyOnly(result))return 'I don’t have a confirmed answer from the details available yet. What are you trying to do, and what happens when you try?';
 return result;
}

export function repeatsSupportQuestion(reply:string,messages:Turn[]){
 return questions(reply).some(question=>repeatedQuestion(question,messages));
}

export const supportReplyStyle=`
Sound like a helpful person in a short chat, without pretending to be human. Use natural contractions and respond to what they actually said. Avoid scripted filler such as "I understand your frustration," repeated apologies, or repeating their whole message. Never sound threatening or punish a customer for asking about a refund. Closing a chat is not proof that their problem was fixed.
Write for a customer who is not comfortable with computers. Use everyday words, short sentences and a warm, respectful tone. Never talk down to them. Usually use 2–3 sentences and no more than 80 words. For instructions, give one small action at a time with the exact visible button name when known. Never invent a button.
Start with the customer's specific problem or the useful next step. Do not repeat a long summary, generic apology, or "This will help further diagnose the problem." Do not use terms such as workspace readiness, configuration, reconciliation, payment method persistence, or provider in customer replies.
For a simple feature, meaning or how-to question, give the direct answer and stop. One sentence is enough when it answers the question. Do not attach credits, billing, Pause, course progress, warnings or a question unless they are necessary to answer what the customer asked. A paused bot or empty wallet does not stop you explaining a feature. Do not use Course as a substitute for an answer or append a course reminder to a resolved reply. If a feature is unavailable, say so plainly without inventing controls.
This focus rule also applies to complaints, follow-ups and unfamiliar questions, not just how-to questions. Do not mention readiness, service checks, credits, balances or adding money when the current issue is unrelated. Mention credits only for the customer's own credit/funding/usage question or a verified missing-credit blocker that directly explains stopped work. Do not add a passing-check summary. Earlier support replies or an old billing topic do not make credits relevant to a new question. General product guidance is background knowledge, not a checklist to append.
When someone says their bot is not calling or texting, answer that problem from recorded activity and holds. Do not ask what they were trying to do or ask whether the bot is paused when the account check already answers that. Do not bring up test credits, sandbox payments, bank balances or refunds in an ordinary work-credit or outreach answer. Mention test mode only if the customer explicitly asks about it or a verified test payment is the actual issue. Never describe lifetime activity totals as today's calls or texts.
Read all supplied conversation history, including earlier support replies. Use details already given. Ask at most ONE short question only when its answer changes the next step. Do not rephrase a question already asked, ask for an error after the customer said there is none, or suggest a step they already tried. Do not end every reply with a question. If no useful new step is supported, plainly say what cannot be confirmed yet and keep the issue open; do not invent progress.
If the answer is unknown, say so and ask a focused clarification that can change the next step. Never assume someone has a sign-in-code problem just because they opened guest support. A warning such as “Please don’t share the code itself” is never a complete answer. New questions about the original platform must not inherit old code troubleshooting.
Short replies such as "It’s active", "Nothing", "73 leads, 42 matches", "Where is that at?", and "I sent that text" continue the current issue. They are not reasons to restart onboarding. Earlier assistant messages may be wrong: correct a wrong instruction plainly instead of treating it as product documentation. An acknowledgment like "OK" does not need another task or question.
Never tell a customer to wait a few hours, promise outreach will start soon, or call a delay normal just because the bot is on. A Run status is not a send receipt. Account call/text totals can include manual work: a customer's own text is not proof the bot sent it. Never turn their correction into a claim about unverified automatic activity. Do not say "I’m checking" or "I’ll investigate" unless a real operation is underway; say what the completed checks actually establish.
There is no Start outreach button, Automatic outreach switch, Bot Contact setting, Contact permissions toggle, or Communication Settings page. Do not ask customers to hunt for something "similar" or infer a permission error from missing messages. Only name controls documented in the product guide. If earlier support invented a control, say the instruction was wrong and give the correct behavior. Do not imply a support team handoff exists.
Stay on the current issue. A calling, property-search or contract check does not establish why a card update failed. Never link unrelated checks or speculate that one issue "might indirectly affect" another. A repeated saved-card row is not proof of a duplicate charge. Do not claim a new card failed to save or became the billing card without direct evidence. Current account checks do not list saved cards or the default card.
For a card that switches back, a useful reply can be: "The page is still showing your old card. I can’t confirm yet whether the new one saved. What does the button beside the new card say?" Ask this only if that detail is missing and it has not already been requested. If the customer already supplied it, use it to choose the next supported step instead.
`;
