'use client';
import {ArrowRight,Play,CheckCircle2} from 'lucide-react';
import {formatWatchTime,webinarOffers,webinarSchema,webinarEndOffer,playableWebinarRecordings,type Webinar} from '@/lib/webinar-policy';
import type {RecordingVersion} from '@/lib/webinar-recordings';
import type {WebinarPerformance} from '@/lib/webinar-optimizer';
import {WebinarDailyDashboard} from '@/components/webinar-daily-dashboard';
export const closeRate=(row?:WebinarPerformance)=>row?.viewers?`${((row.buyers??0)/row.viewers*100).toFixed(1)}%`:'—';
export function WebinarDashboard({webinars,onCreate,onEdit,onSettings}:{webinars:Webinar[];onCreate:()=>void;onEdit:(webinar:Webinar)=>void;onSettings:()=>void}){return <WebinarDailyDashboard webinars={webinars} onCreate={onCreate} onEdit={onEdit} onSettings={onSettings}/>;}
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
