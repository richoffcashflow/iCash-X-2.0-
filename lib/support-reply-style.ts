import type {SupportEvidence} from './support-policy.ts';

type Turn={role:string;content:string};
const supportTurn=(turn:Turn)=>turn.role==='assistant'||turn.role==='operator';
const questions=(text:string)=>text.match(/[^.!?\n]+\?/g)?.map(value=>value.trim())??[];
const normalize=(text:string)=>text.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

/** Keep short follow-ups attached to the latest named issue, not the first issue in the thread. */
export function currentSupportIssue(messages:Turn[]){
 const users=messages.filter(turn=>turn.role==='user');
 return [...users].reverse().find(turn=>/\b(?:card|payment|billing|bill|charge|charged|credits?|balance|renewal|subscription|bot|leads?|propert(?:y|ies)|seller|owner|calls?|calling|texts?|texting|contract|course|sign.?in|log.?in|code|refund|cancel)\b/i.test(turn.content))?.content??users.at(-1)?.content??'';
}

export function supportReplyEvidence(messages:Turn[],evidence:SupportEvidence[]){
 const issue=currentSupportIssue(messages);
 const billing=/\b(?:card|payment|billing|bill|charge|charged|credit|balance|renewal|subscription)\b/i.test(issue);
 const work=/\b(?:bot|lead|property|contract|course|sign.?in|log.?in|code)\b/i.test(issue);
 // A failed calling/search/contract check is not evidence of a failed card update.
 return billing&&!work?evidence.filter(check=>['membership_payments','subscription','billing','payments','credits'].includes(check.key)):evidence;
}

export function supportAskedQuestions(messages:Turn[]){
 return messages.filter(supportTurn).flatMap(turn=>questions(turn.content));
}

function questionKind(text:string){
 if(/\b(?:error|message)\b/i.test(text)&&/\b(?:see|show|shown|appear|display|say|says|text|exact)\b/i.test(text))return 'screen-message';
 if(/\b(?:which|what) (?:screen|page)\b/i.test(text))return 'screen';
 if(/\b(?:which|what) (?:device|browser)\b/i.test(text))return 'browser';
 return null;
}

function repeatedQuestion(question:string,messages:Turn[]){
 const normalized=normalize(question),kind=questionKind(question);
 if(kind==='screen-message'&&messages.some(turn=>turn.role==='user'&&/\bno (?:error|message)|nothing (?:appears|shows)|doesn.t (?:say|show) anything/i.test(turn.content)))return true;
 return supportAskedQuestions(messages).some(prior=>normalize(prior)===normalized||(kind!==null&&questionKind(prior)===kind));
}

/** The local fallback must not repeat questions even when the model is unavailable. */
export function removeRepeatedSupportQuestions(reply:string,messages:Turn[]){
 let result=reply;
 for(const question of questions(reply))if(repeatedQuestion(question,messages))result=result.replace(question,'');
 result=result.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 if(!result)return 'I have the details you already shared. I can’t confirm a fix from the account checks available here yet.';
 return result;
}

export function repeatsSupportQuestion(reply:string,messages:Turn[]){
 return questions(reply).some(question=>repeatedQuestion(question,messages));
}

export const supportReplyStyle=`
Sound like a helpful person in a short chat, without pretending to be human. Use natural contractions and respond to what they actually said. Avoid scripted filler such as "I understand your frustration," repeated apologies, or repeating their whole message. Never sound threatening or punish a customer for asking about a refund. Closing a chat is not proof that their problem was fixed.
Write for a customer who is not comfortable with computers. Use everyday words, short sentences and a warm, respectful tone. Never talk down to them. Usually use 2–3 sentences and no more than 80 words. For instructions, give one small action at a time with the exact visible button name when known. Never invent a button.
Start with the customer's specific problem or the useful next step. Do not repeat a long summary, generic apology, or "This will help further diagnose the problem." Do not use terms such as workspace readiness, configuration, reconciliation, payment method persistence, or provider in customer replies.
When someone says their bot is not calling or texting, answer that problem from recorded activity and holds. Do not ask what they were trying to do or ask whether the bot is paused when the account check already answers that. Do not bring up test credits, sandbox payments, bank balances or refunds in an ordinary work-credit or outreach answer. Mention test mode only if the customer explicitly asks about it or a verified test payment is the actual issue. Never describe lifetime activity totals as today's calls or texts.
Read all supplied conversation history, including earlier support replies. Use details already given. Ask at most ONE short question only when its answer changes the next step. Do not rephrase a question already asked, ask for an error after the customer said there is none, or suggest a step they already tried. Do not end every reply with a question. If no useful new step is supported, plainly say what cannot be confirmed yet and keep the issue open; do not invent progress.
Stay on the current issue. A calling, property-search or contract check does not establish why a card update failed. Never link unrelated checks or speculate that one issue "might indirectly affect" another. A repeated saved-card row is not proof of a duplicate charge. Do not claim a new card failed to save or became the billing card without direct evidence. Current account checks do not list saved cards or the default card.
For a card that switches back, a useful reply can be: "The page is still showing your old card. I can’t confirm yet whether the new one saved. What does the button beside the new card say?" Ask this only if that detail is missing and it has not already been requested. If the customer already supplied it, use it to choose the next supported step instead.
`;
