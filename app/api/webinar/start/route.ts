import {z} from 'zod';
import {cookies} from 'next/headers';
import {randomBytes,randomUUID,randomInt} from 'node:crypto';
import {guestHash} from '@/lib/stripe-test';
import {validGuest} from '@/lib/funding';
import {webinarCustomerAccount,webinarCustomerPaid} from '@/lib/webinar-account-adapter';
import {webinarSite} from '@/lib/webinar-site';
import {db} from '@/lib/stripe-test';
import {publicWebinar,settingsSchema,webinarSchema,visitorTimezone,webinarOffers,webinarPitchAt,offerDestination,type WebinarSettings,type Webinar} from '@/lib/webinar-policy';
import {selectOffer} from '@/packages/webinar-engine/src/index';
import {snapshotChat} from '@/lib/webinar-variants';
import {optimizedWebinar,returnVisit,type WebinarPerformance} from '@/lib/webinar-optimizer';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarOwner,webinarVisitor,type WebinarSession} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({timezone:z.string().max(80),resume:z.string().max(600).optional(),preview:z.string().uuid().optional(),attribution:z.record(z.string().max(250)).optional()}).strict().parse(await webinarBody(req,3000));
 await webinarLimit(req,'entry','entry',120,60);
 if(!i.preview){const account=await webinarCustomerAccount();if(account){
 try{const v=await webinarVisitor();await db(`icash_webinar_visitors?id=eq.${v.id}`,'PATCH',{account_id:account.id});}catch{/* A signed-in customer can enter without a webinar cookie. */}
 return Response.json({redirect:account.destination,needsBudget:account.needsBudget},{headers:webinarHeaders});}}
 if(i.preview)await webinarOwner();
 const visitor=await webinarVisitor(true,i.resume);const timezone=visitorTimezone(process.env.VERCEL?req.headers.get('x-vercel-ip-timezone'):null,i.timezone);
 const attribution=Object.fromEntries(Object.entries(i.attribution??{}).filter(([k])=>['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].includes(k)));
 const jar=await cookies();let fundingGuest=jar.get('icash_funding_guest')?.value;if(!validGuest(fundingGuest)){fundingGuest=randomBytes(32).toString('hex');jar.set('icash_funding_guest',fundingGuest,{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge:86400*30});}
 await db(`icash_webinar_visitors?id=eq.${visitor.id}`,'PATCH',{timezone,funding_guest_hash:guestHash(fundingGuest),last_seen_at:new Date().toISOString(),...(Object.keys(attribution).length?{attribution}:{})});
 if(!i.preview&&await webinarCustomerPaid(guestHash(fundingGuest)))return Response.json({redirect:webinarSite.workspacePath},{headers:webinarHeaders});
 const [rows,history,settingsRows,performance,offers]=await Promise.all([db<{config:Webinar}[]>('icash_webinars?select=config&order=updated_at.desc&limit=100'),db<WebinarSession[]>(`icash_webinar_sessions?visitor_id=eq.${visitor.id}&is_preview=eq.${!!i.preview}&select=*&order=created_at.desc&limit=100`),db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config'),db<WebinarPerformance[]>('rpc/icash_webinar_performance','POST',{}),db<{session_id:string;created_at:string;kind:string;event_key:string}[]>(`icash_webinar_events?visitor_id=eq.${visitor.id}&kind=in.(pitch_shown,checkout_opened)&select=session_id,created_at,kind,event_key&order=created_at.desc&limit=1000`)]);
 const settings=settingsSchema.parse(settingsRows[0].config);
 let journey=returnVisit(history.filter(h=>rows.some(w=>w.config.id===h.webinar_id&&w.config.status==='published')).map(h=>({...h,config:{...h.config,pitchAt:webinarPitchAt(h.config)},offer_seen_at:offers.find(o=>o.session_id===h.id&&o.kind==='pitch_shown'&&o.event_key==='once')?.created_at??null})),timezone,settings.routing.checkoutWindowHours);
 if(!i.preview&&journey.kind==='checkout'){
  const priorSessionId=journey.sessionId;
  const previous=history.find(h=>h.id===priorSessionId)!;
  const lastOpened=offers.find(o=>o.session_id===previous.id&&o.kind==='checkout_opened'&&o.event_key.startsWith('offer:'))?.event_key.slice(6);
  const offer=selectOffer(webinarOffers(previous.config),previous.max_seconds,Date.now(),lastOpened);
  if(offer)return Response.json({redirect:offerDestination(offer)},{headers:webinarHeaders});
  journey={kind:'advance',sessionId:previous.id};
 }
 const resumeId=journey.kind==='resume'?journey.sessionId:null;
 const unfinished=history.find(h=>h.id===resumeId);
 const webinar=i.preview?rows.find(r=>r.config.id===i.preview)?.config:unfinished?.config??optimizedWebinar(rows.map(r=>r.config),history,timezone,performance,settings.optimizer,randomInt(1_000_000)/1_000_000,new Date(),settings.routing);
 if(!webinar)return Response.json({unavailable:true,message:'The next session is being prepared. You can open iCash X below.'},{headers:webinarHeaders});
 const sessionId=randomUUID();
 const session=await db<WebinarSession>('rpc/icash_webinar_begin','POST',{p_visitor:visitor.id,p_id:sessionId,p_config:snapshotChat(webinarSchema.parse(webinar),sessionId),p_preview:!!i.preview,p_advance_from:!i.preview&&journey.kind==='advance'?journey.sessionId:null});
 const messages=await db<{id:string;role:'user'|'assistant';text:string}[]>(`icash_webinar_messages?session_id=eq.${session.id}&select=id,role,text&order=created_at.asc&limit=60`);
 return Response.json({webinar:publicWebinar(webinarSchema.parse(session.config)),sessionId:session.id,progress:session.completed_at?0:session.progress_seconds,name:visitor.name??'',contactSaved:!!visitor.email||!!visitor.phone,messages,preview:!!i.preview,serverNow:Date.now()},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
