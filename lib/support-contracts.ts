import {currentSupportIssue,supportContinuation} from './support-reply-style.ts';

type Turn={role:string;content:string};
type Answer={reply:string;status:'open'|'resolved'|'waiting_on_customer'};
const agreement=/\b(?:contracts?|agreements?|documents?|signing|signatures?)\b/i;
const failure=/\b(?:expired|error|failed|missing|blocked|stuck|unavailable|never|not|cannot)\b|\b(?:can|does|did|is|was|will|would)n[’']?t\b/i;
const navigation='Open the property in Your leads, then choose Documents.';
const delivery='Contracts are handled online. The seller gets a secure text link to review and sign in their browser; we don’t mail paper contracts.';

/** Product guidance, never an instruction to send, sign, cancel or alter a deal.
 * Keep short replies on the current issue; a new subject must not inherit it. */
export function supportContractAnswer(messages:Turn[]):Answer|null{
 const users=messages.filter(m=>m.role==='user');
 const latest=users.at(-1)?.content.trim()??'';
 const issue=currentSupportIssue(messages);
 const prior=users.at(-2)?.content??'';
 const continuation=supportContinuation(latest)||/^(?:agreement|documents?|purchase agreement|assignment agreement)[.!?\s]*$/i.test(latest);
 const context=agreement.test(latest)?latest:continuation?issue:'';
 if(!agreement.test(context))return null;
 if(/\b(?:human|real person|live agent)\b|\b(?:speak|talk|connect)\b.{0,25}\b(?:someone|support|agent)\b/i.test(latest))return null;
 // Billing and personal coaching retain their existing routes. Contract
 // cancellation is handled below rather than mistaken for a subscription.
 if(/\b(?:subscription|membership|refund|billing|credits?|charged|card)\b/i.test(latest))return null;
 const q=continuation?`${context}\n${latest}`:latest;
 const result=(reply:string,status:Answer['status']='resolved'):Answer=>({reply,status});
 const previous=messages.filter(m=>m.role==='assistant'||m.role==='operator').at(-1)?.content??'';
 const correction=/\b(?:mail|print|courier|post office)\b|\bemail (?:the |your )?(?:contract|agreement)|\b(?:create|upload).{0,25}(?:new|replacement) contract/i.test(previous)
  && continuation&&agreement.test(prior+' '+issue)?'My earlier delivery instruction was wrong. ':'';
 if(/\b(?:cancel(?:l?ing|lation)?|terminate|termination)\b/i.test(q))return result(`${navigation} Use the contract cancellation controls there. Cancelling a contract is separate from cancelling your subscription; a cancellation request does not by itself end a signed agreement.`,failure.test(latest)?'open':'resolved');
 if(/\b(?:expired|expiry|expiration)\b/i.test(q))return result('An expired check does not by itself mean the contract expired. Don’t create or upload a replacement agreement to bypass it. '+navigation+' What status is shown beside the agreement?','open');
 if(/\b(?:own|their|his|her)\s+(?:purchase\s+)?contract\b|\b(?:seller|owner)\b.{0,25}\bsend\b.{0,15}\b(?:me|us)\b/i.test(q))return result('If the seller wants to provide their own contract, its terms need review before anyone agrees or signs. Our agreement process is online; support cannot accept or replace the agreement for you.','open');
 if(/\b(?:two|multiple|more than one|another|all required|co.?owner)\b.{0,35}\b(?:owners?|signers?|signatures?)\b|\b(?:spouse|co.?owner)\b/i.test(q))return result(`${navigation} Include every required signer using Add required signer. If the app says the template does not support them, keep the agreement unsent for review; don’t remove an owner to force it through.`,failure.test(q)?'open':'resolved');
 if(/\b(?:wrong|incorrect|change|changed|edit|amend)\b/i.test(q))return result(`${navigation} Use Edit agreement and Save draft for an unsent draft. Already-issued or signed agreements stay in history; changed signed terms need an amendment, not an overwrite.`,failure.test(q)||/\b(?:wrong|incorrect)\b/i.test(q)?'open':'resolved');
 if(/\b(?:signed|done|complete|completed)\b/i.test(q)&&!/\b(?:where|download|copy)\b/i.test(q))return result(`${navigation} Use Check signature status on the existing agreement. The seller saying “done” does not confirm all signatures; when the seller signatures are verified, your step is Review & sign.`,'open');
 if(/\b(?:never|not|no|missing|failed|cannot|can[’']?t|didn[’']?t|doesn[’']?t|won[’']?t)\b/i.test(q)&&/\b(?:arriv\w*|receiv\w*|open|link|text|send|sent|deliver\w*)\b/i.test(q))return result(`${delivery} ${navigation} Check the existing signing request before sending again; a prepared agreement is not proof the text arrived. Keep the original agreement while the delivery problem is checked.`,'open');
 if(/\b(?:no|without|cannot|can[’']?t|doesn[’']?t|don[’']?t)\b.{0,35}\b(?:smartphone|computer|internet|text)\b/i.test(q))return result(`${delivery} If the seller cannot open the link, keep that signing issue open for review. Don’t promise paper delivery or sign on the seller’s behalf.`,'open');
 if(/\b(?:mail|mailed|mailing|postal|paper|print|printing|courier|online|electronically|digital)\b/i.test(q))return result(correction+delivery);
 if(/\b(?:download|copy|pdf)\b/i.test(q))return result(`${navigation} Download purchase draft gives you an unsigned draft. Download signed PDF is available for a completed agreement; downloading a draft does not send it or put the property under contract.`);
 if(/\b(?:where|find|section|page|documents|agreement)\b/i.test(q)&&! /\b(?:send|sign|seller|owner|buyer|prepare|review)\b/i.test(q))return result(correction+navigation+' Open Send for signatures & history to see the signing request and its status.',failure.test(q)?'open':'resolved');
 if(/\b(?:send|sending|text|email|prepare|seller|owner|sign|review|take over)\b/i.test(q))return result(correction+delivery+' To send it yourself, choose Take over on the property, then Documents → Edit agreement → Save draft. Open Send for signatures, review the terms and every required signer, then choose Text contract link.',failure.test(q)?'open':'resolved');
 return null;
}
