import type {ProviderDocument} from './signing-policy.ts';
export type Submission={id:number;submitters_order:string;completed_at:string|null;status?:string;audit_log_url?:string;combined_document_url?:string;submitters:{id:number;submission_id:number;email?:string|null;phone?:string|null;external_id:string;status:string;completed_at:string|null;slug:string;metadata:{terms_hash?:string};values?:{field:string;value:unknown}[]}[]};
export function normalizeDocuseal(d:Submission,e:{provider_id:string|null;id:string;test_mode:boolean;terms_hash:string;recipients:{id:string;email?:string|null;phone?:string|null}[]}):ProviderDocument{
 if(String(d.id)!==e.provider_id||d.submitters_order!=='preserved'||!Array.isArray(d.submitters)||d.submitters.length!==e.recipients.length)throw new Error('Signature evidence mismatch');
 // The response array is not a signing-order guarantee. Bind each signer to
 // the immutable external ID, then validate their chronology in our saved order.
 if(new Set(d.submitters.map(s=>s.external_id)).size!==e.recipients.length)throw new Error('Duplicate signature recipient');
 let previousSignedAt=0;
 const rs=e.recipients.map((r,i)=>{const v=d.submitters.find(s=>s.external_id===`${e.id}:${r.id}`);if(!v||v.submission_id!==d.id||v.metadata?.terms_hash!==e.terms_hash)throw new Error('Signature binding mismatch');if(v.completed_at){const at=Date.parse(v.completed_at);if(!Number.isFinite(at)||at<previousSignedAt)throw new Error('Signing chronology mismatch');previousSignedAt=at;}return {id:r.id,email:v.email,phone:v.phone,status:v.status==='completed'&&v.completed_at?'signed':v.status,signing_order:i+1};});
 return {id:String(d.id),test_mode:e.test_mode,apply_signing_order:true,metadata:{icash_envelope:e.id,terms_hash:e.terms_hash},status:d.completed_at?'Completed':d.submitters.some(s=>s.status==='declined')?'Declined':'Pending',recipients:rs};
}
