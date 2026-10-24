import {z} from 'zod';
import type {SupportEvidence} from './support-policy.ts';
import {supportOutreachSchema} from './support-outreach.ts';
import {courseProgressSchema} from './course-progress.ts';
import {disputeMoney,disputeTime,type EvidenceSection} from './disputes.ts';

type Database=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
const timestamp=z.string().datetime({offset:true});
const reference=z.string().min(1).max(250).regex(/^[a-zA-Z0-9_-]+$/);
const money=z.number().int().nonnegative().safe();
const section=z.object({title:z.string().max(120),lines:z.array(z.string().max(2000)).max(15)});
export const refundCaseSchema=z.object({
 version:z.literal(1),accountId:z.guid(),threadId:z.guid(),requestId:z.guid(),
 preparedAt:timestamp,mode:z.enum(['live','test']).nullable(),policyAcceptanceRecorded:z.boolean(),
 sections:z.array(section).max(12),gaps:z.array(z.string().max(300)).max(20),
});
export type SupportRefundCase=z.infer<typeof refundCaseSchema>;

/** Short customer wording comes only from the current, authenticated account's checks. */
export function refundDeliverySummary(evidence:SupportEvidence[]){
 const facts:string[]=[];
 const outreach=supportOutreachSchema.safeParse(evidence.find(e=>e.key==='outreach'&&e.status!=='unknown')?.outreach);
 if(outreach.success){
  const o=outreach.data;
  if(o.outboundProperties>0)facts.push(`${o.outboundProperties} researched ${o.outboundProperties===1?'property':'properties'}`);
  if(o.inboundProperties>0)facts.push(`${o.inboundProperties} incoming seller ${o.inboundProperties===1?'lead':'leads'}`);
 }
 const course=courseProgressSchema.safeParse(evidence.find(e=>e.key==='course')?.course);
 const access=evidence.some(e=>e.key==='subscription'&&e.softwareAccess===true);
 if(course.success&&course.data.state!=='unavailable'&&access)facts.push('course access');
 else if(course.success&&['in_progress','completed'].includes(course.data.state))facts.push('recorded course playback');
 if(access)facts.push('access to the AI software');
 return facts.length?'Your account records show '+facts.join(', ')+'.':'';
}

/** Private, bounded snapshot. No Stripe write, provider call, customer identity guess or new charge. */
export async function prepareSupportRefundEvidence(db:Database,binding:{accountId:string;threadId:string;requestId:string},evidence:SupportEvidence[],mode:'live'|'test'|null):Promise<SupportEvidence>{
 const ids=z.object({accountId:z.guid(),threadId:z.guid(),requestId:z.guid()}).parse(binding);
 const preparedAt=new Date().toISOString(),gaps:string[]=[],sections:EvidenceSection[]=[];
 const scope=`account_id=eq.${ids.accountId}`,signal=AbortSignal.timeout(6000);
 async function read<T>(title:string,path:string,schema:z.ZodType<T>):Promise<T[]>{
  try{
   const values=z.array(schema).max(6).parse(await db(path,'GET',undefined,signal));
   if(values.length>5)gaps.push(`${title}: only the five latest records are included; older records exist.`);
   if(!values.length)gaps.push(`${title}: no records found in this selection.`);
   return values.slice(0,5);
  }catch{gaps.push(`${title}: records could not be verified.`);return [];}
 }
 const membership=z.object({id:z.guid(),account_id:z.literal(ids.accountId),mode:z.literal(mode??'live')});
 const order=z.object({id:z.guid(),account_id:z.literal(ids.accountId),mode:z.literal(mode??'live'),stripe_payment_id:reference.nullable(),price_cents:money,paid_at:timestamp,credited_at:timestamp.nullable()});
 const [members,orders,access,usage]=await Promise.all([
  mode?read('Membership links',`icash_memberships?${scope}&mode=eq.${mode}&select=id,account_id,mode&order=created_at.desc&limit=6`,membership):[],
  mode?read('Credit purchases',`icash_funding_orders?${scope}&mode=eq.${mode}&state=eq.paid&select=id,account_id,mode,stripe_payment_id,price_cents,paid_at,credited_at&order=paid_at.desc&limit=6`,order):[],
  read('Workspace access',`icash_software_access_receipts?${scope}&select=recorded_at&order=recorded_at.desc&limit=6`,z.object({recorded_at:timestamp})),
  read('Completed usage',`icash_operation_spend?${scope}&state=eq.settled&select=operation_key,charged_cents,settled_at&order=settled_at.desc&limit=6`,z.object({operation_key:z.string().max(300),charged_cents:money,settled_at:timestamp})),
 ]);
 if(!mode)gaps.push('Billing mode could not be verified; no purchase or acceptance claims are made.');
 const references=[...members.map(m=>m.id),...orders.map(o=>o.id)];
 const [invoices,acceptances]=await Promise.all([
  members.length?read('Software payments',`icash_membership_invoices?membership_id=in.(${members.map(m=>m.id).join(',')})&select=membership_id,stripe_invoice_id,stripe_payment_id,amount_cents,recorded_at&order=recorded_at.desc&limit=6`,z.object({membership_id:z.string().refine(id=>members.some(m=>m.id===id)),stripe_invoice_id:reference,stripe_payment_id:reference.nullable(),amount_cents:money,recorded_at:timestamp})):[],
  references.length&&mode?read('Purchase acceptance',`icash_purchase_acceptances?reference_id=in.(${references.join(',')})&mode=eq.${mode}&select=kind,reference_id,version,policy_version,policy_text,accepted_at&order=accepted_at.desc&limit=6`,z.object({kind:z.enum(['membership','credits']),reference_id:z.string().refine(id=>references.includes(id)),version:z.string().max(120),policy_version:z.string().max(120),policy_text:z.string().max(8000),accepted_at:timestamp})):[],
 ]);
 // Receipt must predate a confirmed purchase of the same kind/reference. A new
 // policy acceptance never rewrites an older payment's accepted terms.
 const accepted=acceptances.filter(a=>a.kind==='membership'
  ?invoices.some(i=>i.membership_id===a.reference_id&&i.amount_cents>0&&Date.parse(a.accepted_at)<=Date.parse(i.recorded_at))
  :orders.some(o=>o.id===a.reference_id&&o.price_cents>0&&Date.parse(a.accepted_at)<=Date.parse(o.paid_at)));
 const policyAcceptanceRecorded=mode==='live'&&accepted.some(a=>/all sales are final/i.test(a.policy_text));
 if(!policyAcceptanceRecorded)gaps.push('No verified live final-sale acceptance tied to a paid purchase was found. Do not say the customer agreed.');
 sections.push({title:'Scope and review',lines:[`Account-level snapshot prepared ${disputeTime(preparedAt)}. Billing mode: ${mode??'unverified'}.`,
  'Not submitted to Stripe. Match the disputed payment and service period before using these records. Lifetime activity does not establish delivery for a particular payment.',
  'Keep the customer complaint and full conversation. Policy acceptance or abusive language does not establish authorization, delivery, or that a dispute is invalid.']});
 sections.push({title:'Purchase references',lines:[...invoices.map(i=>`${i.stripe_invoice_id} | Payment: ${i.stripe_payment_id??'not recorded'} | ${disputeMoney(i.amount_cents)} | Recorded ${disputeTime(i.recorded_at)}`),...orders.map(o=>`Credit order ${o.id} | Payment: ${o.stripe_payment_id??'not recorded'} | ${disputeMoney(o.price_cents)} | Paid ${disputeTime(o.paid_at)} | Credits posted ${disputeTime(o.credited_at)}`)]});
 sections.push({title:'Accepted policy records',lines:accepted.map(a=>`${a.kind} ${a.reference_id} | Accepted ${disputeTime(a.accepted_at)} | Terms ${a.version} | Policy ${a.policy_version}. ${a.policy_text.length<=1200?a.policy_text:'Full policy retained in the original immutable purchase receipt; use that text.'}`)});
 sections.push({title:'Recorded service delivery',lines:[
  'Property/outreach counts exclude archived and practice properties. Course progress refers to the current video revision. These are current account records, not a specific payment-period total.',
  ...(refundDeliverySummary(evidence)?[refundDeliverySummary(evidence)]:[]),
  ...evidence.filter(e=>['outreach','course','subscription'].includes(e.key)).map(e=>`${disputeTime(e.observedAt)} | ${e.status}: ${e.detail}`)]});
 sections.push({title:'Authenticated access receipts',lines:['These are authenticated account requests, including possible background refreshes; they do not prove cardholder identity or a human click.',...access.map(a=>disputeTime(a.recorded_at))]});
 sections.push({title:'Completed account usage',lines:['Pooled account usage is not allocated to a specific top-up. A call attempt or sent text is not proof of an answered call, seller interest, or a completed deal.',...usage.map(u=>`${disputeTime(u.settled_at)} | ${u.operation_key} | ${disputeMoney(u.charged_cents)}`)]});
 const refundCase=refundCaseSchema.parse({version:1,...ids,preparedAt,mode,policyAcceptanceRecorded,sections,gaps});
 return {key:'refund_case',source:'account-bound purchase and service receipts',status:gaps.length?'attention':'ok',observedAt:preparedAt,code:'refund_evidence_prepared',detail:'Refund evidence saved with this conversation. Review the saved gaps and disputed payment before using it in Stripe.',refundCase};
}

/** Ignore malformed/foreign snapshots; never interpret conversation text as evidence. */
export function savedRefundCase(value:unknown,accountId:string,threadId?:string):SupportRefundCase|null{
 const parsed=refundCaseSchema.safeParse(value);
 return parsed.success&&parsed.data.accountId===accountId&&(!threadId||parsed.data.threadId===threadId)?parsed.data:null;
}
