import {supportLegacyQuestion,supportLegacyStatus} from './support-legacy-migration.ts';
import {supportLeadImportPolicy,supportLeadImportQuestion,supportMissingSellerContactQuestion} from './support-lead-policy.ts';
import {cashOfferPolicy} from './cash-offer-math.ts';
import {supportRoleQuestion} from './support-product-guide.ts';
type Turn={role:string;content:string};
const dollars=(cents:number)=>(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

/** App capabilities are source-backed answers, not account activity or authority
 * to change an offer, deliver a document or spend the customer's money. */
function capabilityAnswer(question:string):string|null{
 const q=question.replace(/\bassingment\b/gi,'assignment').replace(/\bdollarsfor\b/gi,'dollars for');
 // Keep actual faults and disputed charges in diagnostics, even when the same
 // message contains a familiar product term or dollar amount.
 if(/\b(?:refund|cancel|billed|charged|duplicate|declined|failed|error|broken|missing|stuck|not working|not calling|not texting|not sending|not received|no calls|no texts|no repl(?:y|ies)|no response|never calls|never sends)\b|\b(?:can[’']?t|cannot|won[’']?t|doesn[’']?t|didn[’']?t|haven[’']?t|will not|does not|did not|have not)\b.{0,30}\b(?:save|send|download|open|load|work|call|text|receive[ds]?|respond(?:ed)?)\b/i.test(q))return null;
 if(!/\bvip\b/i.test(q)&&/\b(?:subscription|membership|monthly payment|monthly fee)\b/i.test(q)&&/\b(?:what(?:[’']s| is| does)|cover|include)\b/i.test(q)&&!/\b(?:my|charged|billed|ended|expired|inactive|cancelled|canceled|access|working)\b/i.test(q))return 'The software subscription pays for access to iCash X and its bot features. Property research, contact lookup, calls, texts and other paid AI work use separately purchased work credits; the subscription includes $0 in work credits. An account’s actual payment or access status needs its own recorded check.';
 if(/\b(?:company|business|name)\b/i.test(q)&&/\b(?:say|use|tell|coming from|introduce|represent)\b/i.test(q)&&/\b(?:leads?|sellers?|buyers?|talking|speaking|calling|introduce|represent)\b/i.test(q))return 'Use the individual or company name you saved in Settings. You’re representing yourself or your business as the buyer; iCash X is the software you use to work the deal.';
 const planPayment=/\b(?:subscription|membership|monthly|per month|vip|upgrade)\b/i.test(q)&&!/\b(?:credits?|usage|add money|adding money)\b/i.test(q);
 const usage=!planPayment&&/\b(?:credits?|usage|add money|adding money|add(?:ed)? \d+ dollars|put \d+ dollars|\d+ dollars|dollars for)\b|\$\s*\d+/i.test(q);
 if(/\b(?:how much|cost|price|pricing)\b/i.test(q)&&/\bcredits?\b/i.test(q)&&!/\b(?:have|left|remaining|available|spent|used|leads?|calls?|texts?)\b/i.test(q))return 'Work credits are a prepaid dollar balance for the bot’s paid work. Open Add money to choose an amount; the purchase summary shows the price and amount added to credits before checkout. There is no fixed number of leads or calls per top-up.';
 if(usage&&/\b(?:how many|how much|number of)\b.{0,45}\b(?:leads?|calls?|texts?|deals?)\b|\bhow long\b.{0,50}\b(?:last|run|work)\b/i.test(q))return 'There isn’t a fixed number of leads, calls or texts for a credit amount. Work credits pay for property research, contact lookup, calls, texts and other paid AI work, so how long they last depends on the work completed. Adding money does not guarantee a lead or a deal.';
 if((usage&&/\b(?:what(?:[’']s| is| are)?|for|cover|mean|used)\b/i.test(q)&&!/\b(?:left|remaining|available|balance|have)\b/i.test(q))||/\bwhy\b.{0,25}\b(?:have to|need to|must)\b.{0,15}\badd money\b/i.test(q))return 'Added money becomes prepaid work credits for property research, contact lookup, calls, texts and other paid AI work. It is separate from the software subscription; the subscription and two-month software offer include $0 in work credits. Usage varies with the work completed.';
 if(/\b(?:assignment|wholesale) fee\b/i.test(q)){
  if(/\b(?:how much|amount|calculate|calculated|70%|70 percent)\b/i.test(q))return `The default target wholesale fee is ${dollars(cashOfferPolicy.standardFeeCents)} below ${dollars(cashOfferPolicy.largeDealArvCents)} ARV and ${dollars(cashOfferPolicy.largeDealFeeCents)} at or above it. Open the property’s Offer calculation to see its target fee. The final buyer assignment must match the supported deal terms; a target fee is not confirmed earnings.`;
  if(/\b(?:call|phone|ai)\b/i.test(q))return 'The target assignment fee is part of the offer calculation before a seller offer is made. The AI can call sellers, but it presents the supported cash purchase offer rather than your fee as a seller charge. Your fee is recorded in the buyer assignment agreement; the buyer price includes it, with buyer closing costs separate.';
  if(/\b(?:where|when|how|what|who|shown|show|included|presented|receive|get|paid)\b/i.test(q))return 'Your assignment fee is recorded in the buyer assignment agreement, separate from the seller purchase agreement. The buyer price includes that fee; buyer closing costs are additional. Review it in the property’s Agreements section. Any cleared deposit is credited toward the fee, and the remaining proceeds depend on completed closing and disbursement.';
 }
 if(/\b(?:buyer|buyers|assignment)\b/i.test(q)&&/\b(?:purchase agreement|agreement|contract|document)\b/i.test(q)&&/\b(?:how|where|obtain|get|find|prepare|send|download|sign)\b/i.test(q))return 'The cash buyer signs an assignment agreement; the purchase agreement is with the seller. Open the property under Your leads, then Agreements. The assignment draft becomes available after the purchase agreement is signed. Review it with Edit agreement or Download assignment draft, then use Send for signatures for the required signers.';
 if(/\b(?:title company|title|closing office)\b/i.test(q)&&/\b(?:phone|calls?|calling)\b/i.test(q))return 'Title coordination uses email, not AI phone calls to the title company. After you select and verify the closer in the property’s Closing section and the required agreements are signed, the system can email the documents and follow up. Review title replies and complete any identity, payment or signing requests yourself.';
 if(/\b(?:title company|title|closing office)\b/i.test(q)&&/\b(?:send|submit|submission|email|deliver|forward|manual|manually|automatic|automatically|contact|handle)\b/i.test(q))return 'You can handle title submission in the app. In the property’s Closing section, select and verify the closer and complete the closing setup. The system can email the signed purchase agreement and any completed buyer assignment, then follow up with title. A sent request does not mean title has accepted the file; check the recorded reply.';
 if(/\b(?:buyer|buyers)\b/i.test(q)&&/\b(?:find|contact|reach|call|calls|calling|phone|text|email)\b/i.test(q)&&/\b(?:ai|bot|icash|2\.0|how|does|will|can)\b/i.test(q))return 'After the required purchase signatures and checks, the bot can find eligible cash buyers and contact them by text and email with the buyer package. It does not make outbound AI calls to buyers; incoming buyer calls can be handled by AI. Open the property’s Buyers section to review matches, replies and next steps.';
 if(/\b(?:ai|bot)\b/i.test(q)&&/\b(?:calls?|calling|phone)\b/i.test(q)&&/\b(?:seller|sellers|leads)\b/i.test(q)&&/\b(?:does|will|can|automatic|automatically)\b/i.test(q)&&!/\b(?:when|time|hours)\b/i.test(q))return 'Yes, the bot can make eligible seller calls and handle seller text conversations automatically. Open the property’s calls and texts to see what has actually happened; the feature alone does not confirm a particular seller was reached.';
 if(/\bdeal\s*machine\b/i.test(q)&&/\b(?:use|uses|using|automatic|automatically|research|data|pull)\b/i.test(q))return 'Yes. iCash X 2.0 uses DealMachine for automatic property research and owner-contact lookup. You do not need to pull or upload those leads yourself. That describes the feature; it does not confirm that a particular account’s latest research completed.';
 if(/\b(?:cash offer|offer price|generated offer)\b/i.test(q)&&/\b(?:adjust|adjusted|change|changed|edit|final|negotiate|negotiable)\b/i.test(q))return 'The displayed cash offer is a calculated ceiling, not a signed agreement. The bot can negotiate within the supported price, and changed property information can affect the calculation. To edit an unsigned agreement yourself, take over the property and use Agreements → Edit agreement. Already-signed terms require an amendment; editing a draft does not change them.';
 if(/\b(?:arv|value after repairs|offer calculation|cash offer)\b/i.test(q)&&/\b(?:details|breakdown|calculate|calculated|calculation|70%|70 percent|how|where|show|see|estimate)\b/i.test(q)){
  if(/\bbuyers?\b/i.test(q)&&/\b(?:send|share|tell|give)\b/i.test(q))return 'The buyer package can show the saved research ARV and repair estimates. Open Buyers on the property and choose View buyer package to review what the buyer will see; eligible buyer outreach can share that package. These are research estimates, not a guaranteed resale value or an inspection.';
  return `Open the property to see Value after repairs, Estimated repairs and Offer calculation. The current cash-offer formula is (ARV − repairs) × ${cashOfferPolicy.ruleBasisPoints/100}% − wholesale fee, and the calculation shows the target fee. These are research estimates to review, not guaranteed value or profit.`;
 }
 if(/\b(?:arv|value after repairs)\b/i.test(q)&&/\bbuyers?\b/i.test(q)&&/\b(?:send|share|tell|give)\b/i.test(q))return 'The buyer package can show the saved research ARV and repair estimates, and AI can explain available estimates to an incoming buyer. Open Buyers → View buyer package to review the information. These are estimates, not a guaranteed resale value or an inspection.';
 return null;
}

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
 // Preserve the established role answer before
 // matching incidental words such as "send contracts to title" in a recap.
 if(supportRoleQuestion(q))return null;
 if(/\b(?:arv|value after repairs)\b/i.test(q)&&/\bthem\b/i.test(q)&&/\b(?:send|share|tell|give)\b/i.test(q)&&!/\b(?:buyers?|sellers?|failed|error|missing|not|never)\b/i.test(q)){
  const previous=messages.filter(m=>m.role==='user').slice(0,-1).at(-1)?.content??'';
  if(/\bbuyers?\b/i.test(previous)&&!/\bsellers?\b/i.test(previous))return {reply:capabilityAnswer(q.replace(/\bthem\b/i,'buyers'))!,answered:true};
  return {reply:'Do you mean sharing the ARV estimate with the seller or with a cash buyer?',answered:false};
 }
 const capability=capabilityAnswer(q);if(capability)return {reply:capability,answered:true};
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
