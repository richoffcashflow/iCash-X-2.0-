import {z} from 'zod';
import {cookies} from 'next/headers';
import {randomBytes,randomUUID} from 'node:crypto';
import {guestHash} from '@/lib/stripe-test';
import {validGuest} from '@/lib/funding';
import {webinarCustomerAccount,webinarCustomerPaid} from '@/lib/webinar-account-adapter';
import {webinarSite} from '@/lib/webinar-site';
import {db} from '@/lib/stripe-test';
import {publicWebinar,settingsSchema,webinarSchema,visitorTimezone,webinarFromRow,offerDestination,hasWebinarVideo,webinarReturnPosition,type WebinarSettings,type WebinarRow} from '@/lib/webinar-policy';
import {sessionWebinarOffers} from '@/lib/webinar-offer-server';
import {selectOffer} from '@/packages/webinar-engine/src/index';
import {selectRecording} from '@/lib/webinar-recordings';
import {webinarViewerLocation} from '@/lib/webinar-viewer-location';
import {snapshotChat} from '@/lib/webinar-variants';
import {approximateRegion} from '@/lib/webinar-activity';
import {webinarReturnJourney} from '@/lib/webinar-ad-returns';
import {webinarLink} from '@/lib/webinar-links';
import {webinarViewerMembership,returningBuyerVip} from '@/lib/webinar-vip';
import {vipActive} from '@/lib/vip-policy';
import {webinarBody,webinarError,WebinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarOwner,webinarVisitor,webinarPaid,type WebinarSession} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({timezone:z.string().max(80),code:z.string().regex(/^\d{6,12}$/).optional(),variant:z.enum(['day','night']).optional(),resume:z.string().max(600).optional(),returnToWebinar:z.boolean().optional(),preview:z.string().uuid().optional(),attribution:z.record(z.string().max(250)).optional()}).strict().parse(await webinarBody(req,3000));
 await webinarLimit(req,'entry','entry',120,60);
 if(i.preview){try{await webinarOwner();}catch(e){
  if(!(e instanceof Error&&e.message==='DASHBOARD_PASSWORD_REQUIRED')&&(!(e instanceof WebinarError)||![401,403].includes(e.status)))throw e;
  const [published]=await db<{public_code:number|null}[]>(`icash_webinars?id=eq.${i.preview}&config->>status=eq.published&select=public_code&limit=1`);
  return Response.json({previewLocked:true,publicPath:published?.public_code?webinarLink({publicCode:String(published.public_code)}):null},{headers:webinarHeaders});
 }}
 const [rows,account]=await Promise.all([db<WebinarRow[]>(`icash_webinars?${i.preview?'id=eq.'+i.preview+'&':i.code?'public_code=eq.'+i.code+'&':'parent_webinar_id=is.null&config->>status=eq.published&'}select=config,public_code,parent_webinar_id&order=public_code.asc&limit=1`),i.preview?Promise.resolve(null):webinarCustomerAccount()]);
 const current=rows[0]?webinarFromRow(rows[0]):null;
 if(!current||!i.preview&&(current.status!=='published'||!hasWebinarVideo(current)))return Response.json({unavailable:true,message:'This webinar is not available yet.'},{headers:webinarHeaders});
 // The authenticated owner can test the published funnel with measurement on.
 // Draft previews retain their separate dashboard authorization and isolation.
 const ownerWatching=!i.preview&&account?.isOwner===true;
 let target=current,paidAdReturn=false;
 if(!i.preview&&!ownerWatching){
  const membership=await webinarViewerMembership(account?.id);
  if(vipActive(membership))return Response.json({redirect:webinarSite.workspacePath},{headers:webinarHeaders});
  if(current.parentWebinarId){
   if(!membership)return Response.json({redirect:webinarSite.checkoutPath},{headers:webinarHeaders});
  }else if(membership){
   const vip=await returningBuyerVip(membership,current.id);
   if(!vip)return Response.json({redirect:'/webinar/upgrade'},{headers:webinarHeaders});
   target=vip;paidAdReturn=true;
  }else if(account){
   return Response.json({redirect:account.destination,needsBudget:account.needsBudget},{headers:webinarHeaders});
  }
 }
 const visitor=await webinarVisitor(true,i.resume);const timezone=visitorTimezone(process.env.VERCEL?req.headers.get('x-vercel-ip-timezone'):null,i.timezone);
 const location=webinarViewerLocation(req.headers);
 const attribution=Object.fromEntries(Object.entries(i.attribution??{}).filter(([k])=>['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ad_id','adset_id','campaign_id'].includes(k)));
 const jar=await cookies();let fundingGuest=jar.get('icash_funding_guest')?.value;if(!validGuest(fundingGuest)){fundingGuest=randomBytes(32).toString('hex');jar.set('icash_funding_guest',fundingGuest,{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge:86400*30});}
 const activityRegion=process.env.VERCEL?approximateRegion(req.headers.get('x-vercel-ip-country'),req.headers.get('x-vercel-ip-country-region')):null;
 // Independent entry reads run together; every access check still finishes before returning a session.
 const [initialHistory,settingsRows,offers,,paid]=await Promise.all([db<WebinarSession[]>(`icash_webinar_sessions?visitor_id=eq.${visitor.id}&webinar_id=eq.${target.id}&is_preview=eq.${!!i.preview}&select=*&order=created_at.desc&limit=100`),db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config'),i.preview?Promise.resolve([]):db<{session_id:string;created_at:string;kind:string;event_key:string}[]>(`icash_webinar_events?visitor_id=eq.${visitor.id}&kind=in.(pitch_shown,checkout_opened)&select=session_id,created_at,kind,event_key&order=created_at.desc&limit=1000`),
  db(`icash_webinar_visitors?id=eq.${visitor.id}`,'PATCH',{timezone,activity_region:activityRegion,funding_guest_hash:guestHash(fundingGuest),last_seen_at:new Date().toISOString(),...(account?{account_id:account.id}:{}),...(Object.keys(attribution).length?{attribution}:{})}),
  !i.preview&&!ownerWatching&&!target.parentWebinarId?Promise.all([webinarCustomerPaid(guestHash(fundingGuest)),webinarPaid(visitor)]).then(results=>results.some(Boolean)):Promise.resolve(false)
 ]);
 if(paid)return Response.json({redirect:webinarSite.workspacePath},{headers:webinarHeaders});
 const settings=settingsSchema.parse(settingsRows[0].config);
 const history=initialHistory.filter(h=>h.webinar_id===target.id);
 let journey=webinarReturnJourney(history,offers,timezone,settings.routing.checkoutWindowHours);
 // Paid main/ad entry always starts VIP at zero. Canonicalizing to VIP makes
 // refreshes ordinary returns; racing requests reuse the newly created session.
 if(paidAdReturn&&journey.kind!=='new')journey={kind:'advance',sessionId:journey.sessionId};
 if((i.returnToWebinar||ownerWatching)&&journey.kind==='checkout')journey={kind:'advance',sessionId:journey.sessionId};
 if(!i.preview&&journey.kind==='checkout'){
  if(target.parentWebinarId)return Response.json({redirect:'/webinar/upgrade'},{headers:webinarHeaders});
  const priorSessionId=journey.sessionId;
  const previous=history.find(h=>h.id===priorSessionId)!;
  const lastOpened=offers.find(o=>o.session_id===previous.id&&o.kind==='checkout_opened'&&o.event_key.startsWith('offer:'))?.event_key.slice(6);
  const offer=selectOffer(await sessionWebinarOffers(previous,previous.max_seconds),previous.max_seconds,Date.now(),lastOpened);
  if(offer)return Response.json({redirect:offer.action==='checkout'?`${offerDestination(offer)}?webinar_session=${previous.id}`:offerDestination(offer)},{headers:webinarHeaders});
  journey={kind:'advance',sessionId:previous.id};
 }
 const resumeId=journey.kind==='resume'?journey.sessionId:null;
 const unfinished=history.find(h=>h.id===resumeId);
 const webinar=unfinished?.config??target;
 // Pair a new VIP session with the recording this visitor actually watched.
 // Never re-evaluate their main recording just because sunset passed meanwhile.
 let pairedVersion:'day'|'night'|undefined;
 if(!i.preview&&target.parentWebinarId&&!unfinished){
  const [source]=await db<WebinarSession[]>(`icash_webinar_sessions?visitor_id=eq.${visitor.id}&webinar_id=eq.${target.parentWebinarId}&is_preview=eq.false&select=config&order=created_at.desc&limit=1`);
  if(source)pairedVersion=source.config.recordingVersion==='night'?'night':'day';
 }
 const sessionId=randomUUID();
 const snapshot=snapshotChat(unfinished&&!i.preview?webinarSchema.parse(webinar):selectRecording(webinarSchema.parse(webinar),timezone,new Date(),settings.routing,i.preview?i.variant:pairedVersion,location),sessionId);
 const returnStart=!i.preview&&!ownerWatching&&!target.parentWebinarId&&journey.kind==='advance'?webinarReturnPosition(snapshot):0;
 const session=await db<WebinarSession>('rpc/icash_webinar_begin','POST',{p_visitor:visitor.id,p_id:sessionId,p_config:returnStart?{...snapshot,_returnStartSeconds:returnStart}:snapshot,p_advance_from:!i.preview&&journey.kind==='advance'?journey.sessionId:null,p_preview:!!i.preview});
 const messages=await db<{id:string;role:'user'|'assistant';text:string;playback_seconds:number|null}[]>(`icash_webinar_messages?session_id=eq.${session.id}&role=eq.user&select=id,role,text,playback_seconds,display_name,public_status&order=created_at.desc&limit=60`).then(rows=>rows.reverse()).catch(()=>[]);
 return Response.json({webinar:publicWebinar(webinarSchema.parse(session.config)),...(session.config.id!==current.id?{canonicalPath:webinarLink(session.config)}:{}),sessionId:session.id,progress:session.completed_at?0:session.progress_seconds,name:visitor.name??'',email:visitor.email??'',phone:visitor.phone??'',contactSaved:!!visitor.email&&!!visitor.phone,messages,preview:!!i.preview,ownerWatching,serverNow:Date.now()},{headers:webinarHeaders});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:'The webinar link could not be read.'},{status:400,headers:webinarHeaders});return webinarError(e);}}
