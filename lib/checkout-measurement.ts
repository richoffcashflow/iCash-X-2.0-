import {cookies} from 'next/headers';
import {isIP} from 'node:net';
import {db} from '@/lib/stripe-test';
import {webinarSettings} from '@/lib/webinar-meta';
import {webinarVisitor} from '@/lib/webinar-server';
import {automaticMeasurementEligible} from '@/lib/webinar-measurement-policy';
import {bindReminderCheckout} from '@/lib/webinar-reminder-server';
import {legacyAdMeasurementExcluded} from '@/lib/legacy-launch-measurement';

/** Called only after billing verifies ownership of an open Stripe Checkout.
 * A checkout identity does not create a webinar session or marketing consent. */
export async function bindCheckoutMeasurement(req:Request,checkoutId:string,mode:string){
 if(process.env.VERCEL_ENV!=='production'||mode!=='live'||!/^cs_live_[A-Za-z0-9]{1,240}$/.test(checkoutId))return;
 await bindReminderCheckout(req,checkoutId,mode);
 try{
  if(await legacyAdMeasurementExcluded(req))return;
  const signal=AbortSignal.timeout(2000),settings=await webinarSettings(signal);if(!settings.meta.enabled||!settings.meta.pixelId)return;
  const choice=req.headers.get('x-icash-measurement'),blocked=req.headers.get('sec-gpc')==='1'||choice==='deny';
  const visitor=await webinarVisitor(!blocked&&choice==='automatic',undefined,signal),metadata:Record<string,string>={};
  if(await legacyAdMeasurementExcluded(req,visitor.id))return;
  if(!blocked){
   const jar=await cookies(),fbp=jar.get('_fbp')?.value,fbc=jar.get('_fbc')?.value,click=req.headers.get('x-icash-fbclid');
   if(fbp&&/^fb\.\d+\.\d+\.[A-Za-z0-9_-]{1,200}$/.test(fbp))metadata.fbp=fbp;
   if(fbc&&/^fb\.\d+\.\d+\.[A-Za-z0-9_-]{1,400}$/.test(fbc))metadata.fbc=fbc;
   else if(click&&/^[A-Za-z0-9_-]{1,400}$/.test(click))metadata.fbc=`fb.1.${Date.now()}.${click}`;
   metadata.client_user_agent=(req.headers.get('user-agent')||'').slice(0,500);
   const ip=process.env.VERCEL==='1'?req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim():null;
   if(ip&&isIP(ip))metadata.client_ip_address=ip;
  }
  await db('rpc/icash_webinar_measurement_access','POST',{p_visitor:visitor.id,p_action:blocked?'deny':choice==='automatic'?'automatic':'read',p_automatic_eligible:automaticMeasurementEligible(req.headers),p_blocked:blocked,p_metadata:metadata},signal);
  await db('rpc/icash_bind_checkout_measurement','POST',{p_checkout:checkoutId,p_visitor:visitor.id},signal);
 }catch{/* Optional attribution cannot stop checkout or create a payment retry. */}
}
