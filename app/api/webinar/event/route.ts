import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {eventNames,webinarOffers,webinarEndOffer,offerDestination} from '@/lib/webinar-policy';
import {availableOffers} from '@/packages/webinar-engine/src/index';
import {webinarBody,webinarError,webinarHeaders,webinarLimit,webinarOrigin,webinarSession,WebinarError} from '@/lib/webinar-server';
export async function POST(req:Request){try{
 webinarOrigin(req);const i=z.object({sessionId:z.string().uuid(),seconds:z.number().int().min(0).max(14400),kind:z.enum(eventNames),key:z.string().max(100).default('once')}).strict().parse(await webinarBody(req,1000));
 const {v,s}=await webinarSession(i.sessionId);await webinarLimit(req,v.id,'event',80,60);
 if(i.key.startsWith('offer:')&&(!['pitch_shown','add_to_cart','checkout_opened'].includes(i.kind)||!availableOffers(webinarOffers(s.config),i.seconds).some(o=>o.id===i.key.slice(6))))throw new WebinarError(400,'This offer is not available at this point in the session.');
 if(i.kind==='add_to_cart'&&!availableOffers(webinarOffers(s.config),i.seconds).length)throw new WebinarError(400,'An offer must be available before selecting it.');
 await db('rpc/icash_webinar_record','POST',{p_visitor:v.id,p_session:i.sessionId,p_seconds:i.seconds,p_kind:i.kind,p_key:i.key});
 const offer=i.kind==='completed'&&!s.is_preview&&s.config.redirectAtEnd&&i.seconds>=s.config.durationSeconds-5?webinarEndOffer(s.config,Date.now()):null;
 return Response.json({saved:true,...(offer?{redirect:offer.action==='checkout'?`${offerDestination(offer)}?webinar_session=${s.id}`:offerDestination(offer)}:{})},{headers:webinarHeaders});
 }catch(e){return webinarError(e);}}
