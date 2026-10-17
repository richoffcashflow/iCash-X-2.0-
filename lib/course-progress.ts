import {z} from 'zod';
import type {SupportEvidence} from './support-policy.ts';

export const courseProgressInput=z.object({revision:z.number().int().nonnegative(),durationMs:z.number().int().positive().max(28800000),ranges:z.array(z.tuple([z.number().int().nonnegative(),z.number().int().positive()])).min(1).max(128)}).strict().refine(v=>v.ranges.every(([start,end])=>start<end&&end<=v.durationMs));
export const courseProgressSchema=z.object({revision:z.number().int().nonnegative().nullable(),state:z.enum(['unrecorded','in_progress','completed','unavailable']),percent:z.number().int().min(0).max(100).nullable()}).strict().refine(p=>p.state==='unavailable'?p.percent===null:p.revision!==null&&(p.state==='unrecorded'?p.percent===null:p.percent!==null&&(p.state==='completed'?p.percent>=95:p.percent<95)));
export type CourseProgress=z.infer<typeof courseProgressSchema>;

/** Use actual played ranges, never the seek position or an ended event as proof of viewing. */
export function coursePlaybackSnapshot(video:Pick<HTMLVideoElement,'duration'|'played'>,revision:number){
 if(!Number.isFinite(video.duration)||video.duration<=0||video.duration>28800)return null;
 const durationMs=Math.ceil(video.duration*1000),ranges:[number,number][]=[];
 for(let i=0;i<Math.min(video.played.length,128);i++){
  const start=Math.max(0,Math.floor(video.played.start(i)*1000)),end=Math.min(durationMs,Math.floor(video.played.end(i)*1000));
  if(Number.isFinite(start)&&Number.isFinite(end)&&end>start)ranges.push([start,end]);
 }
 return ranges.length?{revision,durationMs,ranges}:null;
}

export function courseProgressEvidence(progress:CourseProgress):Pick<SupportEvidence,'status'|'code'|'detail'>{
 switch(progress.state){
  case 'completed':return {status:'ok',code:'course_completed',detail:`Recorded playback covers ${progress.percent}% of the current course video (at least 95%). Do not tell this customer they have not watched it. Offer to revisit the relevant section when useful; playback is not proof of understanding.`};
  case 'in_progress':return {status:'attention',code:'course_in_progress',detail:`Recorded playback covers ${progress.percent}% of the current course video. Ask the customer to finish the course for setup and how-to guidance. Keep helping with any actual access, billing or software problem.`};
  case 'unrecorded':return {status:'attention',code:'course_unrecorded',detail:'No playback is recorded for the current course video. Recommend watching Course in the workspace. Earlier or offline viewing may not be recorded; do not claim the customer has never watched it or deny support.'};
  default:return {status:'unknown',code:'course_unavailable',detail:'Course viewing progress is unavailable. Do not infer whether this customer has watched the course.'};
 }
}
