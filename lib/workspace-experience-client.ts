import {workspaceExperienceEvents,workspaceExperienceStages,type WorkspaceExperienceInput} from './workspace-experience-events.ts';
export type {WorkspaceExperienceStage} from './workspace-experience-events.ts';

const observed=new Map<string,number>();
let windowStarted=0,attempts=0;
/** Best effort only: reporting never blocks a control or repeats a customer action. */
export function recordWorkspaceExperience(input:WorkspaceExperienceInput):void{
 if(typeof window==='undefined'||window.location.pathname.startsWith('/preview/'))return;
 if(!workspaceExperienceEvents.includes(input.event)||!workspaceExperienceStages.includes(input.stage))return;
 const now=Date.now(),key=`${input.event}:${input.stage}`;
 if(now-(observed.get(key)??0)<30000)return;
 if(now-windowStarted>=60000){windowStarted=now;attempts=0;}
 if(attempts>=20)return;
 attempts++;observed.set(key,now);
 const body=JSON.stringify({event:input.event,stage:input.stage});
 try{void fetch('/api/work/experience',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body,keepalive:true,signal:AbortSignal.timeout(4000)}).catch(()=>{});}catch{/* Reporting must not break the workspace. */}
}
