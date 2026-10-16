'use client';
import {useId,useState} from 'react';
import {JourneyRecovery} from './journey-recovery';
import type {JourneyBlocker} from '@/lib/deal-completion';
export type TitleTask={recovery?:{journeyId:string;blocker:JourneyBlocker};email_state?:string;id:string;kind:string;label:string;due_date:string|null;state:string;evidence:string|null};
export const titleTaskLabel=(task:TitleTask)=>task.email_state==='needs_review'?'Title delivery needs review: '+task.label:task.label;
function displayDate(value:string){
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())?date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):value;
}
export function TitleTasks({initialTasks,onChanged,expanded=false,embedded=false}:{initialTasks:TitleTask[];onChanged?:()=>void;expanded?:boolean;embedded?:boolean}){
 const instanceId=useId();
 const [tasks,setTasks]=useState(initialTasks),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 async function update(task:TitleTask,action:string,dueDate?:string){
  if(busy)return;
  setBusy(task.id);setError('');
  try{
   const r=await fetch('/api/work/title-tasks',{method:'POST',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:task.id,action,dueDate})});
   const body=await r.json();if(!r.ok)throw Error(body.error||'Could not save. Please try again.');
   setTasks(items=>action==='confirm'?items.map(t=>t.id===task.id?{...t,state:'scheduled',due_date:dueDate!}:t):items.filter(t=>t.id!==task.id));
   onChanged?.();
  }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(null);}
 }
 if(!tasks.length)return null;
 const content=<>
  {error&&<p role="alert">{error}</p>}
  {tasks.map(task=>task.recovery?<JourneyRecovery key={task.id+':'+task.recovery.blocker.revision} journeyId={task.recovery.journeyId} blocker={task.recovery.blocker} onSaved={()=>{setTasks(items=>items.filter(t=>t.id!==task.id));onChanged?.();}}/>:<article className="title-task" key={task.id}>
   {(!embedded||tasks.length>1)&&<strong>{titleTaskLabel(task)}</strong>}
   {task.due_date&&<p className="review-meta">{task.state==='needs_review'?'Suggested date':'Due'}: {displayDate(task.due_date)}</p>}
   {task.evidence&&<details className="review-evidence"><summary>See details</summary><p>{task.evidence}</p></details>}
   {task.kind==='document_update'?<>
    <p>{task.email_state==='needs_review'?'Check delivery with your closer before sending anything again.':'Queued for the verified closer while automation and delivery checks allow it.'}</p>
    <div className="review-actions"><button className="review-secondary" type="button" disabled={busy!==null} onClick={()=>void update(task,'dismissed')}>Dismiss</button></div>
   </>:task.kind==='deadline'&&task.state==='needs_review'?<form className="review-form" onSubmit={e=>{e.preventDefault();const date=new FormData(e.currentTarget).get('dueDate');if(typeof date==='string'&&date)void update(task,'confirm',date);}}>
    <label htmlFor={`${instanceId}-date-${task.id}`}>Confirm the date</label>
    <input id={`${instanceId}-date-${task.id}`} aria-describedby={`${instanceId}-help-${task.id}`} name="dueDate" type="date" required disabled={busy!==null} defaultValue={task.due_date??''}/>
    <small id={`${instanceId}-help-${task.id}`}>Use the date in the signed agreement or confirmed by your closer.</small>
    <div className="review-actions">
     <button className="review-primary" type="submit" disabled={busy!==null}>{busy===task.id?'Saving…':'Save reminder'}</button>
     <button className="review-secondary" type="button" disabled={busy!==null} onClick={()=>void update(task,'dismissed')}>Dismiss</button>
    </div>
   </form>:<div className="review-actions">
    <button className="review-primary" type="button" disabled={busy!==null} onClick={()=>void update(task,'done')}>{task.kind==='reply_review'?'Mark reviewed':'Mark done'}</button>
    <button className="review-secondary" type="button" disabled={busy!==null} onClick={()=>void update(task,'dismissed')}>Dismiss</button>
   </div>}
  </article>)}
 </>;
 return embedded?<div className="title-tasks">{content}</div>:<details className="title-tasks" open={expanded||undefined}><summary>Closing tasks ({tasks.length})</summary>{content}<p className="review-meta">Title messages send while the bot is running and delivery checks pass. Reminders use dates you confirm.</p></details>;
}
