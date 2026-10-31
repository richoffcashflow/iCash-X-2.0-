import {supportLegacyQuestion,supportLegacyStatus} from './support-legacy-migration.ts';
import {supportLeadImportPolicy,supportLeadImportQuestion,supportMissingSellerContactQuestion} from './support-lead-policy.ts';
type Turn={role:string;content:string};

export function supportContactTimingQuestion(text:string){
 return /\b(?:contacts?|contact info(?:rmation)?|phone numbers?)\b/i.test(text)&&/\b(?:same time|how long|when|wait|automatically|find|found|come up|show up)\b/i.test(text)&&!/\b(?:invalid|wrong|disconnected|failed|expired|checks?|permissions?|settings|cancel|refund)\b/i.test(text);
}
export function supportContractTimingQuestion(text:string){
 return /\b(?:contracts?|agreements?)\b/i.test(text)&&/\b(?:how long|how soon|average|when (?:will|can|do)|timeline|time frame)\b/i.test(text)&&!/\b(?:download|send|save|signing|expired|error|cancel|refund)\b/i.test(text);
}

/** Curated answers for recurring inbox questions. Never turn a feature answer
 * into evidence that this customer's activity, contact or payment is healthy. */
export function supportProductClarification(messages:Turn[]){
 const q=messages.filter(m=>m.role==='user').at(-1)?.content??'';
 if(/\b(?:refund|cancel|charged twice|duplicate charge|payment failed|card declined)\b/i.test(q))return null;
 if(supportLeadImportQuestion(q)){
  const missing=supportMissingSellerContactQuestion(q);
  const otherFailure=/\b(?:bot|calls?|texts?|payments?|contracts?)\b.{0,45}\b(?:not|stopped|missing|failed|broken)\b/i.test(q);
  return {reply:supportLeadImportPolicy+(missing?' A lead can appear before a usable seller number is available. Without a usable number, that contact cannot be called or texted; I haven’t confirmed why the numbers are missing yet.':''),answered:!missing&&!otherFailure};
 }
 if(/\bvip\b/i.test(q)&&/\b(?:need|have to|only|required|upgrade)\b/i.test(q)&&/\b(?:leads?|deals?|contacts?|contact info(?:rmation)?|phone numbers?)\b/i.test(q))return {reply:'VIP is not required for ordinary seller leads, contact lookup, calls or texts. Those are included in Standard bot automation. A usable number or a closed deal is not guaranteed, and upgrading does not fix missing contact details.',answered:!supportMissingSellerContactQuestion(q)};
 if(/\b(?:call|calling)\b/i.test(q)&&/\b(?:held|setup|approved setup|verification)\b/i.test(q)){
  if(/\b(?:how long|when|timeline)\b/i.test(q)&&/\b(?:fix|fixed|repair|approved|resume)\b/i.test(q))return {reply:'I don’t have a verified repair time for the calling issue. Keeping the bot switched on does not confirm that calls can resume. A fix needs to be confirmed by the current call checks and recorded activity; this issue remains open.',answered:false};
  if(/\b(?:was a call|call attempt|see it|see the call|mean|made|completed|happened)\b/i.test(q))return {reply:'A held call job is a request that did not pass its checks; it is not proof that a call reached a seller. It can be blocked before a call or recording exists. I haven’t confirmed a completed call or a repair from that status.',answered:false};
 }
 if(supportContactTimingQuestion(q)&&!supportMissingSellerContactQuestion(q))return {reply:'A lead can appear before a usable seller phone number is available. The bot looks up and checks contact details separately, and a usable number is not guaranteed for every lead. Open the property in Leads to see the contact details saved so far.',answered:true};
 if(supportContractTimingQuestion(q))return {reply:'I don’t have a verified average or a guaranteed timeline for getting a contract. It depends on reaching an interested seller, agreeing on terms, and completing the required checks and signatures. A lead or a sent text does not mean a contract is coming.',answered:! /\b(?:no|none|still|waiting|not|never)\b/i.test(q)};
 if(/\boff[ -]?(?:the )?market\b/i.test(q)&&/\b(?:why|what|leads?|properties|homes?)\b/i.test(q)&&!/\b(?:invalid|wrong|disconnected|failed|missing|not working)\b/i.test(q))return {reply:'Off-market means the home is not publicly listed for sale. iCash X can research those owners as potential seller opportunities. Being on your lead list does not prove an owner wants to sell; that interest has to be established in conversation.',answered:true};
 if(/\b(?:pay|paying|cost|price|charged|included|free)\b/i.test(q)&&/\b(?:minutes?|mins?|dialing|calls?|texts?|outreach|work credits)\b/i.test(q)&&!/\b(?:twice|duplicate|wrong|missing|failed|declined|not working)\b/i.test(q))return {reply:(supportLegacyQuestion(q)?supportLegacyStatus+' ':'')+'The software subscription includes $0 in work credits. In 2.0, property research, calls, texts and other paid AI work use separately purchased prepaid work credits. The two-month software offer does not include those usage costs. I can’t quote a fixed cost per call from this chat.',answered:true};
 return null;
}
