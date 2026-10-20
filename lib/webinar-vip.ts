import {legacyInviteContext} from '@/lib/legacy-launch-server';
import {cookies} from 'next/headers';
import {db,guestHash} from '@/lib/stripe-test';
import {validGuest} from '@/lib/funding';
import {vipActive} from '@/lib/vip-policy';
import {membershipAccessible} from '@/lib/membership-policy';
import {webinarSession,WebinarError} from '@/lib/webinar-server';
import {webinarLink} from '@/lib/webinar-links';
import {visitorTimezone,isNight,bestConvertingWebinar,type ViewerLocation} from '@/packages/webinar-engine/src/index';
import {routingSchema,hasWebinarVideo,webinarFromRow,type WebinarSettings,type WebinarRow} from '@/lib/webinar-policy';
import {selectRecording} from '@/lib/webinar-recordings';
import {availableWebinarRows,webinarConversionRecordings} from '@/lib/webinar-selection';
import type {Membership} from '@/lib/membership';

/** Resolve once at checkout creation; retries and payment returns keep this session. */
export async function checkoutVipSession(sourceSession?:string,context:{timezone?:string;ipTimezone?:string|null;location?:ViewerLocation|null}={},now=new Date()):Promise<string|null>{
 if(sourceSession){
  const {s:session}=await webinarSession(sourceSession);
  if(session.is_preview||session.config.parentWebinarId)throw new WebinarError(400,'Use the main webinar to open this checkout.');
  const [vip]=await db<{id:string}[]>(`icash_webinars?parent_webinar_id=eq.${session.webinar_id}&select=id&limit=1`);
  return vip?.id??null;
 }
 const invitation=await legacyInviteContext().catch(()=>null);
 if(invitation){
  const [launch]=await db<{webinar_id:string|null}[]>(`icash_legacy_launches?id=eq.${invitation.launch_id}&select=webinar_id&limit=1`);
  if(!launch?.webinar_id)return null;
  const [vip]=await db<{id:string}[]>(`icash_webinars?parent_webinar_id=eq.${launch.webinar_id}&config->>status=eq.published&select=id&limit=1`);
  return vip?.id??null;
 }
 const [settings]=await db<{config:Partial<WebinarSettings>}[]>('icash_webinar_settings?id=eq.1&select=config');
 const config=settings?.config??{},routing=routingSchema.parse(config.routing??{nightStartsAt:18,nightEndsAt:6});
 const timezone=visitorTimezone(context.ipTimezone??null,context.timezone??'America/Chicago');
 const chosen=isNight(timezone,now,routing,context.location)?config.homepageVipNightId??config.homepageVipId:config.homepageVipId;
 if(config.homepageVipMode==='best-converting'){
  try{
   const rows=await db<WebinarRow[]>('icash_webinars?config->>status=eq.published&select=config,public_code,parent_webinar_id&order=public_code.asc&limit=1000','GET',undefined,AbortSignal.timeout(1800));
   const available=availableWebinarRows(rows).filter(w=>w.status==='published'&&hasWebinarVideo(w));
   const vips=new Map(available.filter(w=>w.parentWebinarId).map(w=>[w.parentWebinarId,w]));
   const candidates=available.filter(w=>!w.parentWebinarId&&vips.has(w.id)).map(w=>selectRecording(w,timezone,now,routing,undefined,context.location));
   if(candidates.length){const winner=bestConvertingWebinar(candidates,await webinarConversionRecordings());if(winner)return vips.get(winner.id)!.id;}
  }catch{/* An optional ranking cannot stop checkout; keep the selected default. */}
 }
 const [vip]=await db<{id:string}[]>(`icash_webinars?parent_webinar_id=not.is.null&${chosen?'id=eq.'+chosen+'&':'config->>status=eq.published&'}select=id&order=public_code.asc&limit=1`);
 return vip?.id??null;
}

export async function paidVipDestination(m:Membership|null):Promise<string|null>{
 if(!m||m.mode!=='live'||!membershipAccessible(m)||!m.post_purchase_webinar_id)return null;
 const [row]=await db<{public_code:number;config:{status:string;videoUrl:string;nightVersion?:{videoUrl:string}|null}}[]>(`icash_webinars?id=eq.${m.post_purchase_webinar_id}&parent_webinar_id=not.is.null&select=public_code,config&limit=1`);
 return row?.config.status==='published'&&hasWebinarVideo(row.config)?webinarLink({publicCode:String(row.public_code)}):null;
}

type ViewerMembership=Pick<Membership,'mode'|'state'|'paid_through'|'vip_until'|'post_purchase_webinar_id'>;
/** Only verified account ownership or an unclaimed checkout in this browser counts. */
export async function webinarViewerMembership(accountId?:string):Promise<ViewerMembership|null>{
 const token=(await cookies()).get('icash_funding_guest')?.value;
 const scope=accountId?`account_id=eq.${accountId}`:validGuest(token)?`guest_hash=eq.${guestHash(token!)}&account_id=is.null`:null;
 if(!scope)return null;
 const rows=await db<ViewerMembership[]>(`icash_memberships?${scope}&mode=eq.live&state=eq.active&select=mode,state,paid_through,vip_until,post_purchase_webinar_id&order=created_at.desc&limit=10`);
 const paid=rows.filter(m=>m.mode==='live'&&membershipAccessible(m));
 return paid.find(m=>vipActive(m))??paid[0]??null;
}
export async function webinarVipAccess(accountId?:string):Promise<boolean>{return !!await webinarViewerMembership(accountId);}

/** A returning Standard buyer keeps the VIP paired with their purchase. */
export async function returningBuyerVip(m:ViewerMembership,mainId:string){
 if(m.mode!=='live'||!membershipAccessible(m))return null;
 const selectors=[...(m.post_purchase_webinar_id?[`id=eq.${m.post_purchase_webinar_id}&parent_webinar_id=not.is.null`]:[]),`parent_webinar_id=eq.${mainId}`];
 for(const selector of selectors){
  const [row]=await db<WebinarRow[]>(`icash_webinars?${selector}&config->>status=eq.published&select=config,public_code,parent_webinar_id&order=public_code.asc&limit=1`);
  if(row){const w=webinarFromRow(row);if(w.parentWebinarId&&w.status==='published'&&hasWebinarVideo(w))return w;}
 }
 return null;
}
