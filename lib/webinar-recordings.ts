import {webinarRecordingSchema,webinarPitchAt,type Webinar,type WebinarRecording} from './webinar-policy.ts';
import {isNight,type RoutingSettings,type ViewerLocation} from '../packages/webinar-engine/src/index.ts';
export type RecordingVersion='day'|'night';
export function createNightRecording(webinar:Webinar):WebinarRecording{return {...webinarRecordingSchema.parse(webinar),videoUrl:'',posterUrl:'',transcript:''};}
export function editingRecording(webinar:Webinar,version:RecordingVersion):Webinar{return version==='night'&&webinar.nightVersion?{...webinar,...webinar.nightVersion,purchaseNotifications:webinar.nightVersion.purchaseNotifications??webinar.purchaseNotifications,recordingVersion:'night'}:{...webinar,recordingVersion:'day'};}
// Keep identity, URL and audience settings shared; each recording has its own timeline.
export function patchRecording(webinar:Webinar,version:RecordingVersion,patch:Partial<Webinar>):Webinar{
 if(version==='day')return {...webinar,...patch,...(patch.purchaseNotifications&&webinar.nightVersion&&!webinar.nightVersion.purchaseNotifications?{nightVersion:{...webinar.nightVersion,purchaseNotifications:webinar.purchaseNotifications}}:{}),recordingVersion:'day'};
 const fields=new Set(Object.keys(webinarRecordingSchema.shape));
 const shared=Object.fromEntries(Object.entries(patch).filter(([key])=>!fields.has(key)));
 const recording=Object.fromEntries(Object.entries(patch).filter(([key])=>fields.has(key)));
 return {...webinar,...shared,nightVersion:{...(webinar.nightVersion??createNightRecording(webinar)),...recording},recordingVersion:'day'};
}
export function selectRecording(webinar:Webinar,timezone:string,now=new Date(),routing={nightStartsAt:18,nightEndsAt:6},preview?:RecordingVersion,location?:ViewerLocation|null):Webinar{
 const night=!!webinar.nightVersion?.videoUrl&&(!webinar.videoUrl||(preview?preview==='night':webinar.nightEnabled&&isNight(timezone,now,routing,location)));
 const selected=editingRecording(webinar,night?'night':'day');
 return {...selected,pitchAt:webinarPitchAt(selected),nightVersion:null,nightEnabled:false,recordingVersion:night?'night':'day'};
}
/** Recheck a backgrounded page at the next local Day/Night change. Only the
 * timestamp leaves the server; approximate coordinates are never persisted.
 * Continuous playback stays on its existing recording until the viewer returns.
 */
export function recordingRecheckAt(webinar:Webinar,version:RecordingVersion,timezone:string,now=new Date(),routing:RoutingSettings={nightStartsAt:18,nightEndsAt:6},location?:ViewerLocation|null):number|null{
 if(!webinar.videoUrl||!webinar.nightEnabled||!webinar.nightVersion?.videoUrl||!Number.isFinite(now.getTime()))return null;
 const start=now.getTime(),night=version==='night';
 const changed=(at:number)=>isNight(timezone,new Date(at),routing,location)!==night;
 if(changed(start))return start;
 const until=start+24*60*60*1000,step=15*60*1000;
 let before=start;
 for(let after=start+step;after<=until;after+=step){
  if(changed(after)){
   let end=after;
   while(end-before>1000){const middle=Math.floor((before+end)/2);if(changed(middle))end=middle;else before=middle;}
   return end;
  }
  before=after;
 }
 // Recheck long-open pages daily even during polar day/night.
 return until;
}
