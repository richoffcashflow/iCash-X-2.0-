import {db} from './stripe-test.ts';
import {webinarOffers,type Webinar} from './webinar-policy.ts';
import {timerResponseSchema} from './webinar-timers.ts';
import {withOfferDeadlines} from '../packages/webinar-engine/src/offer-deadlines.ts';

/** Used by return links, offer events and the ending redirect, as well as the room. */
export async function sessionWebinarOffers(session:{id:string;visitor_id:string;config:Webinar},seconds:number){
 const offers=webinarOffers(session.config);
 if(!offers.some(o=>o.durationSeconds))return offers;
 const timers=timerResponseSchema.parse(await db('rpc/icash_webinar_timers','POST',{p_visitor:session.visitor_id,p_session:session.id,p_seconds:Math.floor(seconds)}));
 return withOfferDeadlines(offers,timers.offerDeadlines);
}
