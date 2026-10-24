import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {eventNames,offerDestination} from '@/lib/webinar-policy';
import {availableOffers,selectOffer} from '@/packages/webinar-engine/src/index';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession,WebinarError} from '@/lib/webinar-server';
import {sessionWebinarOffers} from '@/lib/webinar-offer-server';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({sessionId:z.guid(),seconds:z.number().int().min(0).max(14400),kind:z.enum(eventNames),key:z.string().max(100).default('once')}).strict().parse(await webinarBody(req,1000));
 const {v,s}=await webinarSession(i.sessionId);await webinarLimit(req,v.id,'event',80,60);
 const offers=i.key.startsWith('offer:')||i.kind==='add_to_cart'||i.kind==='completed'?await sessionWebinarOffers(s,i.seconds):[];
 if(i.key.startsWith('offer:')&&(!['pitch_shown','add_to_cart','checkout_opened'].includes(i.kind)||!availableOffers(offers,i.seconds).some(o=>o.id===i.key.slice(6))))throw new WebinarError(400,'This offer is not available at this point in the session.');
 if(i.kind==='add_to_cart'&&!availableOffers(offers,i.seconds).length)throw new WebinarError(400,'An offer must be available before selecting it.');
 await db('rpc/icash_webinar_record','POST',{p_visitor:v.id,p_session:i.sessionId,p_seconds:i.seconds,p_kind:i.kind,p_key:i.key});
 const ended=i.kind==='completed'&&!s.is_preview&&i.seconds>=s.config.durationSeconds-5;
 const offer=ended&&s.config.redirectAtEnd?selectOffer(offers,s.config.durationSeconds,Date.now(),s.config.endOfferId):null;
 const redirect=ended&&s.config.parentWebinarId?'/webinar/upgrade':offer?offer.action==='checkout'?`${offerDestination(offer)}?webinar_session=${s.id}`:offerDestination(offer):null;
 return Response.json({saved:true,...(redirect?{redirect}:{})},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
