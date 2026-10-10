import type Stripe from 'stripe';
import {db} from '@/lib/stripe-test';
import {fundingStripe} from '@/lib/funding';
import {fundingMode} from '@/lib/funding-policy';
import {summarizeDispute,referenceId,disputeGuidance,disputeMoney,disputeTime,paymentIdPattern,type EvidencePacket,type EvidenceSection} from './disputes.ts';
type Row=Record<string,unknown>;
const value=(v:unknown)=>typeof v==='string'?v:typeof v==='number'||typeof v==='boolean'?String(v):'Not recorded';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v);
const text=(v:unknown)=>typeof v==='string'?v:null;
const date=(v:unknown)=>disputeTime(text(v));
async function rows(path:string,signal?:AbortSignal){const result=await db<unknown>(path,'GET',undefined,signal);if(!Array.isArray(result)||result.some(r=>!r||typeof r!=='object'))throw Error('Incomplete billing evidence');return result as Row[];}
export async function recordDisputeEvent(event:Stripe.Event){
 if(!event.type.startsWith('charge.dispute.'))return;
 const d=event.data.object as Stripe.Dispute,summary=summarizeDispute(d);
 await db('rpc/icash_record_dispute_event','POST',{p_event:{eventId:event.id,disputeId:d.id,mode:d.livemode?'live':'test',paymentId:summary.paymentId,chargeId:summary.chargeId,eventType:event.type,status:d.status,reason:d.reason,amountCents:d.amount,currency:d.currency,dueAt:summary.dueAt,createdAt:new Date(event.created*1000).toISOString()}});
}
export async function listDisputes(cursor?:string){
 const mode=fundingMode();if(!mode)throw Error('Billing is not connected');
 const result=await fundingStripe().disputes.list({limit:50,...(cursor?{starting_after:cursor}:{})});
 if(result.data.some(d=>d.livemode!==(mode==='live')))throw Error('Dispute mode mismatch');
 return {mode,disputes:result.data.map(summarizeDispute),nextCursor:result.has_more?result.data.at(-1)?.id??null:null,checkedAt:new Date().toISOString()};
}
export async function prepareDisputeEvidence(id:string,signal?:AbortSignal):Promise<EvidencePacket>{
 const stripe=fundingStripe(),d=await stripe.disputes.retrieve(id),mode=fundingMode();
 if(d.id!==id||!mode||d.livemode!==(mode==='live'))throw Error('Dispute binding mismatch');
 const charge=await stripe.charges.retrieve(referenceId(d.charge)!);
 if(charge.livemode!==d.livemode||charge.id!==referenceId(d.charge)||referenceId(charge.payment_intent)!==referenceId(d.payment_intent))throw Error('Charge binding mismatch');
 const payment=referenceId(d.payment_intent),card=charge.payment_method_details?.card;
 const gaps:string[]=[],sections:EvidenceSection[]=[];
 const from=new Date(charge.created*1000).toISOString(),until=new Date().toISOString();
 const packet:EvidencePacket={dispute:summarizeDispute(d),generatedAt:until,customer:charge.billing_details.email??charge.billing_details.name??payment??d.id,guidance:disputeGuidance(d.reason),gaps,sections};
 sections.push({title:'Stripe payment record',lines:[`Payment: ${payment??'Not provided'} | Charge: ${charge.id}`,`Paid: ${disputeMoney(charge.amount,charge.currency)} | Refunded: ${disputeMoney(charge.amount_refunded,charge.currency)} | Status: ${charge.status}`,`Payment created: ${disputeTime(from)}`,`Customer name: ${charge.billing_details.name??'Not recorded'} | Email: ${charge.billing_details.email??'Not recorded'}`,`Card: ${card?`${card.brand} ending ${card.last4}`:'Not recorded'}`,`Address check: ${card?.checks?.address_line1_check??'Not recorded'} | Postal check: ${card?.checks?.address_postal_code_check??'Not recorded'} | CVC check: ${card?.checks?.cvc_check??'Not recorded'}`,`3D Secure result: ${card?.three_d_secure?.result??'Not recorded'}`,`Receipt number: ${charge.receipt_number??'Not recorded'}. This payment record does not establish that an email receipt was delivered.`]});
 if(!payment||!paymentIdPattern.test(payment)){gaps.push('The dispute has no supported payment reference. Review its Stripe records manually.');return packet;}
 const [orders,invoices,changes]=await Promise.all([
  rows(`icash_funding_orders?stripe_payment_id=eq.${payment}&mode=eq.${mode}&select=id,account_id,state,price_cents,credit_cents,paid_at,credited_at,prepaid_applied_at,daily_plan_id,payer_email,auto_recharge&limit=2`,signal),
  rows(`icash_membership_invoices?stripe_payment_id=eq.${payment}&select=membership_id,amount_cents,period_end,recorded_at,stripe_invoice_id&limit=2`,signal),
  rows(`icash_plan_changes?payment_id=eq.${payment}&select=id,membership_id,account_id,action,state,applied_at,period_end,from_price,to_price&limit=2`,signal)
 ]);
 if(orders.length+invoices.length+changes.length!==1){gaps.push('Payment is not uniquely linked to an iCash purchase. No account records were attached.');return packet;}
 const references:string[]=[],historic:EvidenceSection[]=[];
 let accountId:unknown,serviceEnd=until;
 if(orders.length){const o=orders[0];accountId=o.account_id;references.push(value(o.id));
  sections.push({title:'Work-credit delivery',lines:[`Order: ${value(o.id)} | State: ${value(o.state)}`,`Purchased credits: ${typeof o.credit_cents==='number'?disputeMoney(o.credit_cents):'Not recorded'}`,`Payment confirmed: ${date(o.paid_at)} | Credits posted: ${date(o.credited_at)}`,`Prepaid activation: ${date(o.prepaid_applied_at)}`]});
  if(!o.credited_at)gaps.push('No credit-posting timestamp is recorded for this order.');
  const [legacy,attempts]=await Promise.all([rows(`icash_funding_consents?order_id=eq.${value(o.id)}&select=version,terms_text,accepted_at&order=accepted_at.asc&limit=10`,signal),rows(`icash_auto_recharge_attempts?order_id=eq.${value(o.id)}&mode=eq.${mode}&select=approved_order&limit=2`,signal)]);
  for(const l of legacy)historic.push({title:'Original credit purchase terms',lines:[`Accepted: ${date(l.accepted_at)} | Version: ${value(l.version)}`,value(l.terms_text)]});
  if(attempts.length===1&&uuid(attempts[0].approved_order)){references.push(attempts[0].approved_order);sections.push({title:'Automatic recharge authorization',lines:[`Original opt-in order: ${attempts[0].approved_order}. This charge was a subsequent automatic refill, not a new checkout.`]});const prior=await rows(`icash_funding_consents?order_id=eq.${attempts[0].approved_order}&select=version,terms_text,accepted_at&order=accepted_at.asc&limit=10`,signal);for(const l of prior)historic.push({title:'Original auto recharge terms',lines:[`Accepted: ${date(l.accepted_at)} | Version: ${value(l.version)}`,value(l.terms_text)]});}
  if(uuid(o.daily_plan_id)){const plans=await rows(`icash_daily_plans?id=eq.${o.daily_plan_id}&mode=eq.${mode}&select=consent_version,consent_text,created_at&limit=1`,signal);for(const p of plans)historic.push({title:'Original daily plan terms',lines:[`Plan created: ${date(p.created_at)} | Version: ${value(p.consent_version)}`,value(p.consent_text)]});gaps.push('For a legacy daily plan, verify the effective price and any budget changes against the disputed invoice in Stripe.');}
 }else{
  const source=invoices[0]??changes[0],memberId=source.membership_id;
  if(!uuid(memberId))throw Error('Membership reference unavailable');
  const members=await rows(`icash_memberships?id=eq.${memberId}&mode=eq.${mode}&select=id,account_id,state,consent_version,consent_text,created_at,paid_through,cancel_at_period_end,retention_requested_at,retention_started_at,retention_ends_at&limit=1`,signal);
  if(members.length!==1){gaps.push('No membership in this Stripe mode is linked to the payment.');return packet;}
  const m=members[0];accountId=m.account_id;references.push(memberId);
  const priorUpgrades=await rows(`icash_plan_changes?membership_id=eq.${memberId}&action=eq.upgrade&state=eq.applied&applied_at=lt.${encodeURIComponent(new Date((charge.created+1)*1000).toISOString())}&select=id&order=applied_at.asc&limit=20`,signal);
  for(const upgrade of priorUpgrades)if(uuid(upgrade.id))references.push(upgrade.id);
  if(changes.length)references.push(value(changes[0].id));
  const end=text(source.period_end);if(end&&Date.parse(end)<Date.parse(until))serviceEnd=end;
  sections.push({title:changes.length?'VIP upgrade delivery':'Software subscription',lines:[`Membership: ${memberId} | Current state: ${value(m.state)}`,`Invoice/upgrade: ${value(source.stripe_invoice_id??source.id)} | Paid period ends: ${date(source.period_end)}`,...(changes.length?[`Upgrade state: ${value(source.state)} | Applied: ${date(source.applied_at)}`]:[]),`Cancellation at period end: ${value(m.cancel_at_period_end)}`,`Retention requested: ${date(m.retention_requested_at)} | Discount starts: ${date(m.retention_started_at)} | Ends: ${date(m.retention_ends_at)}`]});
  if(changes.length&&!source.applied_at)gaps.push('No applied timestamp is recorded for the disputed VIP upgrade.');
  historic.push({title:'Original membership terms',lines:[`Membership created: ${date(m.created_at)} | Version: ${value(m.consent_version)}`,value(m.consent_text)]});
 }
 if(references.some(id=>!uuid(id)))throw Error('Invalid purchase reference');
 const accepted=await rows(`icash_purchase_acceptances?reference_id=in.(${references.join(',')})&mode=eq.${mode}&accepted_at=lt.${encodeURIComponent(new Date((charge.created+1)*1000).toISOString())}&select=kind,reference_id,version,terms_text,policy_version,policy_text,amount_cents,accepted_at,request_context&order=accepted_at.asc&limit=20`,signal);
 for(const a of accepted){const context=a.request_context as Row|undefined;sections.push({title:'Recorded purchase acceptance',lines:[`Purchase: ${value(a.kind)} ${value(a.reference_id)}`,`Accepted: ${date(a.accepted_at)} | Amount: ${typeof a.amount_cents==='number'?disputeMoney(a.amount_cents):'Not recorded'}`,`Terms version: ${value(a.version)} | Policy version: ${value(a.policy_version)}`,value(a.terms_text),`Purchase IP: ${value(context?.ip)} | Browser: ${value(context?.userAgent)}`,`Acceptance request: ${value(context?.path)}`]});}
 if(!accepted.length){gaps.push('No new final-sale acceptance receipt predates this payment. Use only the historical terms shown below; do not apply the current policy retroactively.');sections.push(...historic);}
 else if(accepted.length===20)gaps.push('Acceptance history reached the 20-record limit; review the complete purchase history.');
 if(!uuid(accountId)){gaps.push('Purchase has not been claimed by an account; no account activity is attached.');return packet;}
 const scope=`account_id=eq.${accountId}`,time=`created_at=gte.${encodeURIComponent(from)}&created_at=lte.${encodeURIComponent(until)}`;
 const [usage,access,support,cancellations]=await Promise.all([
  rows(`icash_operation_spend?${scope}&state=eq.settled&settled_at=gte.${encodeURIComponent(from)}&settled_at=lte.${encodeURIComponent(serviceEnd)}&select=operation_key,charged_cents,dispatched_at,settled_at&order=settled_at.asc&limit=26`,signal),
  rows(`icash_software_access_receipts?${scope}&recorded_at=gte.${encodeURIComponent(from)}&recorded_at=lte.${encodeURIComponent(serviceEnd)}&select=recorded_at,request_context&order=recorded_at.asc&limit=11`,signal),
  rows(`icash_support_messages?${scope}&${time}&select=role,content,created_at&order=created_at.desc&limit=11`,signal),
  rows(`icash_support_cancel_requests?${scope}&mode=eq.${mode}&select=source,state,created_at,confirmed_at,updated_at,result&order=created_at.desc&limit=11`,signal)
 ]);
 sections.push({title:'Completed account usage',lines:[`Account: ${accountId}. Activity from payment through ${disputeTime(serviceEnd)}. These are account-level service records; individual work credits are pooled and are not attributed to a specific top-up.`,...usage.slice(0,25).map(u=>`${date(u.settled_at)} | ${value(u.operation_key)} | Usage charged: ${typeof u.charged_cents==='number'?disputeMoney(u.charged_cents):'Not recorded'}`)]});
 if(!usage.length)gaps.push('No completed account usage was found in this evidence period.');if(usage.length>25)gaps.push('Usage lists the first 25 completed operations; additional account activity exists.');
 sections.push({title:'Authenticated workspace access',lines:['At most one authenticated account request is recorded per hour. A request can be a background refresh; this is not proof of a human click or cardholder identity.',...access.slice(0,10).map(a=>`${date(a.recorded_at)} | IP: ${value((a.request_context as Row)?.ip)} | Browser: ${value((a.request_context as Row)?.userAgent)}`)]});
 if(!access.length)gaps.push('No retained workspace-access receipts were found for this period.');if(access.length>10)gaps.push('Access evidence lists the first 10 hourly receipts; additional receipts exist.');
 sections.push({title:'Customer support excerpts',lines:support.slice(0,10).reverse().map(s=>`${date(s.created_at)} | ${value(s.role)}: ${value(s.content).slice(0,1200)}${value(s.content).length>1200?' [excerpt ends]':''}`)});
 if(!support.length)gaps.push('No support messages after this payment are recorded in the app. Add relevant external customer communications if available.');if(support.length>10||support.some(s=>value(s.content).length>1200))gaps.push('Support evidence contains excerpts. Review the complete conversation and attach relevant missing context before submitting.');
 sections.push({title:'Recorded cancellation requests',lines:cancellations.slice(0,10).map(c=>`Requested: ${date(c.created_at)} | Source: ${value(c.source)} | State: ${value(c.state)} | Confirmed: ${date(c.confirmed_at)} | ${value(c.result)}`)});
 gaps.push('Review customer claims, external communications and any billing-portal cancellation in Stripe. Missing app records do not prove no cancellation was requested.');
 return packet;
}
