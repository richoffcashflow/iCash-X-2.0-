import {validateCostManifest,type CostComponents} from './cost-manifest.ts';
import {db} from '@/lib/stripe-test';
import type {sellerCallFinancialGate} from '@/lib/equity-screen';
function serverOnly(){if(typeof window!=='undefined')throw new Error('Operating costs are server-only');}
/** Only server-resolved account IDs, permissions and underwriting belong here. No client-supplied quotes. */
export async function reserveOperation(input:{accountId:string;operationKey:string;rateId:string;permissionUntil:string;financialCheck?:ReturnType<typeof sellerCallFinancialGate>}){
 serverOnly();
 return db<{operationKey:string;state:string;reservedMicros:number}>('rpc/icash_reserve_operation','POST',{
  p_account:input.accountId,p_operation:input.operationKey,p_rate:input.rateId,p_permission_until:input.permissionUntil,
  p_financial_checked_at:input.financialCheck?new Date(input.financialCheck.checkedAt).toISOString():null,
  p_financial_eligible:input.financialCheck?.status==='eligible',
 });
}
/** Exactly one claim wins. A provider timeout keeps BOTH reservations; never automatically replay. */
export async function dispatchReservedOperation<T>(input:Parameters<typeof reserveOperation>[0],dispatch:()=>Promise<T>){
 serverOnly();await reserveOperation(input);
 if(!await db<boolean>('rpc/icash_claim_operation','POST',{p_operation:input.operationKey}))throw new Error('Operation held or already dispatched');
 return dispatch();
}
/** Call only after all billable components are reconciled, not from an LLM or a single provider's partial receipt. */
export async function settleOperation(input:{operationKey:string;customerChargeCents:number;components:CostComponents;evidenceRef:string}){
 serverOnly();
 if(!Number.isSafeInteger(input.customerChargeCents)||input.customerChargeCents<0||input.evidenceRef.trim().length<10)throw new Error('Verified settlement required');
 const {components}=validateCostManifest(input.components);
 return db('rpc/icash_settle_complete_costs','POST',{p_operation:input.operationKey,p_charge:input.customerChargeCents,p_components:components,p_evidence:input.evidenceRef});
}

export async function recordVoiceCost(conversationId:string,value:unknown){
 serverOnly();if(typeof value!=='number'||!Number.isFinite(value)||value<0)return false;
 if(!/^conv_[a-zA-Z0-9_-]+$/.test(conversationId))throw new Error('Invalid conversation');
 // ElevenLabs docs: cost_fiat is USD, including platform + LLM; excludes outside providers.
 await db('rpc/icash_record_cost_observation','POST',{p_provider:'elevenlabs',p_event:conversationId,p_source:`elevenlabs:conversation:${conversationId}`,p_amount:value,p_units:'usd'});
 return true;
}
export async function recordPropertyCost(sessionId:string,credits:unknown){
 serverOnly();if(typeof credits!=='number'||!Number.isSafeInteger(credits)||credits<0)return false;
 await db('rpc/icash_record_cost_observation','POST',{p_provider:'dealmachine',p_event:`voice-test:${sessionId}`,p_source:`voice-test:${sessionId}`,p_amount:credits,p_units:'provider_credits'});
 return true;
}
