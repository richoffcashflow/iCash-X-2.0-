import {acceptedEarlyAccessTerms,earlyAccessTermsVersion,earlyAccessDailyDisclosure} from '@/lib/funding-consent';
import {setupEvent} from '@/lib/bot-setup-server';
import {customerFundingReady} from "@/lib/launch-readiness";
import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {randomBytes} from 'node:crypto';
import {currentUser} from '@/lib/account-auth';
import {db,guestHash} from '@/lib/stripe-test';
import {allowedOrigin,earlyAccessFundingEnabled,fundingMode} from '@/lib/funding-policy';
import {fundingStripe,limitRequest,validGuest} from '@/lib/funding';
import {dailyConsent,dailyConsentVersion,dailyQuote,dailyReady,stopDaily,syncDailySubscription,settleDailyInvoice,reconcileDailyCheckout,type DailyPlan} from '@/lib/daily-billing';
import {processingFeeCents} from '@/lib/funding-fees';
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
 try{const raw=await req.text();if(raw.length>1024)throw new Error();const i=JSON.parse(raw);const {p,token,user,account}=await owner(true);await limitRequest(req,'daily-billing',token!,8,600);
 if(i.action==='stop'){if(p)await stopDaily(p);return NextResponse.json({stopped:true});}
 if(!dailyReady()||!await customerFundingReady())return NextResponse.json({error:'Daily funding is currently unavailable. Please retry.'},{status:503});
 const earlyAccess=earlyAccessFundingEnabled();
 if(earlyAccess&&!acceptedEarlyAccessTerms(i))return NextResponse.json({error:'Acknowledge the current live-work limitations and ongoing daily renewal before payment.'},{status:400});
 const consentVersion=earlyAccess?`${dailyConsentVersion}:early:${earlyAccessTermsVersion}`:dailyConsentVersion;
 const consentText=earlyAccess?`${dailyConsent} Early-access acknowledgment: ${earlyAccessDailyDisclosure}`:dailyConsent;
 if(i.accepted!==true||i.version!==dailyConsentVersion||typeof i.packCode!=='string'||!/^[a-z0-9_]{1,30}$/.test(i.packCode))throw new Error();
 const mode=fundingMode()!;const [pack]=await db<{price_cents:number}[]>(`icash_credit_packs?code=eq.${i.packCode}${mode==='live'?'&enabled=eq.true':''}&select=price_cents`);
 if(!pack||pack.price_cents<1000||pack.price_cents>100000||i.totalCents!==pack.price_cents+processingFeeCents(pack.price_cents))return NextResponse.json({error:'Refresh and confirm the daily total.'},{status:400});
 const stripe=fundingStripe();
 if(i.action==='change'){
 if(!p?.stripe_subscription_id||p.state!=='active')return NextResponse.json({error:'Start your bot before changing its daily billing.'},{status:409});
 const sub=await stripe.subscriptions.retrieve(p.stripe_subscription_id);if(sub.status!=='active'||sub.items.data.length!==1)throw new Error();
 const q=await dailyQuote(p,i.packCode,consentText);
 await stripe.subscriptions.update(sub.id,{items:[{id:sub.items.data[0].id,price:q.budget_price,quantity:1}],proration_behavior:'none',payment_behavior:'error_if_incomplete'},{idempotencyKey:`daily-change:${q.id}`});
 return NextResponse.json({saved:true,message:'Daily budget saved. Your new amount starts at the next daily renewal; no charge now.'});
 }
 if(i.action!=='start')throw new Error();
 if(p){if(p.stripe_session_id){const session=await stripe.checkout.sessions.retrieve(p.stripe_session_id);if(session.status==='open'&&session.url){if(earlyAccess&&session.metadata?.icash_early_access_terms_version!==earlyAccessTermsVersion)return NextResponse.json({error:'Your open checkout has older disclosures. Stop the pending plan, then start again to review the current terms.'},{status:409});await setupEvent('checkout_opened');return NextResponse.json({url:session.url});}if(session.status==='complete'){const subId=typeof session.subscription==='string'?session.subscription:session.subscription?.id;if(subId){const sub=await stripe.subscriptions.retrieve(subId);await syncDailySubscription(sub);const inv=typeof sub.latest_invoice==='string'?sub.latest_invoice:sub.latest_invoice?.id;if(inv)await settleDailyInvoice(inv);}return NextResponse.json({error:'Your daily plan already exists. Refresh to manage it.'},{status:409});}}
 return NextResponse.json({error:'A daily plan is already being prepared. Stop it before starting another.'},{status:409});}
 const [plan]=await db<DailyPlan[]>('icash_daily_plans','POST',{mode,guest_hash:guestHash(token!),account_id:account?.id??null,consent_version:consentVersion,consent_text:consentText});
 const q=await dailyQuote(plan,i.packCode,consentText);const origin=req.headers.get('origin')!;
 const s=await stripe.checkout.sessions.create({mode:'subscription',customer_email:user?.email,automatic_tax:{enabled:false},payment_method_types:['card'],phone_number_collection:{enabled:true},line_items:[{price:q.budget_price,quantity:1}],subscription_data:{metadata:{icash_daily_plan:plan.id}},metadata:{icash_daily_plan:plan.id,...(earlyAccess?{icash_early_access_terms_version:earlyAccessTermsVersion}:{})},custom_text:{submit:{message:(earlyAccess?earlyAccessDailyDisclosure+' ':'')+'Renews every day until you stop your bot. You pay for activity, not a guaranteed deal or income. Your budget may be used without a closing. No separately added processing fee or tax.'}},success_url:`${origin}/?payment=funded&session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/?payment=canceled`},{idempotencyKey:`daily-checkout:${plan.id}`});
 if(s.livemode!==(mode==='live')||!s.url)throw new Error();const [saved]=await db<DailyPlan[]>(`icash_daily_plans?id=eq.${plan.id}`,'PATCH',{stripe_session_id:s.id,checkout_url:s.url});if(saved.state==='stop_requested'||saved.state==='stopped'){await stopDaily(saved);throw new Error('Plan stopped');}
 await setupEvent('checkout_opened');
 return NextResponse.json({url:s.url});
 }catch{return NextResponse.json({error:'Could not update daily billing. No extra attempt will be made automatically. Please refresh.'},{status:503});}}
