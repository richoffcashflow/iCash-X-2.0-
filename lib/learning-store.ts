import { db } from '@/lib/stripe-test';
/** Internal only. Call AFTER validating the provider signature and resolving its stored tenant/deal/operation IDs.
 * Never pass request JSON, AI claims, demo events, or unverified client account IDs directly here.
 */
export async function recordLearningEvent(event: {
 account_id:string;deal_id:string;event_key:string;operation_id:string;
 kind:'attempt'|'connected'|'response'|'qualified'|'offer'|'contract'|'closed'|'opt_out'|'cost';
 source:'provider_receipt'|'verified_conversation'|'signed_document'|'title_confirmation'|'billing_receipt';
 evidence_ref:string;occurred_at:string;provider_cost_micros?:number;
}):Promise<boolean>{
 if(typeof window!=='undefined')throw new Error('Learning storage is server-only');
 return db<boolean>('rpc/icash_record_learning_event','POST',{p_event:event});
}
