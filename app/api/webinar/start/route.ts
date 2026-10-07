import {z} from 'zod';
import {cookies} from 'next/headers';
import {randomBytes,randomUUID} from 'node:crypto';
import {guestHash} from '@/lib/stripe-test';
import {validGuest} from '@/lib/funding';
import {webinarCustomerAccount,webinarCustomerPaid} from '@/lib/webinar-account-adapter';
import {webinarSite} from '@/lib/webinar-site';
import {db} from '@/lib/stripe-test';
import {publicWebinar,settingsSchema,webinarSchema,visitorTimezone,webinarFromRow,webinarOffers,offerDestination,type WebinarSettings,type WebinarRow} from '@/lib/webinar-policy';
import {selectOffer} from '@/packages/webinar-engine/src/index';
import {selectRecording} from '@/lib/webinar-recordings';
import {snapshotChat} from '@/lib/webinar-variants';
import {approximateRegion} from '@/lib/webinar-activity';
import {adReturnWebinar,webinarReturnJourney} from '@/lib/webinar-ad-returns';
import {webinarLink} from '@/lib/webinar-links';
import {webinarVipAccess} from '@/lib/webinar-vip';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarOwner,webinarVisitor,webinarPaid,type WebinarSession} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({timezone:z.string().max(80),code:z.string().regex(/^\d{6,12}$/).optional(),variant:z.enum(['day','night']).optional(),resume:z.string().max(600).optional(),preview:z.string().uuid().optional(),attribution:z.record(z.string().max(250)).optional()}).strict().parse(await webinarBody(req,3000));
 await webinarLimit(req,'entry','entry',120,60);
 if(i.preview)await webinarOwner();
 const rows=await db<WebinarRow[]>(`icash_webinars?${i.preview?'id=eq.'+i.preview+'&':i.code?'public_code=eq.'+i.code+'&':'parent_webinar_id=is.null&config->>status=eq.published&'}select=config,public_code,parent_webinar_id&order=public_code.asc&limit=1`);
 const current=rows[0]?webinarFromRow(rows[0]):null;
 if(!current||!i.preview&&(current.status!=='published'||!current.videoUrl))return Response.json({unavailable:true,message:'This webinar is not available yet.'},{headers:webinarHeaders});
 const account=!i.preview?await webinarCustomerAccount():null;
 if(!i.preview&&current.parentWebinarId){
  if(!await webinarVipAccess(account?.id))return Response.json({redirect:webinarSite.checkoutPath},{headers:webinarHeaders});
 }else if(account){
  try{const v=await webinarVisitor();await db(`icash_webinar_visitors?id=eq.${v.id}`,'PATCH',{account_id:account.id});}catch{/* A signed-in customer can enter without a webinar cookie. */}
  return Response.json({redirect:account.destination,needsBudget:account.needsBudget},{headers:webinarHeaders});
 }
 const visitor=await webinarVisitor(true,i.resume);const timezone=visitorTimezone(process.env.VERCEL?req.headers.get('x-vercel-ip-timezone'):null,i.timezone);
 const attribution=Object.fromEntries(Object.entries(i.attribution??{}).filter(([k])=>['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ad_id','adset_id','campaign_id'].includes(k)));
 const jar=await cookies();let fundingGuest=jar.get('icash_funding_guest')?.value;if(!validGuest(fundingGuest)){fundingGuest=randomBytes(32).toString('hex');jar.set('icash_funding_guest',fundingGuest,{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge:86400*30});}
 const activityRegion=process.env.VERCEL?approximateRegion(req.headers.get('x-vercel-ip-country'),req.headers.get('x-vercel-ip-country-region')):null;
 await db(`icash_webinar_visitors?id=eq.${visitor.id}`,'PATCH',{timezone,activity_region:activityRegion,funding_guest_hash:guestHash(fundingGuest),last_seen_at:new Date().toISOString(),...(Object.keys(attribution).length?{attribution}:{})});
 if(!i.preview&&!current.parentWebinarId&&(await webinarCustomerPaid(guestHash(fundingGuest))||await webinarPaid(visitor)))return Response.json({redirect:webinarSite.workspacePath},{headers:webinarHeaders});
 const [initialHistory,settingsRows,offers]=await Promise.all([db<WebinarSession[]>(`icash_webinar_sessions?visitor_id=eq.${visitor.id}&webinar_id=eq.${current.id}&is_preview=eq.${!!i.preview}&select=*&order=created_at.desc&limit=100`),db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config'),db<{session_id:string;created_at:string;kind:string;event_key:string}[]>(`icash_webinar_events?visitor_id=eq.${visitor.id}&kind=in.(pitch_shown,checkout_opened)&select=session_id,created_at,kind,event_key&order=created_at.desc&limit=1000`)]);
 const settings=settingsSchema.parse(settingsRows[0].config);
 let target=current,history=initialHistory.filter(h=>h.webinar_id===current.id);
 let journey=webinarReturnJourney(history,offers,timezone,settings.routing.checkoutWindowHours);
 // Honor the original checkout first, then a saved alternative; switch at most once.
 for(let attempt=0;attempt<2;attempt++){
 if(!i.preview&&!target.parentWebinarId&&journey.kind==='checkout'){
  const priorSessionId=journey.sessionId;
  const previous=history.find(h=>h.id===priorSessionId)!;
  const lastOpened=offers.find(o=>o.session_id===previous.id&&o.kind==='checkout_opened'&&o.event_key.startsWith('offer:'))?.event_key.slice(6);
  const offer=selectOffer(webinarOffers(previous.config),previous.max_seconds,Date.now(),lastOpened);
  if(offer)return Response.json({redirect:offer.action==='checkout'?`${offerDestination(offer)}?webinar_session=${previous.id}`:offerDestination(offer)},{headers:webinarHeaders});
  journey={kind:'advance',sessionId:previous.id};
 }
 if(attempt===0&&i.code&&!i.preview&&!current.parentWebinarId&&journey.kind==='advance'){
  const next=await adReturnWebinar(current,history,visitor.id,i.attribution,timezone,settings,offers);
  if(next){target=next.webinar;history=next.history;journey=webinarReturnJourney(history,offers,timezone,settings.routing.checkoutWindowHours);continue;}
 }
 break;
 }
 const resumeId=journey.kind==='resume'||target.parentWebinarId&&journey.kind==='checkout'?journey.sessionId:null;
 const unfinished=history.find(h=>h.id===resumeId);
 const webinar=unfinished?.config??target;
 const sessionId=randomUUID();
 const snapshot=snapshotChat((unfinished&&!i.preview)||target.id!==current.id?webinarSchema.parse(webinar):selectRecording(webinarSchema.parse(webinar),timezone,new Date(),settings.routing,i.preview?i.variant??'day':undefined),sessionId);
 const session=await db<WebinarSession>('rpc/icash_webinar_begin','POST',{p_visitor:visitor.id,p_id:sessionId,p_config:snapshot,p_advance_from:!i.preview&&journey.kind==='advance'?journey.sessionId:null,p_preview:!!i.preview});
 const messages=await db<{id:string;role:'user'|'assistant';text:string}[]>(`icash_webinar_messages?session_id=eq.${session.id}&select=id,role,text&order=created_at.asc&limit=60`).catch(()=>[]);
 return Response.json({webinar:publicWebinar(webinarSchema.parse(session.config)),...(session.config.id!==current.id?{canonicalPath:webinarLink(session.config)}:{}),sessionId:session.id,progress:session.completed_at?0:session.progress_seconds,name:visitor.name??'',email:visitor.email??'',phone:visitor.phone??'',contactSaved:!!visitor.email&&!!visitor.phone,messages,preview:!!i.preview,serverNow:Date.now()},{headers:webinarHeaders});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:'The webinar link could not be read.'},{status:400,headers:webinarHeaders});return webinarError(e);}}
