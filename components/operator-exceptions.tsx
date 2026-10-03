'use client';
import {useEffect,useRef,useState} from 'react';
import {exceptionLabels,exceptionSources,exceptionMaxPage,type ExceptionSnapshot,type ExceptionSource} from '@/lib/operator-exception-types';
type Result=({enabled:false}|({enabled:true}&ExceptionSnapshot));
export function OperatorExceptions(){
 const [opened,setOpened]=useState(false),[source,setSource]=useState<ExceptionSource|''>(''),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0);
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sequence=useRef(0);
 useEffect(()=>{
  if(!opened)return;
  const request=++sequence.current,controller=new AbortController();setBusy(true);setError('');setResult(null);
  const query=new URLSearchParams();if(source)query.set('source',source);query.set('page',String(page));
  void fetch('/api/support/admin/operations?'+query,{cache:'no-store',signal:controller.signal}).then(async response=>{
   const data=await response.json();if(!response.ok)throw Error(data.error??'Operations checks are unavailable.');
   if(sequence.current===request&&!controller.signal.aborted)setResult(data);
  }).catch(e=>{if(sequence.current===request&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Operations checks are unavailable.');})
   .finally(()=>{if(sequence.current===request&&!controller.signal.aborted)setBusy(false);});
  return ()=>{controller.abort();sequence.current++;};
 },[opened,source,page,refresh]);
 const snapshot=result?.enabled?result:null;
 function changePage(next:number,nextSource:ExceptionSource|''=source){setResult(null);setError('');setPage(next);setSource(nextSource);}
 function refreshChecks(){setResult(null);setError('');setRefresh(value=>value+1);}
 return <section className="operator-exceptions" aria-labelledby="operator-exceptions-heading">
  <div className="operator-exceptions-heading"><div><h2 id="operator-exceptions-heading">Operations needing review</h2><p>Read-only checks across accounts covered by your provisioned support access.</p></div><button aria-expanded={opened} onClick={()=>{setResult(null);setError('');setBusy(!opened);setOpened(value=>!value);}}>{opened?'Close checks':'Review operations'}</button></div>
  {opened&&<>
   <div className="operator-exceptions-controls"><label htmlFor="operator-source">Category</label><select id="operator-source" value={source} onChange={e=>changePage(0,e.target.value as ExceptionSource|'')}><option value="">All categories</option>{exceptionSources.map(key=><option key={key} value={key}>{exceptionLabels[key]}</option>)}</select><button disabled={busy} onClick={refreshChecks}>Refresh checks</button></div>
   {busy&&<p role="status">Checking recorded operations…</p>}
   {error&&<p className="support-error" role="alert">{error} No current health result is available.</p>}
   {result&&!result.enabled&&<p className="support-notice">Operations checks have not been enabled for this deployment.</p>}
   {snapshot&&<>
    <p className="support-intro">Checked {new Date(snapshot.observedAt).toLocaleString()}. Each category shows up to 20 recorded items, oldest first. These are bounded checks, not an all-clear for the platform. No work is retried, funds released or messages sent here.</p>
    {snapshot.partial&&<p className="support-error" role="alert">Some checks were unavailable. Missing results do not mean those operations are healthy.</p>}
    <div className="operator-exception-sections">{snapshot.sections.map(section=><section key={section.source} aria-labelledby={'exception-'+section.source}>
     <h3 id={'exception-'+section.source}>{section.label} <small>{section.items.length} shown</small></h3>
     {section.status==='unavailable'&&<p className="support-notice">This check is incomplete or unavailable. Any displayed records were verified; other records may be missing.</p>}
     {section.status==='checked'&&!section.items.length&&<p className="support-intro">No matching records in this checked page.</p>}
     <ul className="operator-exception-list">{section.items.map(item=><li key={item.key} data-priority={item.priority}>
      <strong>{item.title}</strong><p>{item.detail}</p><p className="operator-next-step">{item.nextStep}</p>
      <details><summary>Recorded evidence</summary><dl><dt>Account</dt><dd>{item.accountId}</dd><dt>Source record</dt><dd>{item.recordId}</dd><dt>Recorded state</dt><dd>{item.state}</dd><dt>Recorded time</dt><dd>{new Date(item.recordedAt).toLocaleString()}</dd>{item.dueDate&&<><dt>Confirmed date</dt><dd>{item.dueDate} · America/Chicago</dd></>}</dl></details>
     </li>)}</ul>
     {section.hasMore&&section.page<exceptionMaxPage&&<button disabled={busy} onClick={()=>changePage(section.page+1,section.source)}>Next {section.label.toLowerCase()} records</button>}
     {section.hasMore&&section.page>=exceptionMaxPage&&<p className="support-notice">The bounded page limit has been reached. Additional matching records may remain; use a separately authorized backend investigation for a complete export.</p>}
    </section>)}</div>
   </>}
   {source&&page>0&&<nav className="operator-exceptions-controls" aria-label="Exception pages"><button disabled={busy} onClick={()=>changePage(Math.max(0,page-1))}>Previous page</button><span>Page {page+1} · live records can change between pages</span><button disabled={busy} onClick={()=>changePage(0)}>First page</button></nav>}
  </>}
 </section>;
}
