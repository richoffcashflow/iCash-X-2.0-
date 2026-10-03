import {timingSafeEqual} from 'node:crypto';
export type BillingDb=<T>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
type Reconcile=(accountId:string,callId:string,signal?:AbortSignal)=>Promise<unknown>;
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const transient=new Set(['awaiting_conversation','provider_receipt_missing','duration_missing','carrier_receipt_missing','carrier_receipt_unavailable','carrier_usage_unavailable','attempt_unconfirmed']);
export function authorizeOutboundBilling(request:Request,secret:string|undefined){
 const actual=request.headers.get('authorization')??'',expected=`Bearer ${secret??''}`;
 return !!secret&&secret.length>=32&&new URL(request.url).search===''&&actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
/** Billing-only; never imports or calls acquisition, dispatch, budget funding,
 * account Start, or provider write routes. A durable claim survives process loss. */
export async function runOutboundBilling(enabled:boolean,database:BillingDb,reconcile:Reconcile,signal=AbortSignal.timeout(20000)){
 if(!enabled)return {status:'disabled'};
 const db:BillingDb=(path,method,body)=>{signal.throwIfAborted();return database(path,method,body,signal);};
 const raw=await db<unknown>('rpc/icash_claim_outbound_billing','POST',{});
 if(!Array.isArray(raw)||raw.length>1)throw Error('Invalid outbound queue response');
 if(!raw.length)return {status:'idle'};
 const job=obj(raw[0]);
 if(!uuid(job.call_id)||!uuid(job.account_id)||!uuid(job.lease_token)||typeof job.operation_key!=='string'||!/^voice:[a-f0-9-]{36}$/i.test(job.operation_key)||!Number.isSafeInteger(job.attempts)||Number(job.attempts)<1)throw Error('Invalid outbound queue binding');
 let outcome:'completed'|'retry'|'review'='retry',reason='attempt_unconfirmed',confirmed=false;
 try{
  // Any read error stays unknown. No provider reads or writes follow it.
  const prior=await db<unknown>('rpc/icash_get_outbound_usage_settlement','POST',{p_account:job.account_id,p_call:job.call_id});
  if(prior!==null){
   const p=obj(prior);
   if(p.settled!==true||p.operationKey!==job.operation_key||!Number.isSafeInteger(p.chargedCents)||Number(p.chargedCents)<0)throw Error('Unconfirmed ledger readback');
   confirmed=true;outcome='completed';reason='ledger_confirmed';
  }else{
   const result=obj(await reconcile(String(job.account_id),String(job.call_id),signal));
   const billing=obj(result.billing);
   if(billing.status==='settled'){outcome='completed';reason='ledger_settlement_reported';}
   else{
    reason=typeof billing.reason==='string'?billing.reason:typeof result.status==='string'?result.status:'attempt_unconfirmed';
    outcome=transient.has(reason)?'retry':'review';
   }
  }
 }catch{outcome='retry';reason='attempt_unconfirmed';}
 const delay=Math.min(900,60*2**Math.min(Number(job.attempts)-1,4));
 try{
  signal.throwIfAborted();
  // SQL confirms completed against original ledger before accepting this result.
  const saved=await db<unknown>('rpc/icash_finish_outbound_billing','POST',{p_call_id:job.call_id,p_account_id:job.account_id,p_lease_token:job.lease_token,p_outcome:outcome,p_reason:reason.slice(0,200),p_retry_seconds:delay});
  if(saved!==true)return {status:'queue_update_unconfirmed',ledgerConfirmed:confirmed};
  const exhausted=outcome==='retry'&&Number(job.attempts)>=12;
  return {status:exhausted?'review':outcome,ledgerConfirmed:outcome==='completed',reviewRequired:outcome==='review'||exhausted};
 }catch{return {status:'queue_update_unconfirmed',ledgerConfirmed:confirmed};}
}
