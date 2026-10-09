import {originalContractProfile,originalContractValues} from './original-contracts.ts';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {dealTermsSchema,type DealTerms} from './deal-documents.ts';
import {calendarDaysAfter,deadlineDateStatus} from './document-dates.ts';
export const signerSchema=z.object({name:z.string().trim().min(2).max(200),email:z.string().trim().email().max(254).optional(),phone:z.string().regex(/^\+1[2-9][0-9]{9}$/).optional()}).strict().refine(s=>!!s.email||!!s.phone,'A signing phone number is required');
export type Signer=z.infer<typeof signerSchema>;
export type SigningKind='purchase'|'assignment';
export function signingTermsHash(terms:unknown){const t=dealTermsSchema.parse(terms);return createHash('sha256').update(JSON.stringify(t)).digest('hex');}
/** Enforce objective completeness again at the final send/sign step; never supply missing legal terms. */
export function signingDocumentReadiness(kind:SigningKind,input:DealTerms,now=Date.now(),profile='legacy'){
 const t=dealTermsSchema.parse(input);
 if(kind==='assignment'&&(t.assignmentFeeCents===null||t.assignmentDepositCents===null||(profile!==originalContractProfile&&!t.escrowAgent.trim())))throw new Error('Confirm the assignment fee, deposit amount and any required escrow company.');
 if(t.effectiveDate&&t.closingDate&&t.closingDate<t.effectiveDate)throw new Error('Closing cannot be before the contract effective date.');
 // Only legacy forms contain a signature-relative 30-day closing clause.
 if(profile===originalContractProfile&&kind==='purchase'&&!t.closingDate)throw new Error('Confirm the closing date before sending the agreement.');
 const deadline=t.closingDate||(profile!==originalContractProfile&&t.effectiveDate?calendarDaysAfter(t.effectiveDate,30):null);
 if(deadline){
  const status=deadlineDateStatus(deadline,now);
  if(status==='past')throw new Error('The closing deadline has passed. Review the agreement and any required amendment before signing.');
  if(status==='timezone_review')throw new Error('The closing deadline may be today or already past. Confirm the contract timezone and deadline before signing.');
 }
 return true;
}
export function signingReadiness(kind:SigningKind,t:DealTerms,parties:Signer[],principal:string,stage:string,now=Date.now(),profile='legacy'){
 t=dealTermsSchema.parse(t);
 if(!principal||t.buyer!==principal)throw new Error('Save your legal name before signing.');
 if(!t.address.trim()||!t.legalDescription.trim()||!t.seller.trim()||!/^[A-Z]{2}$/.test(t.state)||!t.priceCents||t.priceSource!=='seller_reported')throw new Error('Confirm the agreed price, seller names, state and legal description first.');
 if(kind==='purchase'&&stage!=='draft')throw new Error('This purchase agreement is already executed.');
 if(kind==='assignment'&&(!['under_contract','buyer_selected','title_open','closing'].includes(stage)||!t.assignee||t.assignmentFeeCents===null||t.assignmentDepositCents===null||(profile!==originalContractProfile&&!t.escrowAgent)))throw new Error('A signed purchase agreement, buyer, fee, deposit and escrow company are required.');
 signingDocumentReadiness(kind,t,now,profile);
 if(parties.length<1||parties.length>8||new Set(parties.map(p=>p.phone??p.email?.toLowerCase())).size!==parties.length||parties.some(p=>!signerSchema.safeParse(p).success))throw new Error('Enter each required signer with a separate phone number.');
 return true;
}
// Existing envelopes retain their original template fields and terms hash.
export function signingFields(t:DealTerms,kind:SigningKind='purchase',legacyEarnest=false,profile='legacy'){if(profile===originalContractProfile)return originalContractValues(t,kind);const excluded=new Set(kind==='purchase'?['county','assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle','priceSource',...(legacyEarnest?[]:['earnestCents'])]:['county','earnestCents','inspectionDays','payoutMethod','payoutHandle','priceSource']);return Object.fromEntries(Object.entries(t).filter(([k])=>!excluded.has(k)).map(([k,v])=>[k,k.endsWith('Cents')?(v===null?'':(Number(v)/100).toFixed(2)):v===null?'':String(v)]));}
export type ProviderDocument={id:string;test_mode:boolean;status:string;apply_signing_order:boolean;metadata?:Record<string,string>;recipients:{id:string;email?:string|null;phone?:string|null;status:string;signing_order:number}[]};
/** A browser callback, a pasted signature or a manually completed envelope never counts. */
export function verifiedSigningStatus(d:ProviderDocument,e:{providerId:string;id:string;termsHash:string;testMode:boolean;recipients:{id:string;email?:string|null;phone?:string|null}[]}){
 if(d.id!==e.providerId||d.test_mode!==e.testMode||d.metadata?.icash_envelope!==e.id||d.metadata?.terms_hash!==e.termsHash||d.apply_signing_order!==true||!Array.isArray(d.recipients)||d.recipients.length!==e.recipients.length)throw new Error('Signature evidence mismatch');
 const rs=e.recipients.map((r,i)=>{const found=d.recipients.find(x=>x.id===r.id);if(!found||(r.phone?found.phone!==r.phone:!r.email||found.email?.toLowerCase()!==r.email.toLowerCase())||found.signing_order!==i+1)throw new Error('Signer evidence mismatch');return found;});
 const signed=rs.map(r=>r.status.toLowerCase()==='signed');
 if(signed.some((s,i)=>s&&signed.slice(0,i).some(x=>!x)))throw new Error('Signing order mismatch');
 const status=d.status.toLowerCase();
 if(status==='completed'&&signed.every(Boolean))return e.testMode?'test_completed':'completed';
 if(['declined','canceled','expired','error','bounced','blocked','manually completed'].includes(status))return 'needs_review';
 if(signed.slice(0,-1).every(Boolean))return 'customer_signature_needed';
 return 'awaiting_counterparty';
}
