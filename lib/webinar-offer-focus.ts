import type {WebinarTimer,TimerDeadlines} from './webinar-timers';

export function webinarOfferFocus({offer,timers,deadlines,seconds,now,duration,paid,ended}:{
 offer?:{id:string;at:number;expiresAt?:string|null}|null;timers:WebinarTimer[];deadlines:TimerDeadlines;
 seconds:number;now:number;duration:number;paid:boolean;ended:boolean;
}){
 if(!offer||paid||ended)return {locked:false,countdown:null};
 const timer=timers.filter(t=>t.placement==='offer'&&t.at>=offer.at&&t.at<=seconds).sort((a,b)=>b.at-a.at)[0];
 const timerEnd=timer?Date.parse((timer.mode==='deadline'?timer.endsAt:deadlines[timer.id])??''):NaN;
 const offerEnd=Date.parse(offer.expiresAt??'');
 const deadline=Math.min(Number.isFinite(timerEnd)?timerEnd:Infinity,Number.isFinite(offerEnd)?offerEnd:Infinity);
 // A saved countdown receipt may still be loading. Never invent a fresh deadline.
 if(timer&&!Number.isFinite(deadline))return {locked:true,countdown:null};
 const remaining=Number.isFinite(deadline)?Math.max(0,Math.ceil((deadline-now)/1000)):Math.max(0,Math.ceil(duration-seconds));
 return {locked:remaining>0,countdown:remaining>0?{label:Number.isFinite(deadline)?timer?.label??'Offer closes in':'Session ends in',remaining}:null};
}
