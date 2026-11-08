'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {supportRequest} from '@/lib/support-client';
import type {QualityCase,QualityScope,SupportQualityReport} from '@/lib/support-quality';
export function SupportQualityPanel({onOpen,onDenied}:{onOpen:(item:QualityCase)=>void;onDenied:()=>void}){
 const [report,setReport]=useState<SupportQualityReport|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[topic,setTopic]=useState('all');
 const generation=useRef(0),denied=useRef(onDenied);denied.current=onDenied;
 const load=useCallback(async(scope:QualityScope='unresolved',cursor?:string)=>{
  const seq=++generation.current;setBusy(true);setError('');
  try{const query=new URLSearchParams({scope});if(cursor)query.set('cursor',cursor);
   const {ok,status,data}=await supportRequest<SupportQualityReport&{error?:string}>(`/api/support/admin/quality?${query}`,{cache:'no-store'});
   if(seq!==generation.current)return;
   if(status===403){setReport(null);denied.current();throw Error('Sign in with a support operator account.');}
   if(!ok)throw Error(data.error||'Support quality could not load.');setReport(data);setTopic(current=>current==='all'||data.topics.some(t=>t.topic===current)?current:'all');
  }catch(e){if(seq===generation.current){setReport(null);setError(e instanceof Error?e.message:'Support quality could not load.');}}finally{if(seq===generation.current)setBusy(false);}
 },[]);
 useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
 const cases=report?.cases.filter(c=>topic==='all'||c.topic===topic)??[];
 return <section className="support-notice desk-quality" aria-label="Support quality">
  <h2>Support quality</h2><p>Find recurring questions, repeated replies and conversations that need another look. These flags call for review; they do not confirm a bug or a fix.</p>
  <label>Conversations <select disabled={busy} value={report?.page?.scope??'unresolved'} onChange={event=>void load(event.target.value as QualityScope)}><option value="unresolved">Unresolved backlog</option><option value="recent">Recent history</option></select></label>
  <button type="button" disabled={busy} onClick={()=>void load(report?.page?.scope??'unresolved')}>{busy?'Reviewing conversations…':'Restart support review'}</button>
  {error&&<p role="alert">{error}</p>}
  {report&&<><p>{report.needsReview} open conversations flagged · {report.flagged} flagged overall · {report.sampled} conversations on this page. {report.page?.scope==='unresolved'?'All unresolved ages are included. Pages advance from the oldest created cases. Restart to include cases created or reopened during this review.':`Includes conversations updated in the last ${report.days} days.`} {report.page?.messagesLimited?'Some conversations show only their latest 40 messages. ':''}{report.page?.nextCursor?'More conversations are available on the next page. ':''}</p>
   {report.improvement&&<p>On this page: {report.improvement.metrics.failedSteps} repeated troubleshooting failures · {report.improvement.metrics.paymentAccess} unresolved payment or access concerns · {report.improvement.metrics.customerConfirmed} customer-reported fixes. Closing a conversation does not count as a confirmed fix. These signals are not a dispute rate.</p>}
   <label>Review topic <select value={topic} onChange={event=>setTopic(event.target.value)}><option value="all">All topics</option>{report.topics.map(t=><option key={t.topic} value={t.topic}>{t.topic} — {t.flagged} flagged / {t.conversations} conversations</option>)}</select></label>
   {cases.length===0?<p>No review flags in this sample. This does not establish that every issue is resolved.</p>:<ul>{cases.map(item=><li key={item.kind+':'+item.id}><strong>{item.topic}</strong> · {item.status.replaceAll('_',' ')}<p>{item.question}</p><p>{item.flags.length?item.flags.map(f=>f.label).join(' · '):'No quality flags in the reviewed messages'}</p>{item.lastReply&&<details><summary>Latest Support reply</summary><p>{item.lastReply}</p></details>}<button type="button" onClick={()=>onOpen(item)}>Review conversation</button></li>)}</ul>}
   {report.page?.nextCursor&&<button type="button" disabled={busy} onClick={()=>void load(report.page!.scope,report.page!.nextCursor!)}>Next review page</button>}
  </>}
 </section>;
}
