'use client';
import {useState} from 'react';
export type TitleTask={email_state?:string;id:string;kind:string;label:string;due_date:string|null;state:string;evidence:string|null};
export function TitleTasks({initialTasks}:{initialTasks:TitleTask[]}){
 const [tasks,setTasks]=useState(initialTasks),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
 async function update(task:TitleTask,action:string,dueDate?:string){setBusy(task.id);setError('');try{
 const r=await fetch('/api/work/title-tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:task.id,action,dueDate})});const body=await r.json();if(!r.ok)throw Error(body.error);
 setTasks(items=>action==='confirm'?items.map(t=>t.id===task.id?{...t,state:'scheduled',due_date:dueDate!}:t):items.filter(t=>t.id!==task.id));
 }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(null);}}
 if(!tasks.length)return null;
 return <details><summary>📌 Closing tasks ({tasks.length})</summary>{error&&<p role="alert">{error}</p>}{tasks.map(task=><article key={task.id} style={{padding:'12px 0',borderBottom:'1px solid #eee'}}><strong>{task.email_state==='needs_review'?'Follow-up delivery needs review':task.label}</strong>{task.due_date&&<p>{task.state==='needs_review'?'Suggested date':'Due'}: {task.due_date}</p>}{task.evidence&&<details><summary>See message</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{task.evidence}</p></details>}{task.kind==='deadline'&&task.state==='needs_review'?<form onSubmit={e=>{e.preventDefault();const date=new FormData(e.currentTarget).get('dueDate');if(typeof date==='string')void update(task,'confirm',date);}}><label>Confirm the date <input name="dueDate" type="date" required defaultValue={task.due_date??''} style={{minHeight:44}}/></label><button disabled={busy!==null} style={{minHeight:44}}>Save reminder</button></form>:<button disabled={busy!==null} style={{minHeight:44}} onClick={()=>void update(task,'done')}>{task.kind==='reply_review'?'Mark reviewed':'Mark done'}</button>}<button disabled={busy!==null} style={{minHeight:44}} onClick={()=>void update(task,'dismissed')}>Dismiss</button></article>)}<small>Title follow-ups can send automatically while the bot is running and spending checks pass. Dates need confirmation with your closer.</small></details>;
}
