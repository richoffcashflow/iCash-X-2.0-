import {cookies} from 'next/headers';
import {db,guestHash} from '@/lib/stripe-test';
import {validGuest} from '@/lib/funding';
import {membershipAccessible} from '@/lib/membership-policy';
import {webinarSession,WebinarError} from '@/lib/webinar-server';
import {webinarLink} from '@/lib/webinar-links';
import type {Membership} from '@/lib/membership';

/** Resolve once at checkout creation; retries and payment returns keep this session. */
export async function checkoutVipSession(sourceSession?:string):Promise<string|null>{
 if(sourceSession){
  const {s:session}=await webinarSession(sourceSession);
  if(session.is_preview||session.config.parentWebinarId)throw new WebinarError(400,'Use the main webinar to open this checkout.');
  const [vip]=await db<{id:string}[]>(`icash_webinars?parent_webinar_id=eq.${session.webinar_id}&select=id&limit=1`);
  return vip?.id??null;
 }
 const [settings]=await db<{config:{homepageVipId?:string|null}}[]>('icash_webinar_settings?id=eq.1&select=config');
 const chosen=settings?.config.homepageVipId;
 const [vip]=await db<{id:string}[]>(`icash_webinars?parent_webinar_id=not.is.null&${chosen?'id=eq.'+chosen+'&':'config->>status=eq.published&'}select=id&order=public_code.asc&limit=1`);
 return vip?.id??null;
}

export async function paidVipDestination(m:Membership|null):Promise<string|null>{
 if(!m||m.mode!=='live'||!membershipAccessible(m)||!m.post_purchase_webinar_id)return null;
 const [row]=await db<{public_code:number;config:{status:string;videoUrl:string}}[]>(`icash_webinars?id=eq.${m.post_purchase_webinar_id}&parent_webinar_id=not.is.null&select=public_code,config&limit=1`);
 return row?.config.status==='published'&&row.config.videoUrl?webinarLink({publicCode:String(row.public_code)}):null;
}

/** VIP access requires a paid account or this browser's verified paid checkout. */
export async function webinarVipAccess(accountId?:string):Promise<boolean>{
 const token=(await cookies()).get('icash_funding_guest')?.value;
 const scope=accountId?`account_id=eq.${accountId}`:validGuest(token)?`guest_hash=eq.${guestHash(token!)}&account_id=is.null`:null;
 if(!scope)return false;
 const rows=await db<{state:string;paid_through:string|null}[]>(`icash_memberships?${scope}&mode=eq.live&state=eq.active&select=state,paid_through&limit=10`);
 return rows.some(m=>membershipAccessible(m));
}
