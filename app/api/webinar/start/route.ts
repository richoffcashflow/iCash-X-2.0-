import {z} from 'zod';
import {cookies} from 'next/headers';
import {randomBytes,randomUUID} from 'node:crypto';
import {guestHash} from '@/lib/stripe-test';
import {validGuest} from '@/lib/funding';
import {webinarCustomerAccount,webinarCustomerPaid} from '@/lib/webinar-account-adapter';
import {webinarSite} from '@/lib/webinar-site';
import {db} from '@/lib/stripe-test';
import {publicWebinar,settingsSchema,webinarSchema,visitorTimezone,chooseWebinar,webinarOffers,webinarPitchAt,offerDestination,type WebinarSettings,type Webinar} from '@/lib/webinar-policy';
import {selectOffer} from '@/packages/webinar-engine/src/index';
import {selectRecording} from '@/lib/webinar-recordings';
import {snapshotChat} from '@/lib/webinar-variants';
import {approximateRegion} from '@/lib/webinar-activity';
import {returnVisit} from '@/lib/webinar-optimizer';
import {adIdentity,intelligencePlan,intelligenceChoice,intelligenceBucket,intelligencePolicyVersion} from '@/packages/webinar-engine/src/intelligence';
import {intelligenceContext,intelligenceCandidates,intelligencePoolKey,readIntelligenceData,saveIntelligenceStops,type IntelligenceAssignment} from '@/lib/webinar-intelligence';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarOwner,webinarVisitor,webinarPaid,type WebinarSession} from '@/lib/webinar-server';
export const dynamic='force-dynamic';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({timezone:z.string().max(80),code:z.string().regex(/^\d{6,12}$/).optional(),variant:z.enum(['day','night']).optional(),resume:z.string().max(600).optional(),preview:z.string().uuid().optional(),attribution:z.record(z.string().max(250)).optional()}).strict().parse(await webinarBody(req,3000));
 await webinarLimit(req,'entry','entry',120,60);
 if(!i.preview){const account=await webinarCustomerAccount();if(account){
 try{const v=await webinarVisitor();await db(`icash_webinar_visitors?id=eq.${v.id}`,'PATCH',{account_id:account.id});}catch{/* A signed-in customer can enter without a webinar cookie. */}
 return Response.json({redirect:account.destination,needsBudget:account.needsBudget},{headers:webinarHeaders});}}
 if(i.preview)await webinarOwner();
 const visitor=await webinarVisitor(true,i.resume);const timezone=visitorTimezone(process.env.VERCEL?req.headers.get('x-vercel-ip-timezone'):null,i.timezone);
 const attribution=Object.fromEntries(Object.entries(i.attribution??{}).filter(([k])=>['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ad_id','adset_id','campaign_id'].includes(k)));
 const jar=await cookies();let fundingGuest=jar.get('icash_funding_guest')?.value;if(!validGuest(fundingGuest)){fundingGuest=randomBytes(32).toString('hex');jar.set('icash_funding_guest',fundingGuest,{httpOnly:true,secure:process.env.NODE_ENV!=='development',sameSite:'lax',path:'/',maxAge:86400*30});}
 const activityRegion=process.env.VERCEL?approximateRegion(req.headers.get('x-vercel-ip-country'),req.headers.get('x-vercel-ip-country-region')):null;
 await db(`icash_webinar_visitors?id=eq.${visitor.id}`,'PATCH',{timezone,activity_region:activityRegion,funding_guest_hash:guestHash(fundingGuest),last_seen_at:new Date().toISOString(),...(Object.keys(attribution).length?{attribution}:{})});
 if(!i.preview&&(await webinarCustomerPaid(guestHash(fundingGuest))||await webinarPaid(visitor)))return Response.json({redirect:webinarSite.workspacePath},{headers:webinarHeaders});
 const rows=await db<{config:Webinar;public_code:number}[]>(`icash_webinars?${i.preview?'id=eq.'+i.preview+'&':i.code?'public_code=eq.'+i.code+'&':''}select=config,public_code&order=updated_at.desc&limit=100`);
 for(const row of rows)row.config={...row.config,publicCode:String(row.public_code)};
 if(i.code&&!i.preview&&!rows.some(row=>row.config.status==='published'))return Response.json({unavailable:true,message:'This webinar is not available yet.'},{headers:webinarHeaders});
 const [history,settingsRows,offers]=await Promise.all([db<WebinarSession[]>(`icash_webinar_sessions?visitor_id=eq.${visitor.id}&${i.code?'webinar_id=eq.'+rows[0].config.id+'&':''}is_preview=eq.${!!i.preview}&select=*&order=created_at.desc&limit=100`),db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config'),db<{session_id:string;created_at:string;kind:string;event_key:string}[]>(`icash_webinar_events?visitor_id=eq.${visitor.id}&kind=in.(pitch_shown,checkout_opened)&select=session_id,created_at,kind,event_key&order=created_at.desc&limit=1000`)]);
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
 let webinar=i.preview?rows.find(r=>r.config.id===i.preview)?.config:unfinished?.config??(i.code?rows[0]?.config:chooseWebinar(rows.map(r=>r.config),history,timezone,new Date(),settings.routing));
 let assignment:IntelligenceAssignment|null=null;
 if(!i.preview&&!i.code&&!unfinished&&settings.optimizer.enabled){
  const now=new Date(),context=intelligenceContext(history,timezone,now,settings.routing);
  const adKey=adIdentity(Object.keys(attribution).length?attribution:visitor.attribution);
  const {recordings,arms}=intelligenceCandidates(rows.map(r=>r.config),history,timezone,now,settings.routing);
  if(arms.length){
   const data=await readIntelligenceData(context,adKey),failed=!data.metricsAvailable;
   const plan=intelligencePlan(arms,data.rows,adKey,settings.optimizer,data.stops);
   const active=arms.filter(a=>!plan.stoppedKeys.includes(a.key));
   // Persist before starting another session; a failed write can be retried safely.
   await saveIntelligenceStops(context,plan.newStops);
   const choice=intelligenceChoice(arms,plan,intelligenceBucket(visitor.id),Math.random(),settings.optimizer);
   if(!choice)return Response.json({redirect:webinarSite.checkoutPath},{headers:webinarHeaders});
   if(choice){
    const selected=failed?(active.find(a=>a.key===plan.winnerKey)??active.find(a=>a.key===plan.baselineKey)??active[0]):choice.arm;
    webinar=recordings.find(w=>w.id===selected.webinarId)!;
    assignment={ad_key:adKey,context_key:context,pool_key:intelligencePoolKey(active),baseline_key:plan.baselineKey!,mode:failed?'fallback':choice.mode,probability:failed?1:choice.probability,policy_version:intelligencePolicyVersion};
   }
  }
 }
 if(!webinar)return Response.json({unavailable:true,message:'The next session is being prepared. You can open iCash X below.'},{headers:webinarHeaders});
 const sessionId=randomUUID();
 const snapshot=snapshotChat((unfinished&&!i.preview)||assignment?webinarSchema.parse(webinar):selectRecording(webinarSchema.parse(webinar),timezone,new Date(),settings.routing,i.preview?i.variant??'day':undefined),sessionId);
 const begin={p_visitor:visitor.id,p_id:sessionId,p_config:snapshot,p_advance_from:!i.preview&&journey.kind==='advance'?journey.sessionId:null};
 const session=assignment?await db<WebinarSession>('rpc/icash_webinar_begin_intelligent','POST',{...begin,p_assignment:assignment}):await db<WebinarSession>('rpc/icash_webinar_begin','POST',{...begin,p_preview:!!i.preview});
 const messages=await db<{id:string;role:'user'|'assistant';text:string}[]>(`icash_webinar_messages?session_id=eq.${session.id}&select=id,role,text&order=created_at.asc&limit=60`).catch(()=>[]);
 return Response.json({webinar:publicWebinar(webinarSchema.parse(session.config)),sessionId:session.id,progress:session.completed_at?0:session.progress_seconds,name:visitor.name??'',email:visitor.email??'',phone:visitor.phone??'',contactSaved:!!visitor.email&&!!visitor.phone,messages,preview:!!i.preview,serverNow:Date.now()},{headers:webinarHeaders});
 }catch(e){if(e instanceof z.ZodError)return Response.json({error:'The webinar link could not be read.'},{status:400,headers:webinarHeaders});return webinarError(e);}}
