import type {SupportEvidence} from './support-policy.ts';
import {currentSupportIssue} from './support-reply-style.ts';

type Turn={role:string;content:string};
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

/** Exact instructions for the observed workspace. These replies never perform an action. */
export function supportWorkflowReply(messages:Turn[],evidence:SupportEvidence[]){
 const latest=messages.filter(m=>m.role==='user').at(-1)?.content??'';
 const issue=currentSupportIssue(messages);
 if(/\b(?:refund|cancel|billing|charged|payment|card|sign.?in|log.?in)\b/i.test(latest))return null;
 const answer=(reply:string)=>({reply,status:'open' as const,ai:false});
 if(/\b(?:contact checks?|contract check)\b.{0,35}\b(?:expired|refresh|renew)|\bexpired\b.{0,35}\bcontact/i.test(issue))return answer('That follow-up is blocked because its saved contact checks expired. There is no customer button to renew them; refreshing the page, saving a resolution note or choosing Return to bot does not renew the checks. I can’t confirm that this follow-up can resume yet.');
 if(/\b(?:save resolution|resolution note|record (?:the |an? )?answer|no reply to delivered question|seller follow.?up)\b/i.test(issue)){
  if(/\b(?:can.t|cannot|won.t|unable|not|disabled|grey|gray)\b.{0,40}\b(?:save|click|press)|\b(?:save|button)\b.{0,25}\b(?:disabled|grey|gray|not working)/i.test(latest))return answer('Save resolution needs a note of at least 10 characters describing what you actually completed. It saves an internal note; it does not send the seller a message or restart outreach. If your completed note is long enough, what error appears when you save it?');
  return answer('“No reply to delivered question” means no seller answer is recorded for that follow-up. Open the property under Your leads and review Texts. Save resolution is an internal note for follow-up you have completed; it does not reply to the seller, renew contact checks or restart outreach.');
 }
 if(/\bneeds you\b/i.test(issue))return answer('Needs you marks a property that needs your review, such as an agreement, seller question or blocked follow-up. Open that property and read its alert. Save resolution records completed follow-up; it does not send a seller message or restart the bot.');
 if(/\b(?:agreements?|contracts?|documents?)\b/i.test(issue)&&/\b(?:where|how|find|open|tab|section|button|create|prepare|send|download|missing|no|can.t|cannot|isn.t|don.t)\b/i.test(issue)){
  // A failed download/send needs troubleshooting; directions alone do not fix it.
  if(/\b(?:fails?|failed|error|blank|spinning)\b|\b(?:can.t|cannot|won.t|unable to)\b.{0,20}\b(?:download|send|save|sign)\b/i.test(issue))return null;
  if(/\bassignment\b/i.test(issue))return answer('Open the property under Your leads, then Agreements. The assignment draft becomes available after the purchase agreement is signed. There is no separate Documents tab in the main workspace.');
  return answer('Agreements are inside each property, not a separate Documents tab. Open the property under Your leads. To prepare an agreement yourself, choose Take over, then Seller is ready for an agreement; review it under Agreements using Edit agreement and Send for signatures.');
 }
 if(/\b(?:phone|number)\b/i.test(issue)&&/\b(?:seller|owner|property|lead)\b/i.test(issue)&&/\b(?:missing|no|blank|not showing|not found)\b/i.test(issue))return answer('That is the seller’s contact number, separate from your own number in Settings. Updating your number does not supply a missing seller number. I can’t confirm a usable seller number for that property from these account totals.');
 if(/\b(?:enough|sufficient|afford)\b/i.test(issue)&&/\b(?:credits?|balance|calls?|calling)\b/i.test(issue)){
  const progress=evidence.find(e=>e.key==='outreach')?.outreach?.progress;
  const credit=evidence.find(e=>e.key==='credits'),voice=evidence.find(e=>e.key==='voice'&&e.status==='attention');
  const available=progress?.spendingMode==='available_balance'?`${money(progress.remainingCents)} is available for new work.${progress.pendingCents?` ${money(progress.pendingCents)} is committed to earlier work while its costs are confirmed.`:''}`:credit?.detail;
  return answer((available??'I can’t verify how much is available for new work right now.')+' '+(voice?.detail??'A call must pass its own cost and contact checks; a positive balance alone does not confirm it can start.'));
 }
 return null;
}
