import {createHash} from 'node:crypto';
import {z} from 'zod';
export const supportId = z.string().uuid();
export const supportTopics = ['work','billing','setup','cancel','human','general'] as const;
export type SupportTopic = typeof supportTopics[number];
export type SupportEvidence = {key:string; source:string; status:'ok'|'attention'|'unknown'; detail:string; observedAt:string};
export const supportMessageInput = z.object({requestId:supportId,threadId:supportId.optional(),message:z.string().trim().min(1).max(2000)}).strict();
export const supportStatusInput = z.object({requestId:supportId,threadId:supportId,status:z.enum(['open','escalated','waiting_on_customer','resolved']),reply:z.string().trim().min(1).max(3000).optional()}).strict();
/** Only these literal topics influence diagnostics. Model output is never an executable instruction. */
export function supportTopic(text:string):SupportTopic {
 if(/\b(human|person|owner|agent|escalate)\b/i.test(text))return 'human';
 if(/\b(cancel|stop|delete|refund)\b/i.test(text))return 'cancel';
 if(/\b(bill|billing|charge|charged|payment|credit|balance|renewal)\b/i.test(text))return 'billing';
 if(/\b(sign.?in|setup|start|login)\b/i.test(text))return 'setup';
 return 'work';
}
export function redactSupportQuestion(text:string){
 return text.slice(0,2000)
 .replace(/(?:Bearer\s+)?(?:sk[-_](?:live_|test_)?|sb_secret_|re_|whsec_|eyJ)[A-Za-z0-9_\-.]{8,}/gi,'[credential removed]')
 .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email removed]')
 .replace(/https?:\/\/\S+/gi,'[link removed]')
 .replace(/\b\d[\d\s().+\-]{5,}\d\b/g,'[number removed]');
}
export function supportAnswer(topic:SupportTopic,evidence:SupportEvidence[],ai:boolean){
 const wanted=topic==='billing'?['billing','credits']:topic==='setup'?['readiness','work']:topic==='cancel'?['work','billing']:['work','readiness','screening','voice','billing'];
 const relevant=evidence.filter(e=>wanted.includes(e.key));
 const intro=topic==='cancel'?'To stop future bot work and daily renewals, use “Review cancellation” below and confirm. Chat messages alone do not cancel anything. Deletion and refunds need a separate support review.':topic==='human'?'You can send this conversation and its status checks to the support team using “Ask the team”.':'Here is what I could verify from your account:';
 const details=relevant.map(e=>e.detail).join('\n');
 const ending=relevant.some(e=>e.status!=='ok')?'If this does not explain the issue, choose “Ask the team”. Your conversation and these checks will be included.':'If something still seems wrong, tell me what you expected and what happened.';
 return `${intro}\n\n${details}\n\n${ending}${ai?'':'\n\nAI is unavailable right now; these are direct account checks.'}`;
}
export function hashCancelNonce(nonce:string){return createHash('sha256').update(nonce).digest('hex');}
const cancelNonce=z.string().regex(/^[a-f0-9]{64}$/);
/** Ephemeral confirmation only. The database, never client claims, binds owner/account/mode/expiry. */
export function createCancelToken(requestId:string,nonce:string){return `${supportId.parse(requestId)}.${cancelNonce.parse(nonce)}`;}
/** Parsing grants no authority: only an authenticated, atomic DB claim can consume the nonce hash. */
export function parseCancelToken(token:string){
 if(token.length!==101)throw Error('INVALID_CONFIRMATION');
 const [requestId,nonce,...extra]=token.split('.');if(extra.length)throw Error('INVALID_CONFIRMATION');
 return {requestId:supportId.parse(requestId),nonce:cancelNonce.parse(nonce)};
}
/** Email is an untrusted cancellation request, not authorization. Body/HTML never reach an agent. */
export function isCancelEmail(subject:unknown){return typeof subject==='string'&&/^\s*(?:cancel|cancel my account)\s*[.!]?\s*$/i.test(subject);}
