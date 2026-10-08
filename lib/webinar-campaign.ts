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
 if(destination==='smart'&&latest&&!latest.completed_at&&source)return {path:webinarLink(source),phase:'resume' as const,title:source.title,sessionId:latest.id};
 const seen=new Set(history.filter(s=>confirmedWatch(s,now)).map(s=>s.webinar_id));
 const options=available.filter(w=>w.id!==(latest?.webinar_id??sourceId)&&!seen.has(w.id));
 const next=bestConvertingWebinar(options,stats)??options.sort(stableWebinarOrder)[0];
 if(next)return {path:webinarLink(next),phase:'next' as const,title:next.title,sessionId:undefined};
 if(source&&!seen.has(source.id))return {path:webinarLink(source),phase:'resume' as const,title:source.title,sessionId:latest?.id};
 return checkout;
}
const clean=(value:string,length:number)=>value.replace(/[\r\n\t]+/g,' ').trim().slice(0,length);
export function campaignCopy({name,brand,host,phase,title,step}:{name:string;brand:string;host:string;phase:'resume'|'next'|'checkout';title:string;step:number}){
 const first=clean(name,80).split(/\s+/)[0]||'there';
 const variants=phase==='checkout'?[
  ['Put your bot to work','Take the next step: review your access, name your bot and get into your workspace.'],
  ['Ready to start with '+brand+'?','Property research, seller outreach and follow-up take work. Bring those steps into one AI workspace and see the current plan below.'],
  ['Your next move is here','Ready to use the tools? Open checkout to review the current price and terms. Once payment is confirmed, you can choose your next step and set up your bot.'],
  ['Make your wholesale workflow simpler','You do not need to watch another presentation to get access. Review the software plan and decide whether you are ready to start.'],
 ]:phase==='next'?[
  ['A different look at '+brand,'Take another look at how the workflow fits together. This session gives you another way to explore the software before you decide.'],
  ['See the workflow in action','Come see the session, ask your questions in chat and decide whether this is the workspace for you.'],
  ['Your next session is ready','Want to see more before you get started? Open the session below and take a closer look at the tools.'],
 ]:[
  ['Pick up where you left off','Your session is saved. Come back, see the rest of the walkthrough and get your questions answered in chat.'],
  ['See what comes next','Still exploring '+brand+'? Your link takes you to the next useful step based on what you have already watched.'],
  ['Ready to finish the walkthrough?','Give yourself a closer look at the workflow. Open your session and decide whether the software fits the way you want to work.'],
 ];
 const index=Math.abs(step>=1000?step-1000:step-100)%variants.length;
 const [subject,message]=variants[index];
 const cta=phase==='checkout'?`Get ${brand} access`:phase==='next'?'Watch the next session':'Continue my session';
 return {subject:clean(subject,150),body:`Hey ${first},\n\n${message}${phase==='next'&&title?`\n\nSession: ${clean(title,160)}`:''}\n\n${cta}:`,signature:`— ${host}`,sms:`Hey ${first}, ${brand} here. ${phase==='checkout'?'Ready to put your bot to work? Review your access and get started:':phase==='next'?'I have another session for you. Take a look:':'Your session is saved. Come see the rest:'}`};
}
