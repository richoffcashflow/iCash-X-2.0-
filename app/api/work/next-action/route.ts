import {creditRefillContext} from '@/lib/credit-refill-context';
import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/account-auth';
import {accountMode} from '@/lib/account-mode';
import {db} from '@/lib/stripe-test';
import {accountMembership,publicMembership} from '@/lib/membership';
import {membershipAccessible} from '@/lib/membership-policy';
import {customerFundingReady} from '@/lib/launch-readiness';
import {workspaceConversionOffer} from '@/lib/workspace-conversion';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store'};
type Snapshot = {accountId: string; account: {balanceCents: number; paused: boolean; billingReview: boolean; identity: unknown; billingModel: string}};

export async function GET() {
  try {
    const user = await currentUser(true), mode = accountMode();
    if (!user || mode !== 'live') return NextResponse.json({offer: null}, {headers});
    // Account identity comes exclusively from the authenticated session.
    const snapshot = await db<Snapshot>('rpc/icash_load_workspace_account', 'POST', {p_user: user.id, p_mode: mode});
    if (!snapshot?.accountId || !snapshot.account) throw Error('Account unavailable');
    const {accountId, account} = snapshot;
    const membership = account.billingModel === 'membership_credits' ? await accountMembership(accountId) : null;
    const accessible = account.billingModel === 'prepaid' || account.billingModel === 'membership_credits' && membershipAccessible(membership);
    if (!accessible || account.billingReview || !account.identity) return NextResponse.json({offer: null}, {headers});
    const [queued, completed, recent, recharge, canFund, refill] = await Promise.all([
      db<{id:string}[]>(`icash_screening_jobs?account_id=eq.${accountId}&state=eq.queued&select=id&limit=1`),
      db<{id:string}[]>(`icash_screening_jobs?account_id=eq.${accountId}&state=eq.complete&select=id&limit=1`),
      db<{id:string}[]>(`icash_funding_orders?account_id=eq.${accountId}&mode=eq.${mode}&state=eq.paid&credited_at=gt.${new Date(Date.now()-86400000).toISOString()}&select=id&limit=1`),
      db<{enabled:boolean;issue:string|null}[]>(`icash_auto_recharges?account_id=eq.${accountId}&mode=eq.${mode}&select=enabled,issue&limit=1`),
      customerFundingReady(),
      creditRefillContext(accountId,mode,account.balanceCents),
    ]);
    // VIP fields are published by the VIP release. Until it is deployed, no upgrade is advertised.
    const plan = publicMembership(membership) as ({vip?:boolean;accessible?:boolean;cancelAtPeriodEnd?:boolean;priceCents?:number}|null);
    const offer = workspaceConversionOffer({
      refill, balanceCents:account.balanceCents, paused:account.paused, billingReview:account.billingReview,
      identityReady:!!account.identity, membershipActive:accessible, canFund,
      autoRechargeEnabled:recharge[0]?.enabled===true&&!recharge[0]?.issue, recentPurchase:recent.length>0,
      queuedResearch:queued.length, completedResearch:completed.length,
      vipAvailable:plan?.vip===false && plan.accessible===true && !plan.cancelAtPeriodEnd && plan.priceCents===5000,
      vip:plan?.vip===true,
    });
    return NextResponse.json({offer,balanceCents:account.balanceCents,paused:account.paused,checkedAt:new Date().toISOString()}, {headers});
  } catch {
    // A failed context read must never generate a sales claim.
    return NextResponse.json({offer:null}, {status:503,headers});
  }
}
