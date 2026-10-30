import type Stripe from 'stripe';
import type {Membership} from './membership.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Owner={guest:string;userId:string|null;mode:'live'|'test';email:string};

/** Only the original browser or verified email can replace an unpaid checkout.
 * Provider expiry must be observed before releasing the database reservation. */
export async function recoverOrdinaryCheckout(db:Database,stripe:Stripe,owner:Owner,reconcile:(m:Membership)=>Promise<unknown>):Promise<string|null>{
 const binding={p_guest:owner.guest,p_user:owner.userId,p_mode:owner.mode,p_email:owner.email};
 const pending=await db<Membership[]>('rpc/icash_ordinary_checkout_recovery','POST',binding);
 if(pending.length>5)throw Error('Checkout recovery requires review');
 for(const m of pending){
  if(!m.stripe_session_id||m.state!=='pending'||m.legacy_trial_offer||m.stripe_subscription_id||m.paid_through)throw Error('Checkout outcome unresolved');
  const verify=(s:Stripe.Checkout.Session)=>{
   if(s.id!==m.stripe_session_id||s.mode!=='subscription'||s.livemode!==(owner.mode==='live')||s.metadata?.icash_membership!==m.id||s.metadata?.icash_legacy_trial)throw Error('Checkout binding mismatch');
  };
  let session=await stripe.checkout.sessions.retrieve(m.stripe_session_id);verify(session);
  if(session.status==='open'){
   try{await stripe.checkout.sessions.expire(session.id);}catch{/* Read the original outcome, including a concurrent completion; never create a replacement on uncertainty. */}
   session=await stripe.checkout.sessions.retrieve(session.id);verify(session);
  }
  if(session.status==='complete'){await reconcile(m);return m.id;}
  if(session.status!=='expired'||session.subscription!==null||session.payment_intent!==null)throw Error('Checkout outcome unresolved');
  await db('rpc/icash_release_ordinary_checkout','POST',{...binding,p_membership:m.id,p_receipt:{id:session.id,status:session.status,mode:session.mode,livemode:session.livemode,subscription:session.subscription,payment_intent:session.payment_intent,membership:m.id}});
 }
 return null;
}
