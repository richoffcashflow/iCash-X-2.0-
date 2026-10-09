import {confirmedWatch,bestConvertingWebinar,stableWebinarOrder,type ConversionRecording} from '../packages/webinar-engine/src/index.ts';
import {selectRecording} from './webinar-recordings.ts';
import {webinarOffers,type Webinar,type WebinarSettings} from './webinar-policy.ts';
import {webinarLink} from './webinar-links.ts';
import type {WebinarSession} from './webinar-server';
export type CampaignDestination='smart'|'webinar'|'checkout';
/** Follow-up routing is independent of ad entry URLs and never reallocates Meta traffic. */
export function campaignTarget(destination:CampaignDestination,sourceId:string,history:WebinarSession[],webinars:Webinar[],stats:ConversionRecording[],timezone:string,routing:WebinarSettings['routing'],now=new Date()){
 const latest=history.filter(s=>!s.is_preview&&!s.config.parentWebinarId).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
 const checkout={path:'/webinar/checkout',phase:'checkout' as const,sessionId:latest?.id,title:latest?.config.title??''};
 if(destination==='checkout')return checkout;
 const completion=Date.parse(latest?.completed_at??'');
 if(destination==='smart'&&Number.isFinite(completion)&&completion<=now.getTime()&&now.getTime()-completion<routing.checkoutWindowHours*3600000)return checkout;
 const available=webinars.filter(w=>!w.parentWebinarId&&w.status==='published'&&w.videoUrl).map(w=>selectRecording(w,timezone,now,routing)).filter(w=>webinarOffers(w).some(o=>!o.expiresAt||Date.parse(o.expiresAt)>now.getTime()));
 const source=available.find(w=>w.id===(latest?.webinar_id??sourceId));
 if(latest&&!latest.completed_at&&source)return {path:webinarLink(source),phase:'resume' as const,title:source.title,sessionId:latest.id};
 const seen=new Set(history.filter(s=>confirmedWatch(s,now)).map(s=>s.webinar_id));
 const options=available.filter(w=>w.id!==(latest?.webinar_id??sourceId)&&!seen.has(w.id));
 const next=bestConvertingWebinar(options,stats)??options.sort(stableWebinarOrder)[0];
 if(next)return {path:webinarLink(next),phase:'next' as const,title:next.title,sessionId:undefined};
 if(source&&(destination==='webinar'||!seen.has(source.id)))return {path:webinarLink(source),phase:'resume' as const,title:source.title,sessionId:latest?.id};
 return checkout;
}
export {campaignCopy} from './webinar-message-copy.ts';
