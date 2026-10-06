import {webinarRecordingSchema,webinarPitchAt,type Webinar,type WebinarRecording} from './webinar-policy.ts';
import {isNight} from '../packages/webinar-engine/src/index.ts';
export type RecordingVersion='day'|'night';
export function createNightRecording(webinar:Webinar):WebinarRecording{return {...webinarRecordingSchema.parse(webinar),videoUrl:'',posterUrl:''};}
export function editingRecording(webinar:Webinar,version:RecordingVersion):Webinar{return version==='night'&&webinar.nightVersion?{...webinar,...webinar.nightVersion,recordingVersion:'night'}:{...webinar,recordingVersion:'day'};}
// Keep identity, URL and audience settings shared; each recording has its own timeline.
export function patchRecording(webinar:Webinar,version:RecordingVersion,patch:Partial<Webinar>):Webinar{
 if(version==='day')return {...webinar,...patch,recordingVersion:'day'};
 const fields=new Set(Object.keys(webinarRecordingSchema.shape));
 const shared=Object.fromEntries(Object.entries(patch).filter(([key])=>!fields.has(key)));
 const recording=Object.fromEntries(Object.entries(patch).filter(([key])=>fields.has(key)));
 return {...webinar,...shared,nightVersion:{...(webinar.nightVersion??createNightRecording(webinar)),...recording},recordingVersion:'day'};
}
export function selectRecording(webinar:Webinar,timezone:string,now=new Date(),routing={nightStartsAt:18,nightEndsAt:6},preview?:RecordingVersion):Webinar{
 const night=!!webinar.nightVersion?.videoUrl&&(preview?preview==='night':webinar.nightEnabled&&isNight(timezone,now,routing));
 const selected=editingRecording(webinar,night?'night':'day');
 return {...selected,pitchAt:webinarPitchAt(selected),nightVersion:null,nightEnabled:false,recordingVersion:night?'night':'day'};
}
