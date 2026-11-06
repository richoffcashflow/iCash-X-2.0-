import {supportLegacyProofEmail} from './support-legacy-migration.ts';
import type {SupportEvidence} from './support-policy.ts';
type Turn={role:string;content:string};
type PurchaseContext={kind:'access'|'account';messages:Turn[];evidence?:SupportEvidence[]};

const accessProblem=(text:string)=>/\b(?:access|sign[ -]?in|log[ -]?in|locked|subscription|membership)\b/i.test(text)&&/\b(?:can[’']?t|cannot|unable|no|not|locked|cancelled|canceled|inactive|failed|needs attention|paid|charged)\b/i.test(text);
const cancellationRequest=(text:string)=>/\b(?:refund|money back|cancel|charged twice|duplicate charge)\b/i.test(text);

/** A fresh settled invoice and inactive access require matching the paid period,
 * not a second checkout. These are explanations only, never entitlement changes. */
export function supportPaidAccessReply(context:PurchaseContext){
 if(context.kind!=='account')return null;
 const users=context.messages.filter(m=>m.role==='user'),q=users.at(-1)?.content??'';
 if(cancellationRequest(q))return null;
 const subscription=context.evidence?.find(e=>e.key==='subscription'&&e.source==='icash_memberships'&&(e.softwareAccess===false||e.softwareAccess===undefined&&e.code==='renewal_payment_failed'));
 const payment=context.evidence?.find(e=>e.key==='membership_payments'&&e.source==='icash_membership_invoices'&&e.status==='ok'&&e.code==='software_payments_recorded'&&/^Recorded software payments: \$\d/.test(e.detail));
 if(!subscription||!payment)return null;
 const observed=Date.parse(payment.observedAt);
 const dates=[...payment.detail.matchAll(/\brecorded ([^;]+? UTC) \(subscription /g)].map(m=>Date.parse(m[1]));
 const recent=Number.isFinite(observed)&&dates.some(date=>Number.isFinite(date)&&observed>=date&&observed-date<=48*60*60*1000);
 const paidNow=/\b(?:just|already|recently) (?:paid|purchased|bought)|\bpaid\b.{0,30}\b(?:today|yesterday|this month|on (?:the )?live)\b/i;
 const paidClaim=paidNow.test(q)||accessProblem(q)&&users.slice(-6,-1).some(m=>paidNow.test(m.content));
 const current=accessProblem(q)||paidNow.test(q)&&users.slice(-6,-1).some(m=>accessProblem(m.content));
 if(!current||!recent&&!paidClaim)return null;
 return {reply:'A software payment is recorded on this account, but the current access check is not confirming access. Cancelling future renewals does not by itself erase an already paid period. Don’t pay again to troubleshoot this; the recorded payment and its access period need to be matched first. Access has not been restored yet.',status:'open' as const,ai:false};
}

/** Legacy VIP and a claimed new VIP purchase are different cases. Neither a
 * customer claim nor an inactive flag proves which product their receipt bought. */
export function supportVipPurchaseReply(context:PurchaseContext){
 let active=false,start=-1;
 const users=context.messages.filter(m=>m.role==='user');
 const receiptAcknowledged=(turn:(typeof users)[number])=>{
  if(!/^(?:yes[, ]+)?i (?:already )?did(?: that)?[.! ]*$/i.test(turn.content.trim()))return false;
  const previous=context.messages.slice(0,context.messages.indexOf(turn)).findLast(m=>m.role==='assistant'||m.role==='operator');
  return !!previous&&/email (?:the|your) VIP purchase receipt|(?:sent|emailed) (?:the|your) VIP purchase receipt/i.test(previous.content);
 };
 for(const [index,turn] of users.entries()){
  const {content}=turn;
  const vip=/\bvip\b|\bask ai bot\b/i.test(content);
  const complaint=/\b(?:paid|purchased|bought|charged|already|missing|locked|transfer|carry|not showing|not recognized|not active)\b/i.test(content);
  const unrelated=/\b(?:leads?|contacts?|phone numbers?|calls?|texts?|course|training|refund|cancel|charged twice|duplicate charge)\b/i.test(content);
  const followup=/^(?:ask ai(?: bot)?(?: vip)?|still (?:not|missing|locked)|it (?:says|shows)|same|yes|no|i (?:already |just )?(?:sent|emailed)|(?:can|could|would) you (?:please )?(?:check|look))\b/i.test(content.trim());
  const next:boolean=!unrelated&&(vip&&complaint||active&&(followup||receiptAcknowledged(turn)));
  if(next&&!active)start=index;
  active=next;
  if(!active)start=-1;
 }
 if(!active)return null;
 const q=users.at(-1)?.content??'';
 if(cancellationRequest(q))return null;
 const vip=context.kind==='account'?context.evidence?.find(e=>e.key==='vip'&&e.source==='icash_vip_features_active'&&e.status==='ok'):undefined;
 const activeUsers=users.slice(start),first=context.messages.indexOf(activeUsers[0]);
 const migration=activeUsers.some(m=>/\b1\.0\b|\b(?:old|original|legacy)\b.{0,30}\bvip\b|\b(?:transfer|carry(?: over)?)\b.{0,45}\b2\.0\b/i.test(m.content));
 const policy='VIP from iCash X 1.0 does not transfer to 2.0. The two-month migration offer covers Standard software access; 2.0 VIP is separate.';
 if(/\b(?:transfer|carry(?: over)?)\b/i.test(q)&&/\b(?:email|account|another person)\b/i.test(q)&&!migration)return {reply:`Moving a VIP purchase to another sign-in requires a purchase-ownership check. This chat has not moved VIP access. Email the VIP purchase receipt to ${supportLegacyProofEmail} with the original purchase email and intended sign-in email so the request can be verified. Don’t buy VIP again to change an email.`,status:'waiting_on_customer' as const,ai:false};
 if(migration&&/\b(?:transfer|carry(?: over)?)\b/i.test(q)&&!/\b(?:not showing|missing|locked)\b/i.test(q))return {reply:policy+(vip?.code==='vip_active'?' Your current 2.0 account does have VIP active.':''),status:'resolved' as const,ai:false};
 if(vip?.code==='vip_active')return {reply:'Your current 2.0 account has VIP active, so you do not need to buy it again. Open Ask AI Bot beside Your leads. If it still shows an upgrade screen, that access mismatch remains unresolved here.',status:'open' as const,ai:false};
 const prefix=vip?.code==='vip_inactive'?'VIP is not active on this 2.0 account. ':'I haven’t confirmed 2.0 VIP access yet. ';
 const sent=activeUsers.some(receiptAcknowledged)||activeUsers.some(m=>/\b(?:sent|emailed|submitted)\b.{0,40}\b(?:vip|receipt)|\b(?:vip|receipt)\b.{0,35}\b(?:sent|emailed|submitted)\b|^(?:i (?:have |already |just )?)?(?:sent|emailed|submitted) it\b/i.test(m.content)&&!/\b(?:not|never|haven[’']t|didn[’']t)\b/i.test(m.content));
 const asked=context.messages.slice(first).some(m=>m.role!=='user'&&/VIP purchase receipt/i.test(m.content));
 const next=sent?'You’ve said you sent the receipt. I haven’t confirmed that the VIP purchase has been matched yet; you do not need to send the same receipt again.':asked?'The receipt requested above is still needed to verify that VIP purchase.':`Email the VIP purchase receipt to ${supportLegacyProofEmail} so its product and account can be verified.`;
 return {reply:prefix+(migration?policy+' ':'')+'If your payment was specifically for 2.0 VIP, don’t buy it again before that purchase is verified. '+next,status:sent?'open' as const:'waiting_on_customer' as const,ai:false};
}

/** Purchase and checkout problems are not proof that a sign-in code arrived. */
export function supportPurchaseHelp(messages:Turn[]){
 const users=messages.filter(m=>m.role==='user'),q=users.at(-1)?.content??'';
 if(/\b(?:refund|cancel|charged twice|duplicate charge|new card)\b/i.test(q))return null;
 const checkout=/\b(?:checkout|check out|two[ -]month|2[ -]month|free (?:trial|offer))\b/i;
 const failed=/\b(?:failed|not go through|didn[’']?t go through|did not go through|doesn[’']?t work|does not work|not work|doesn[’']?t let|error|declined|not completed|won[’']?t)\b/i;
 const previous=users.slice(0,-1).findLast(m=>checkout.test(m.content)&&failed.test(m.content));
 const hasReceipt=users.some(m=>/\b(?:checkout|offer)\b.{0,35}\b(?:completed|successful|confirmed)\b/i.test(m.content)&&!/\b(?:not|never|isn[’']t)\b/i.test(m.content));
 if(checkout.test(q)&&failed.test(q)||previous&&!hasReceipt&&/\b(?:sign[ -]?in|log[ -]?in|email on file|same error|still not)\b/i.test(q)){
  const asked=messages.some(m=>m.role!=='user'&&/exact message.*checkout/i.test(m.content));
  return {reply:asked?'The offer checkout has not been confirmed as complete. I can’t establish an active subscription or a code-delivery problem from that error. Your earlier details are saved; don’t submit another payment to troubleshoot this.':'The offer checkout needs to complete before it can grant software access. What exact message appears on the checkout page when it fails? Please leave out payment details; don’t submit another payment to troubleshoot this.',status:asked?'open' as const:'waiting_on_customer' as const};
 }
 const wrongEmail=/\b(?:wrong|incorrect|typo|misspelled|correct|change|update)\b.{0,35}\b(?:checkout |purchase |sign[ -]?in )?email\b|\bemail\b.{0,35}\b(?:wrong|incorrect|typo|misspelled|corrected)\b/i;
 if(wrongEmail.test(q)&&!/\b(?:seller|buyer|bot|contact|settings)\b/i.test(q)){
  const requested=messages.some(m=>m.role!=='user'&&/\b(?:receipt|purchase)\b.{0,100}\b(?:email|correction|correct|verify|match)\b/i.test(m.content));
  return {reply:requested?'The purchase needs to be matched and ownership verified before its checkout email can be corrected. Your earlier proof details are already in this conversation. I haven’t confirmed an email change or restored access; repeating code requests won’t correct a wrong email.':`A wrong checkout email needs a purchase-ownership check before it can be corrected. Email your merchant receipt to ${supportLegacyProofEmail} with the purchase date, amount, order reference if available, and the email you intended to use. This chat has not changed the email; don’t pay again or share sign-in codes.`,status:requested?'open' as const:'waiting_on_customer' as const};
 }
 return null;
}
