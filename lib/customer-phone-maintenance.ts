import type {CustomerPhoneCall} from './customer-phone.ts';
type PendingCall=CustomerPhoneCall&{reconciliation_checked_at:string|null};
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
/** Advance a persisted retry clock before reading the carrier. Failed reads,
 * missing prices and ambiguous children rotate fairly without releasing holds. */
export async function reconcilePendingCustomerPhoneCalls(database:Database,reconcile:(row:CustomerPhoneCall)=>Promise<CustomerPhoneCall>,now=Date.now()){
 const before=encodeURIComponent(new Date(now-5*60000).toISOString());
 const scope=`settled_at=is.null&or=(parent_sid.not.is.null,connection_type.eq.browser)&and=(or(reconciliation_checked_at.is.null,reconciliation_checked_at.lte.${before}))`;
 const rows=await database<PendingCall[]>(`icash_customer_phone_calls?${scope}&order=reconciliation_checked_at.asc.nullsfirst,id.asc&limit=3&select=*`);
 const outcomes=await Promise.allSettled(rows.map(async row=>{
  const stamp=new Date(Math.max(now,row.reconciliation_checked_at?Date.parse(row.reconciliation_checked_at)+1:0)).toISOString();
  const prior=row.reconciliation_checked_at?'eq.'+encodeURIComponent(row.reconciliation_checked_at):'is.null';
  const claimed=await database<PendingCall[]>(`icash_customer_phone_calls?id=eq.${encodeURIComponent(row.id)}&account_id=eq.${encodeURIComponent(row.account_id)}&settled_at=is.null&reconciliation_checked_at=${prior}&select=*`,'PATCH',{reconciliation_checked_at:stamp});
  if(!claimed.length)return 'skipped';
  return (await reconcile(claimed[0])).settled_at?'settled':'held';
 }));
 return {checked:outcomes.length,settled:outcomes.filter(x=>x.status==='fulfilled'&&x.value==='settled').length,held:outcomes.filter(x=>x.status==='fulfilled'&&x.value==='held').length,errors:outcomes.filter(x=>x.status==='rejected').length};
}
