import {creditRefillContext} from '@/lib/credit-refill-context';
import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/account-auth';
import {accountMode} from '@/lib/account-mode';
import {db} from '@/lib/stripe-test';
import {accountMembership,publicMembership} from '@/lib/membership';
import {membershipAccessible} from '@/lib/membership-policy';
import {customerFundingReady} from '@/lib/launch-readiness';
import {usageLoopCard} from '@/lib/usage-loop-policy';
import {loadUsageLoopContext} from '@/lib/usage-loop-context';
import {createUsageLoopObservation,usageLoopVariant} from '@/lib/usage-loop-tracking';
import {reliabilitySchema} from '@/lib/reliability';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control': 'private, no-store'};
type Snapshot = {accountId: string; account: {balanceCents: number; paused: boolean; billingReview: boolean; identity: unknown; billingModel: string}};

export async function GET() {
  try {
    const user = await currentUser(true), mode = accountMode();
    if (!user || mode !== 'live') return NextResponse.json({card:null,offer:null}, {headers});
    // Account identity comes exclusively from the authenticated session.
    const snapshot = await db<Snapshot>('rpc/icash_load_workspace_account', 'POST', {p_user: user.id, p_mode: mode});
    if (!snapshot?.accountId || !snapshot.account) throw Error('Account unavailable');
    const {accountId, account} = snapshot;
    const membership = account.billingModel === 'membership_credits' ? await accountMembership(accountId) : null;
    const accessible = account.billingModel === 'prepaid' || account.billingModel === 'membership_credits' && membershipAccessible(membership);
    if (!accessible || account.billingReview || !account.identity) return NextResponse.json({card:null,offer:null}, {headers});
    const [evidence, recent, recharge, canFund, refill, reliabilityData, access] = await Promise.all([
      loadUsageLoopContext(accountId,user.id),
      db<{id:string}[]>(`icash_funding_orders?account_id=eq.${accountId}&mode=eq.${mode}&state=eq.paid&credited_at=gt.${new Date(Date.now()-86400000).toISOString()}&select=id&limit=1`),
      db<{enabled:boolean;issue:string|null}[]>(`icash_auto_recharges?account_id=eq.${accountId}&mode=eq.${mode}&select=enabled,issue&limit=1`),
      customerFundingReady(),
      creditRefillContext(accountId,mode,account.balanceCents),
      db('rpc/icash_reliability_status','POST',{}).catch(()=>null),
      db<{vip:boolean}>('rpc/icash_workspace_vip_access','POST',{p_account:accountId}),
    ]);
    const plan = publicMembership(membership) as ({vip?:boolean;accessible?:boolean;cancelAtPeriodEnd?:boolean;priceCents?:number}|null);
    const reliability=reliabilitySchema.safeParse(reliabilityData);
    const serviceReady=reliability.success&&reliability.data.fresh&&reliability.data.components.worker.status==='ok'&&reliability.data.components.maintenance.status==='ok';
    const variant=usageLoopVariant(accountId);
    const card = usageLoopCard({
      refill, balanceCents:account.balanceCents, paused:account.paused, billingReview:account.billingReview,
      identityReady:!!account.identity, membershipActive:accessible, canFund,
      autoRechargeEnabled:recharge[0]?.enabled===true&&!recharge[0]?.issue, recentPurchase:recent.length>0,
      vipAvailable:access.vip===false && plan?.accessible===true && !plan.cancelAtPeriodEnd && plan.priceCents===5000,
      vip:access.vip===true,variant,evidence:{...evidence,ready:evidence.ready&&serviceReady},
    });
    const observation=card&&process.env.VERCEL_ENV==='production'?await createUsageLoopObservation(accountId,card):null;
    return NextResponse.json({card,variant,impressionId:observation?.impressionId??null,offer:null,balanceCents:account.balanceCents,paused:account.paused,checkedAt:new Date().toISOString()}, {headers});
  } catch {
    // A failed context read must never generate a sales claim.
    return NextResponse.json({card:null,offer:null}, {status:503,headers});
  }
}
