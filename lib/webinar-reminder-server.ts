import {cookies} from 'next/headers';
import {randomUUID} from 'node:crypto';
import {db} from '@/lib/stripe-test';
import {readWebinarToken,signWebinarToken} from '@/lib/webinar-token';
import {webinarKey,webinarToken,webinarVisitor} from '@/lib/webinar-server';
import {reminderCookie,reminderHintCookie,reminderWindowSeconds,reminderRequestAllowed} from '@/lib/webinar-reminder-policy';

/** Analytics must never prevent a return link from opening or a checkout from loading. */
export async function beginReminderVisit(req:Request,jobId:string,visitorId:string){
 if(process.env.VERCEL_ENV!=='production'||req.method!=='GET'||!reminderRequestAllowed(req))return;
 try{
  const id=randomUUID(),signal=AbortSignal.timeout(1500);
  const saved=await db<boolean>('rpc/icash_webinar_open_reminder','POST',{p_job:jobId,p_visit:id,p_visitor:visitorId},signal);
  if(!saved)return;
  const jar=await cookies(),options={secure:process.env.NODE_ENV!=='development',sameSite:'lax' as const,path:'/',maxAge:reminderWindowSeconds};
  jar.set(reminderCookie,signWebinarToken(id,'reminder',reminderWindowSeconds,webinarKey()),{...options,httpOnly:true});
  // This opaque hint is only a wake-up signal. The server never trusts it.
  jar.set(reminderHintCookie,id,{...options,httpOnly:false});
  jar.set('icash_webinar',webinarToken(visitorId,'visitor',86400*180),{...options,httpOnly:true,maxAge:86400*180});
 }catch{console.warn('Webinar reminder visit could not be recorded.');}
}
export async function reminderVisitId(req:Request){
 if(process.env.VERCEL_ENV!=='production'||!reminderRequestAllowed(req))return null;
 const jar=await cookies();return readWebinarToken(jar.get(reminderCookie)?.value,'reminder',webinarKey());
}
/** Called inside the existing, ownership-verified open Checkout path, including retries. */
export async function bindReminderCheckout(req:Request,checkoutId:string,mode:string){
 if(mode!=='live'||!/^cs_live_[A-Za-z0-9]{1,240}$/.test(checkoutId))return;
 try{
  const visit=await reminderVisitId(req);if(!visit)return;
  const signal=AbortSignal.timeout(1500),visitor=await webinarVisitor(false,undefined,signal);
  await db('rpc/icash_webinar_bind_reminder_checkout','POST',{p_visit:visit,p_visitor:visitor.id,p_checkout:checkoutId},signal);
 }catch{console.warn('Webinar reminder checkout attribution could not be recorded.');}
}
