import {normalizeDocuseal, type Submission} from './docuseal-policy.ts';
import {verifiedSigningStatus} from './signing-policy.ts';

export type CancellationEnvelope = {
 id:string; account_id:string; deal_id:string; kind:'purchase'|'assignment';
 provider_id:string|null; state:string; test_mode:boolean; terms_hash:string;
 recipients:{id:string;email?:string|null;phone?:string|null}[];
};

/** Bind provider evidence to the original document before deciding whether it stopped. */
export function cancellationEvidence(raw:Submission,envelope:CancellationEnvelope,now=Date.now()) {
 const document=normalizeDocuseal(raw,envelope);
 const status=verifiedSigningStatus(document,{providerId:envelope.provider_id!,id:envelope.id,termsHash:envelope.terms_hash,testMode:envelope.test_mode,recipients:envelope.recipients});
 const signed=document.recipients.some(r=>r.status==='signed');
 if(['completed','test_completed'].includes(status))return {outcome:'completed' as const,signed:true};
 // Archiving alone does not establish that an existing signing link is disabled.
 if(raw.expire_at&&Number.isFinite(Date.parse(raw.expire_at))&&Date.parse(raw.expire_at)<=now)
  return {outcome:'expired' as const,signed};
 return {outcome:'active' as const,signed};
}

export type CancellationRecord = {
 id:string;kind:'purchase'|'assignment';state:'pending'|'completed';reason:string;
 requires_release:boolean;has_deposit:boolean;has_title:boolean;provider_ready:boolean;
 release_reference:string;resolution_reference:string;created_at:string;completed_at:string|null;
 late_activity:boolean;
};
export type CancellationView = {
 revision:string;stage:string;hasAssignment:boolean;blocked:boolean;
 requests:CancellationRecord[];
};
