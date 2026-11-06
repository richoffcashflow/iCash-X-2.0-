'use client';
import {useEffect,useState} from 'react';
import {courseProgressSchema,type CourseProgress} from './course-progress';
import {walkthroughState,type WalkthroughState} from './workspace-walkthrough';
import {webinarRequest} from './webinar-client';

export type WorkspaceGuide={
 principal:string;
 tour:WalkthroughState;
 course:CourseProgress|null;
 courseOpened:boolean|null;
 courseUpdated:boolean;
};

export function useWorkspaceWalkthrough(principal:string|null){
 const [guide,setGuide]=useState<WorkspaceGuide|null>(null);
 useEffect(()=>{
  if(!principal){setGuide(null);return;}
  const controller=new AbortController();
  let latest=0;
  const refresh=async()=>{
   const request=++latest;
   try{
    const data=await webinarRequest<{tour:unknown;course:unknown;courseOpened:boolean|null;courseUpdated?:boolean}>(
     '/api/account/walkthrough',{cache:'no-store',signal:controller.signal},10000);
    if(controller.signal.aborted||request!==latest)return;
    const tour=walkthroughState.parse(data.tour);
    const progress=courseProgressSchema.safeParse(data.course);
    const course=progress.success?progress.data:null;
    setGuide({
     principal,tour,course,
     courseOpened:course?.state==='in_progress'||course?.state==='completed'?true:data.courseOpened??null,
     courseUpdated:data.courseUpdated===true&&(course?.state==='unrecorded'||course?.state==='in_progress'),
    });
   }catch{/* Keep the last confirmed state for this member and leave course navigation available. */}
  };
  const restore=(event:PageTransitionEvent)=>{if(event.persisted)refresh();};
  refresh();
  window.addEventListener('focus',refresh);
  window.addEventListener('pageshow',restore);
  return()=>{controller.abort();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',restore);};
 },[principal]);
 return guide?.principal===principal?guide:null;
}
