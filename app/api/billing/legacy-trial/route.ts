import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {currentUser} from '@/lib/account-auth';
import {db,guestHash} from '@/lib/stripe-test';
import {allowedOrigin,fundingMode,normalizeEmail} from '@/lib/funding-policy';
import {fundingStripe,limitRequest,validGuest} from '@/lib/funding';
import {customerFundingReady} from '@/lib/launch-readiness';
import {reconcileMembershipCheckout,type Membership} from '@/lib/membership';
import {legacyTrialVersion,legacyTrialTerms,legacyTrialSummary} from '@/lib/legacy-trial-policy';
import {recordPurchaseAcceptance} from '@/lib/purchase-acceptance';
const headers={'Cache-Control':'private, no-store'};
export const dynamic='force-dynamic';
const input=z.object({email:z.string().trim().email().max(254),accepted:z.literal(true),version:z.literal(legacyTrialVersion)}).strict();
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 // Keep the new offer dark until its migration, audience and provider tests are approved.
 if(process.env.ICASH_LEGACY_TRIAL_ENABLED!=='true')return NextResponse.json({error:'This offer is not open yet.'},{status:503,headers});
 try{
  const raw=await req.text();if(raw.length>1024)throw Error();const i=input.parse(JSON.parse(raw));
  const jar=await cookies();let token=jar.get('icash_funding_guest')?.value;
  if(!validGuest(token)){token=randomBytes(32).toString('hex');jar.set('icash_funding_guest',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400*30});}
  await limitRequest(req,'legacy-trial',token!,5,600);
  const mode=fundingMode(),user=await currentUser(true),email=normalizeEmail(user?.email??i.email);
  if(user?.email&&normalizeEmail(i.email)!==normalizeEmail(user.email))return NextResponse.json({error:'You are signed in with a different email. Use that email, or sign out and use the email you want for this checkout.'},{status:409,headers});
  if(!mode||!email||!await customerFundingReady())throw Error();
  const [account]=user?await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`):[];
  const stripe=fundingStripe(),origin=req.headers.get('origin')!;
  if(user?.email_confirmed_at){
   const old=await db<Membership|null>('rpc/icash_legacy_trial_recovery','POST',{p_user:user.id,p_mode:mode,p_email:email});
   if(old?.legacy_trial_started_at)return NextResponse.json({url:origin+'/access?purchase='+old.id},{headers});
   if(old&&old.state==='pending'&&!old.legacy_trial_started_at&&(old.guest_hash!==guestHash(token!)||old.account_id!==(account?.id??null))){
    if(!old.stripe_session_id)return NextResponse.json({error:'Your earlier checkout is still being checked. Contact support to recover it safely; do not start another subscription.'},{status:409,headers});
    let prior=await stripe.checkout.sessions.retrieve(old.stripe_session_id);
    if(prior.id!==old.stripe_session_id||prior.metadata?.icash_membership!==old.id||prior.metadata?.icash_legacy_trial!==legacyTrialVersion||prior.livemode!==(mode==='live'))throw Error();
    if(prior.status==='complete'){await reconcileMembershipCheckout(old);return NextResponse.json({url:origin+'/access?purchase='+old.id},{headers});}
    if(prior.status==='open'){await stripe.checkout.sessions.expire(prior.id);prior=await stripe.checkout.sessions.retrieve(prior.id);}
    if(prior.status!=='expired')throw Error('Earlier checkout outcome unresolved');
    await db('rpc/icash_release_legacy_trial_checkout','POST',{p_user:user.id,p_membership:old.id,p_session:prior.id});
   }
  }
  let m=await db<Membership>('rpc/icash_begin_legacy_trial','POST',{p_guest:guestHash(token!),p_account:account?.id??null,p_mode:mode,p_email:email,p_terms:legacyTrialTerms,p_version:legacyTrialVersion});
  if(m.stripe_session_id){
   const prior=await stripe.checkout.sessions.retrieve(m.stripe_session_id);
   if(prior.metadata?.icash_membership!==m.id||prior.metadata?.icash_legacy_trial!==legacyTrialVersion||prior.livemode!==(mode==='live'))throw Error();
   if(prior.status==='complete'){await reconcileMembershipCheckout(m);return NextResponse.json({url:origin+'/access?purchase='+m.id},{headers});}
   if(prior.status==='open'&&prior.url)return NextResponse.json({url:prior.url},{headers});
   if(prior.status!=='expired')throw Error();
   m=await db<Membership>('rpc/icash_restart_legacy_trial','POST',{p_membership:m.id,p_session:prior.id,p_attempt:m.legacy_trial_attempt??1});
  }
  const end=Date.parse(m.legacy_trial_end??'')/1000;
  if(!Number.isSafeInteger(end)||end<Date.now()/1000+2*86400||m.price_cents!==5000||m.initial_price_cents!==0||m.checkout_email!==email)throw Error();
  await recordPurchaseAcceptance(req,{kind:'membership',reference:m.id,mode,accountId:account?.id??null,guestHash:guestHash(token!),version:legacyTrialVersion,terms:legacyTrialTerms,amountCents:5000});
  const customer=await stripe.customers.create({email,metadata:{icash_membership:m.id}},{idempotencyKey:`legacy-trial-customer:${m.id}`});
  const s=await stripe.checkout.sessions.create({integration_identifier:'icash-legacy-trial-'+m.id.replaceAll('-','').slice(0,8).replace(/[0-9]/g,d=>String.fromCharCode(97+Number(d))),mode:'subscription',customer:customer.id,payment_method_collection:'always',phone_number_collection:{enabled:true},automatic_tax:{enabled:false},line_items:[{price_data:{currency:'usd',unit_amount:5000,recurring:{interval:'month'},product_data:{name:'iCash X software — returning customer offer',description:'Two calendar months free, then $50/month.'}},quantity:1}],subscription_data:{trial_end:end,trial_settings:{end_behavior:{missing_payment_method:'cancel'}},metadata:{icash_membership:m.id,icash_legacy_trial:legacyTrialVersion}},metadata:{icash_membership:m.id,icash_legacy_trial:legacyTrialVersion,icash_terms_version:legacyTrialVersion},custom_text:{submit:{message:legacyTrialSummary+` [Billing policy](${origin}/costs-and-disclosures#refunds).`}},success_url:origin+'/legacy-offer?purchase='+m.id+'&session_id={CHECKOUT_SESSION_ID}',cancel_url:origin+'/legacy-offer?cancelled=1'},{idempotencyKey:`legacy-trial-checkout:${m.id}:${m.legacy_trial_attempt??1}`});
  if(s.livemode!==(mode==='live')||!s.url)throw Error();
  const saved=await db<Membership[]>(`icash_memberships?id=eq.${m.id}&state=eq.pending&legacy_trial_attempt=eq.${m.legacy_trial_attempt??1}`,'PATCH',{stripe_session_id:s.id,checkout_url:s.url});if(saved.length!==1)throw Error();
  return NextResponse.json({url:s.url},{headers});
 }catch{return NextResponse.json({error:'We could not open this offer. Use your original purchase email, or contact support if you already have a checkout or subscription.'},{status:409,headers});}
}
