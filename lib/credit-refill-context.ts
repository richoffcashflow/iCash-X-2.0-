import {db} from '@/lib/stripe-test';
import {creditRefillRecommendation,type RefillHistory,type RefillUsage} from './credit-refill-recommendation';
export async function creditRefillContext(accountId:string,mode:'live'|'test',balanceCents:number){
 const now=Date.now();
 const [historyResult,usageResult]=await Promise.allSettled([
  db<(RefillHistory&{automatic:{order_id:string}|null})[]>(`icash_funding_orders?account_id=eq.${accountId}&mode=eq.${mode}&state=eq.paid&credited_at=gt.${new Date(now-30*86400000).toISOString()}&select=price_cents,credit_cents,credited_at,automatic:icash_auto_recharge_attempts!icash_auto_recharge_attempts_order_id_fkey(order_id)&order=credited_at.desc&limit=100`),
  mode==='live'?db<RefillUsage[]>(`icash_credit_ledger?account_id=eq.${accountId}&kind=eq.usage&created_at=gt.${new Date(now-7*86400000).toISOString()}&select=delta_cents,created_at&order=created_at.desc&limit=1001`):Promise.resolve([]),
 ]);
 // auto_recharge on an order means the customer opted in during that checkout.
 // Only an actual recharge-attempt relation identifies an automatic purchase.
 // The order_id foreign key is UNIQUE: PostgREST embeds an object or null.
 const relationKnown=(value:unknown)=>value===null||typeof value==='object'&&!Array.isArray(value)&&typeof (value as {order_id?:unknown}).order_id==='string';
 const history=historyResult.status==='fulfilled'?historyResult.value.map(p=>({...p,auto_recharge:p.automatic!==null})):[];
 const usage=usageResult.status==='fulfilled'?usageResult.value:[];
 return {...creditRefillRecommendation(balanceCents,history,usage,now),available:historyResult.status==='fulfilled'&&usageResult.status==='fulfilled'&&history.every(p=>relationKnown(p.automatic))};
}
