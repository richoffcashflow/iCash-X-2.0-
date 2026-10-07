import {db} from '@/lib/stripe-test';
import {creditRefillRecommendation,type RefillHistory,type RefillUsage} from './credit-refill-recommendation';
export async function creditRefillContext(accountId:string,mode:'live'|'test',balanceCents:number){
 const now=Date.now();
 const [historyResult,usageResult]=await Promise.allSettled([
  db<RefillHistory[]>(`icash_funding_orders?account_id=eq.${accountId}&mode=eq.${mode}&state=eq.paid&auto_recharge=is.false&credited_at=gt.${new Date(now-30*86400000).toISOString()}&select=price_cents,credited_at,auto_recharge&order=credited_at.desc&limit=5`),
  mode==='live'?db<RefillUsage[]>(`icash_credit_ledger?account_id=eq.${accountId}&kind=eq.usage&created_at=gt.${new Date(now-7*86400000).toISOString()}&select=delta_cents,created_at&order=created_at.desc&limit=1001`):Promise.resolve([]),
 ]);
 const history=historyResult.status==='fulfilled'?historyResult.value:[];
 const usage=usageResult.status==='fulfilled'?usageResult.value:[];
 return creditRefillRecommendation(balanceCents,history,usage,now);
}
