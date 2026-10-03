import {allowedOrigin,fundingMode} from '@/lib/funding-policy';
import {customerFundingReady} from "@/lib/launch-readiness";
import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {randomBytes} from 'node:crypto';
import {currentUser} from '@/lib/account-auth';
import {db,guestHash} from '@/lib/stripe-test';
import {fundingStripe,limitRequest,validGuest} from '@/lib/funding';
import {dailyConsentVersion,dailyReady,stopDaily,syncDailySubscription,reconcileDailyCheckout,type DailyPlan} from '@/lib/daily-billing';
export const dynamic='force-dynamic';
async function owner(create=false){
 const jar=await cookies();let token=jar.get('icash_funding_guest')?.value;
 if(!validGuest(token)&&create){token=randomBytes(32).toString('hex');jar.set('icash_funding_guest',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400*30});}
 const user=await currentUser(true);const [account]=user?await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`):[];
 if(account)await db('rpc/icash_daily_claim','POST',{p_account:account.id});
 const filter=account?`account_id=eq.${account.id}`:validGuest(token)?`guest_hash=eq.${guestHash(token)}&account_id=is.null`:null;
 const plans=filter?await db<DailyPlan[]>(`icash_daily_plans?${filter}&mode=eq.${fundingMode()}&state=neq.stopped&order=created_at.desc&limit=1`):[];
 return {token,user,account,p:plans[0]};
}
export async function GET(){try{const {p:ownedPlan}=await owner();let p=ownedPlan?await reconcileDailyCheckout(ownedPlan):undefined;let budgetCents:number|null=null,nextCharge:number|null=null;
 if(p?.stripe_subscription_id){const sub=await fundingStripe().subscriptions.retrieve(p.stripe_subscription_id);await syncDailySubscription(sub);const item=sub.items.data[0];nextCharge=item?.current_period_end??null;const priceIds=sub.items.data.map(i=>i.price.id).join(',');const [q]=await db<{budget_cents:number}[]>(`icash_daily_quotes?plan_id=eq.${p.id}&budget_price=in.(${priceIds})&select=budget_cents`);budgetCents=q?.budget_cents??null;const [saved]=await db<DailyPlan[]>(`icash_daily_plans?id=eq.${p.id}&select=*`);p=saved??p;}
 return NextResponse.json({ready:dailyReady()&&await customerFundingReady(),plan:p?{state:p.state,budgetCents,nextCharge}:null,consentVersion:dailyConsentVersion},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'Could not load daily billing.'},{status:503});}}
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 try{const raw=await req.text();if(raw.length>1024)throw new Error();const i=JSON.parse(raw);const {p,token}=await owner(true);await limitRequest(req,'daily-billing',token!,8,600);
 if(i.action==='stop'){if(p)await stopDaily(p);return NextResponse.json({stopped:true});}
 return NextResponse.json({error:'Daily billing has been retired. Add prepaid work credits from your workspace instead.'},{status:410});
 }catch{return NextResponse.json({error:'Could not update daily billing. No extra attempt will be made automatically. Please refresh.'},{status:503});}}
