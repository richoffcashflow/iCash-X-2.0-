'use client';
import {useEffect,useState,type RefObject} from 'react';
import {coursePlaybackSnapshot,courseProgressSchema,type CourseProgress} from './course-progress';

export function useCourseProgress(ref:RefObject<HTMLVideoElement|null>,revision:number|undefined,attempt:number){
 const [progress,setProgress]=useState<CourseProgress|null>(null);
 useEffect(()=>{
  setProgress(null);const video=ref.current;
  if(!video||revision===undefined)return;
  let lastAttempt=0,lastSnapshot='',disposed=false;
  async function flush(force=false){
   if(!video)return;
   const snapshot=coursePlaybackSnapshot(video,revision!);if(!snapshot)return;
   const body=JSON.stringify(snapshot),now=Date.now();
   if(body===lastSnapshot||!force&&now-lastAttempt<30000)return;
   lastAttempt=now;lastSnapshot=body;
   try{
    const response=await fetch('/api/course/progress',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true,signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Progress unavailable');
    const saved=courseProgressSchema.parse(await response.json());
    if(!disposed&&saved.revision===revision)setProgress(saved);
   }catch{if(lastSnapshot===body)lastSnapshot='';} // Playback remains usable; the next update retries the ranges.
  }
  const tick=()=>void flush(),finish=()=>void flush(true),hidden=()=>{if(document.visibilityState==='hidden')finish();};
  video.addEventListener('timeupdate',tick);video.addEventListener('pause',finish);video.addEventListener('ended',finish);
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',finish);
  return ()=>{finish();disposed=true;video.removeEventListener('timeupdate',tick);video.removeEventListener('pause',finish);video.removeEventListener('ended',finish);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',finish);};
 },[ref,revision,attempt]);
 return progress?.revision===revision?progress:null;
}
