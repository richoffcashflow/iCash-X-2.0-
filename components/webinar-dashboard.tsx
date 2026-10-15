'use client';
import {ArrowRight,Play,CheckCircle2} from 'lucide-react';
import {formatWatchTime,webinarOffers,webinarSchema,webinarEndOffer,playableWebinarRecordings,type Webinar} from '@/lib/webinar-policy';
import type {RecordingVersion} from '@/lib/webinar-recordings';
import type {WebinarPerformance} from '@/lib/webinar-optimizer';
import {WebinarDailyDashboard} from '@/components/webinar-daily-dashboard';
import {webinarPreviewLink} from '@/lib/webinar-links';
export const closeRate=(row?:WebinarPerformance)=>row?.viewers?`${((row.buyers??0)/row.viewers*100).toFixed(1)}%`:'—';
export function WebinarPreviews({webinars}:{webinars:Webinar[]}){
 const mains=webinars.filter(w=>!w.parentWebinarId);
 if(!mains.length)return null;
 const vipByParent=new Map(webinars.filter(w=>w.parentWebinarId).map(w=>[w.parentWebinarId,w]));
 return <section className="ws-card ws-webinar-previews" aria-labelledby="ws-preview-heading">
  <div className="ws-card-heading"><div><span className="wb-eyebrow">OWNER PREVIEWS</span><h2 id="ws-preview-heading">Preview each webinar</h2><p>Open a saved recording with its chat and offers. Drafts can be previewed too.</p></div><Play size={20} aria-hidden="true"/></div>
  <div className="ws-preview-groups">{mains.map(main=>{
   const vip=vipByParent.get(main.id);
   const slots:{label:string;webinar:Webinar|undefined;version:RecordingVersion}[]=[
    {label:'Daytime',webinar:main,version:'day'},
    {label:'Daytime VIP',webinar:vip,version:'day'},
    {label:'Nighttime',webinar:main,version:'night'},
    {label:'Nighttime VIP',webinar:vip,version:'night'},
   ];
   return <article key={main.id} className="ws-preview-group" aria-labelledby={`ws-preview-${main.id}`}>
    <h3 id={`ws-preview-${main.id}`}>{main.title}</h3>
    <div className="ws-preview-slots">{slots.map(({label,webinar,version})=>{
     const videoUrl=version==='night'?webinar?.nightVersion?.videoUrl:webinar?.videoUrl;
     return webinar&&videoUrl?<a key={label} className="ws-preview-slot" href={webinarPreviewLink(webinar,version)} target="_blank" rel="noopener noreferrer" aria-label={`Preview ${main.title} — ${label} (opens in a new tab)`}><Play size={17} aria-hidden="true"/><span><b>{label}</b><small>Preview</small></span></a>:<div key={label} className="ws-preview-slot ws-preview-slot-empty"><span><b>{label}</b><small>No video saved</small></span></div>;
    })}</div>
   </article>;
  })}</div>
 </section>;
}
export function WebinarDashboard({webinars,onCreate,onEdit,onSettings}:{webinars:Webinar[];onCreate:()=>void;onEdit:(webinar:Webinar,version:'day'|'night')=>void;onSettings:()=>void}){return <><WebinarPreviews webinars={webinars}/><WebinarDailyDashboard webinars={webinars.filter(w=>!w.parentWebinarId)} onCreate={onCreate} onEdit={onEdit} onSettings={onSettings}/></>;}
export function WebinarResults({webinars}:{webinars:Webinar[]}){return <WebinarDailyDashboard webinars={webinars} expanded/>;}
export function WebinarReview({webinar,version='day',isNew,busy,onPublish}:{webinar:Webinar;version?:RecordingVersion;isNew:boolean;busy:boolean;onPublish:()=>void}){
 const checked=webinarSchema.safeParse({...webinar,status:'published'}),recordings=playableWebinarRecordings(webinar);
 const unavailable=recordings.find(({recording})=>!webinarEndOffer(recording)),ready=checked.success&&recordings.length>0&&!unavailable;
 const label=(version:RecordingVersion)=>version==='night'?'Nighttime':'Daytime';
 const previewVersion=recordings.find(r=>r.version===version)?.version??recordings[0]?.version??version;
 const items=recordings.length?recordings.flatMap(({version,recording})=>{
  const offers=webinarOffers(recording).length,messages=recording.chat.filter(c=>c.kind==='replay'||c.kind==='purchase').length;
  return [
  {label:`${label(version)} video`,value:`${formatWatchTime(recording.durationSeconds)} · video added`,ok:true},
  {label:`${label(version)} offers`,value:`${offers} timed ${offers===1?'offer':'offers'}`,ok:!!webinarEndOffer(recording)},
  {label:`${label(version)} chat`,value:`${messages} timed ${messages===1?'message':'messages'}`,ok:true},
 ];}):[{label:'Video',value:'Upload a Daytime or Nighttime presentation',ok:false}];
 const coverage=recordings.length===2?'Daytime + Nighttime · automatic switching':recordings.length?`${label(recordings[0].version)} · runs around the clock`:'One video is enough to start';
 return <div className="ws-review"><section className="ws-card"><span className="wb-eyebrow">READY WHEN YOU ARE</span><h2>One final look, then you’re live.</h2><p>New visitors will see this version. Existing viewers keep their saved session.</p><div className="ws-review-items">{[...items,{label:'Playback',value:coverage,ok:recordings.length>0}].map(item=><div key={item.label}><CheckCircle2 size={19} className={item.ok?'ws-check-ok':'ws-check-pending'}/><div><b>{item.label}</b><span>{item.value}</span></div></div>)}</div>{!checked.success&&<p className="ws-alert">{checked.error.issues[0].message}</p>}{unavailable&&<p className="ws-alert">The {label(unavailable.version)} recording needs an available offer before publishing.</p>}<div className="ws-review-actions">{!isNew&&<a className="ws-secondary" href={`/webinar?preview=${webinar.id}&variant=${previewVersion}`} target="_blank" rel="noopener noreferrer"><Play size={16}/>Preview saved webinar</a>}<button className="wb-primary" disabled={busy||!ready} onClick={onPublish}>{busy?'Publishing…':webinar.status==='published'?'Publish changes':'Publish webinar'}<ArrowRight size={16}/></button></div></section></div>;
}
