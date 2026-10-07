import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {currentUser} from '@/lib/account-auth';
import {db,guestHash} from '@/lib/stripe-test';
import {allowedOrigin,fundingMode} from '@/lib/funding-policy';
import {fundingStripe,limitRequest,validGuest} from '@/lib/funding';
import {customerFundingReady} from '@/lib/launch-readiness';
import {membershipOffer,accountMembership,publicMembership,reconcileMembershipCheckout,stopMembership,membershipRetentionOffer,retainMembership,retentionVersion,type Membership} from '@/lib/membership';
import {membershipTerms,membershipTermsVersion} from '@/lib/membership-policy';
import {checkoutCustomerContext} from '@/lib/checkout-customer-context';
import {checkoutPublishableKey,membershipCheckoutPresentation,checkoutMatchesPresentation} from '@/lib/embedded-checkout-policy';
import {checkoutVipSession,paidVipDestination} from '@/lib/webinar-vip';
const headers={'Cache-Control':'private, no-store'};
export const dynamic='force-dynamic';
async function owner(create=false){const jar=await cookies();let token=jar.get('icash_funding_guest')?.value;if(create&&!validGuest(token)){token=randomBytes(32).toString('hex');jar.set('icash_funding_guest',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:86400*30});}const user=await currentUser(true);const [account]=user?await db<{id:string}[]>(`icash_accounts?owner_user_id=eq.${user.id}&select=id&limit=1`):[];return {token,user,account,hash:validGuest(token)?guestHash(token):null};}
export async function GET(req:Request){try{
 const offer=await membershipOffer(),{account,hash,user}=await owner(),mode=fundingMode(),sessionId=new URL(req.url).searchParams.get('session_id');let m:Membership|null=null;
 if(sessionId&&!/^cs_(live|test)_[A-Za-z0-9]{1,240}$/.test(sessionId))return NextResponse.json({error:'Invalid checkout reference.'},{status:400,headers});
 const scope=account?`account_id=eq.${account.id}`:hash?`guest_hash=eq.${hash}&account_id=is.null`:null;
 if(scope&&mode){const rows=await db<Membership[]>(`icash_memberships?${scope}&mode=eq.${mode}${sessionId?'&stripe_session_id=eq.'+sessionId:''}&order=created_at.desc&select=*&limit=1`);m=rows[0]??null;if(sessionId&&!m)return NextResponse.json({error:'Sign in with your payment email to open this purchase.'},{status:404,headers});if(m?.stripe_session_id&&(sessionId||m.state==='pending'||!m.paid_through))m=await reconcileMembershipCheckout(m);}
 const customer=await checkoutCustomerContext(hash,user?.email);
 const postPurchaseUrl=await paidVipDestination(m).catch(()=>null);
 return NextResponse.json({postPurchaseUrl,offer,mode,embeddedReady:!!checkoutPublishableKey(mode),customerName:customer.name??'',ready:offer.enabled&&await customerFundingReady(),membership:publicMembership(m),retentionOffer:await membershipRetentionOffer(m),needsClaim:!!m?.paid_through&&!m.account_id,email:m?.paid_through&&!user?m.payer_email:user?.email??customer.email??null},{headers});
 }catch{return NextResponse.json({error:'Could not check software access. Please retry.'},{status:503,headers});}}
const input=z.discriminatedUnion('action',[z.object({action:z.literal('checkout'),accepted:z.literal(true),version:z.literal(membershipTermsVersion),revision:z.number().int().positive(),totalCents:z.number().int().positive(),embedded:z.boolean().optional(),webinarSessionId:z.string().uuid().optional()}).strict(),z.object({action:z.literal('cancel')}).strict(),z.object({action:z.literal('manage')}).strict(),z.object({action:z.literal('retain'),accepted:z.literal(true),version:z.literal(retentionVersion),priceCents:z.number().int().positive(),months:z.literal(6)}).strict()]);
export async function POST(req:Request){
 if(!allowedOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403,headers});
 try{
 const raw=await req.text();if(raw.length>1024)throw Error();const i=input.parse(JSON.parse(raw)),mode=fundingMode();if(!mode)throw Error();const {token,hash,account,user}=await owner(true);await limitRequest(req,'membership',token!,8,600);const stripe=fundingStripe(),origin=req.headers.get('origin')!;
 if(i.action!=='checkout'){
  if(!account||!user)return NextResponse.json({error:'Sign in to manage your software subscription.'},{status:401,headers});const m=await accountMembership(account.id);if(!m)throw Error();
  if(i.action==='retain'){
   if(i.priceCents!==m.price_cents-Math.round(m.price_cents*.5))return NextResponse.json({error:'The offer changed. Reopen it to review the current price.'},{status:409,headers});
   try{await retainMembership(m);}catch{return NextResponse.json({error:'Could not confirm the offer. You can retry or cancel your subscription.'},{status:409,headers});}
   return NextResponse.json({saved:true,message:'50% off is applied for 6 months, starting with your next renewal. Your subscription stays active.'},{headers});
  }
  if(i.action==='cancel'){
   try{await stopMembership(m);}catch(e){if(e instanceof Error&&e.message==='MEMBERSHIP_CANCELLATION_PENDING')return NextResponse.json({saved:false,stopped:true,message:'Your workspace is locked and new bot work has stopped. Subscription cancellation is retrying automatically. Your unused credits are saved.'},{status:202,headers});throw e;}
   return NextResponse.json({saved:true,stopped:true,message:'Subscription cancelled. New bot work has stopped. Your unused credits are saved until you renew.'},{headers});
  }
  if(!m.stripe_customer_id)throw Error();
  const config=await stripe.billingPortal.configurations.create({business_profile:{headline:'Manage your iCash X software subscription'},features:{payment_method_update:{enabled:true},invoice_history:{enabled:true},subscription_cancel:{enabled:true,mode:'immediately',proration_behavior:'none'}}},{idempotencyKey:'icash-membership-portal-v2-immediate'});
  const portal=await stripe.billingPortal.sessions.create({customer:m.stripe_customer_id,configuration:config.id,return_url:origin+'/?settings=billing'});return NextResponse.json({url:portal.url},{headers});
 }
 const offer=await membershipOffer();if(!offer.enabled||!await customerFundingReady())return NextResponse.json({error:'Software checkout is currently unavailable.'},{status:503,headers});
 if(i.revision!==offer.revision||i.totalCents!==offer.priceCents)return NextResponse.json({error:'The software price changed. Refresh and review it before paying.'},{status:409,headers});
 const publishableKey=checkoutPublishableKey(mode),embedded=i.embedded===true;
 if(embedded&&!publishableKey)return NextResponse.json({error:'Payment inside the room is not connected yet. Use secure checkout to continue.'},{status:503,headers});
 const checkoutResult=(s:import('stripe').default.Checkout.Session)=>embedded?{clientSecret:s.client_secret,sessionId:s.id,publishableKey}:{url:s.url};
 const filter=account?`account_id=eq.${account.id}`:`guest_hash=eq.${hash}`;const [prior]=await db<Membership[]>(`icash_memberships?${filter}&mode=eq.${mode}&state=neq.cancelled&select=*&limit=1`);
 if(prior){
  if(prior.account_id!==(account?.id??null))return NextResponse.json({error:'This browser has another account’s checkout. Sign in to that account to continue.'},{status:409,headers});
  if(prior.state!=='pending')return NextResponse.json({error:'Your software subscription already exists. Open your workspace or manage your payment.'},{status:409,headers});
  if(prior.stripe_session_id){const s=await stripe.checkout.sessions.retrieve(prior.stripe_session_id);if(s.metadata?.icash_membership!==prior.id||s.livemode!==(mode==='live'))throw Error();if(s.status==='complete'){await reconcileMembershipCheckout(prior);return NextResponse.json({error:'Your payment is being confirmed. Refresh; do not pay again.'},{status:409,headers});}if(s.status==='open'&&prior.price_cents===offer.priceCents&&prior.offer_revision===offer.revision&&prior.consent_version===membershipTermsVersion&&checkoutMatchesPresentation(s,embedded))return NextResponse.json(checkoutResult(s),{headers});if(s.status==='open')await stripe.checkout.sessions.expire(s.id);await db(`icash_memberships?id=eq.${prior.id}`,'PATCH',{state:'cancelled'});}
  else if(prior.price_cents!==offer.priceCents||prior.offer_revision!==offer.revision||prior.consent_version!==membershipTermsVersion)await db(`icash_memberships?id=eq.${prior.id}`,'PATCH',{state:'cancelled'});
 }
 const m=await db<Membership>('rpc/icash_begin_membership','POST',{p_guest:hash,p_account:account?.id??null,p_mode:mode,p_price:offer.priceCents,p_revision:offer.revision,p_terms:membershipTerms(offer.priceCents)});
 if(!m.post_purchase_webinar_id){const vipId=await checkoutVipSession(i.webinarSessionId);if(vipId)await db(`icash_memberships?id=eq.${m.id}&post_purchase_webinar_id=is.null`,'PATCH',{post_purchase_webinar_id:vipId});}
 const contact=await checkoutCustomerContext(hash,user?.email);
 const customer=contact.name||contact.phone?await stripe.customers.create({...contact,metadata:{icash_membership:m.id}},{idempotencyKey:`membership-customer:${m.id}`}):null;
 const s=await stripe.checkout.sessions.create({mode:'subscription',...(customer?{customer:customer.id}:{customer_email:contact.email}),payment_method_types:['card'],phone_number_collection:{enabled:true},automatic_tax:{enabled:false},line_items:[{price_data:{currency:'usd',unit_amount:m.price_cents,recurring:{interval:'month'},product_data:{name:'iCash X software access',description:'Software membership. Work credits are purchased separately; none are included.'}},quantity:1}],subscription_data:{metadata:{icash_membership:m.id}},metadata:{icash_membership:m.id,icash_terms_version:membershipTermsVersion},custom_text:{submit:{message:membershipTerms(m.price_cents)}},...membershipCheckoutPresentation(embedded,origin)},{idempotencyKey:`membership-checkout:${m.id}`});
 if(!checkoutMatchesPresentation(s,embedded)||s.livemode!==(mode==='live'))throw Error();await db(`icash_memberships?id=eq.${m.id}`,'PATCH',{stripe_session_id:s.id,checkout_url:s.url});return NextResponse.json(checkoutResult(s),{headers});
 }catch(e){return NextResponse.json({error:e instanceof z.ZodError?'Review and accept the current software price to continue.':'Could not open billing. Please refresh and try again.'},{status:400,headers});}
}
