'use client';
import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,BookOpen,Check,X} from 'lucide-react';
import {webinarRequest} from '@/lib/webinar-client';
import {courseProgressSchema,type CourseProgress} from '@/lib/course-progress';
import {walkthroughState,walkthroughSteps,type WalkthroughState} from '@/lib/workspace-walkthrough';
import styles from './workspace-walkthrough.module.css';

type SaveState={step:number;state:'active'|'dismissed'|'completed'};
type Position={spot:CSSProperties|null;card:CSSProperties};
function TourDialog({step,course,busy,error,onMove,onClose,onCourse,onFinish}:{step:number;course:CourseProgress|null;busy:boolean;error:string;onMove:(step:number)=>void;onClose:()=>void;onCourse:()=>void;onFinish:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),card=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const [position,setPosition]=useState<Position>({spot:null,card:{visibility:'hidden'}});
 const current=walkthroughSteps[step],watched=course?.state==='completed';
 useLayoutEffect(()=>{
  const node=dialog.current;if(!node)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null,overflow=document.body.style.overflow;
  node.showModal();document.body.style.overflow='hidden';
  return()=>{node.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
 },[]);
 useLayoutEffect(()=>{
  let frame=0;
  const target=document.getElementById(current.target);
  const initial=target?.getBoundingClientRect(),panelHeight=card.current?.offsetHeight??320;
  if(initial&&(initial.top<16||initial.top+Math.min(initial.height,window.innerHeight-panelHeight-52)+panelHeight+36>window.innerHeight))window.scrollBy({top:initial.top-16,behavior:'instant'});
  function measure(){
   const panel=card.current;if(!panel)return;
   const width=window.innerWidth,height=window.innerHeight,pad=16,gap=20;
   const node=document.getElementById(current.target),box=node?.getBoundingClientRect();
   const visible=box&&box.width>0&&box.height>0&&box.bottom>0&&box.top<height;
   const left=visible?Math.max(8,box.left-6):0,top=visible?Math.max(8,box.top-6):0;
   const spotWidth=visible?Math.min(width-left-8,box.width+12):0;
   const spotHeight=visible?Math.min(box.height+12,Math.max(44,height-panel.offsetHeight-gap-pad*2)):0;
   const below=top+spotHeight+gap,above=top-panel.offsetHeight-gap;
   const cardTop=visible&&below+panel.offsetHeight<=height-pad?below:visible&&above>=pad?above:Math.max(pad,height-panel.offsetHeight-pad);
   const cardLeft=Math.max(pad,Math.min(visible?left:(width-panel.offsetWidth)/2,width-panel.offsetWidth-pad));
   setPosition({spot:visible?{left,top,width:spotWidth,height:spotHeight}:null,card:{top:cardTop,left:cardLeft}});
  }
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
  measure();heading.current?.focus({preventScroll:true});
  const observer=new ResizeObserver(schedule);if(card.current)observer.observe(card.current);if(target)observer.observe(target);
  window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);};
 },[current.target]);
 return <dialog ref={dialog} data-workspace-tour className={styles.dialog} aria-labelledby="workspace-tour-title" aria-describedby="workspace-tour-detail" onCancel={event=>{event.preventDefault();onClose();}}>
  <div className={position.spot?styles.spotlight:styles.shade} style={position.spot??undefined} aria-hidden="true"/>
  <div ref={card} className={styles.card} style={position.card}>
   <div className={styles.top}><span>GETTING STARTED · {step+1} OF {walkthroughSteps.length}</span><button type="button" className={styles.close} aria-label="Finish walkthrough later" onClick={onClose}><X size={19}/></button></div>
   <div className={styles.progress} aria-hidden="true">{walkthroughSteps.map((item,index)=><span key={item.target} data-current={index<=step}/>)}</div>
   <h2 ref={heading} tabIndex={-1} id="workspace-tour-title">{step===0&&watched?'Your course is watched.':current.title}</h2>
   <p id="workspace-tour-detail">{step===0&&watched?'You can revisit the course anytime. Let’s take a quick look around your workspace.':current.detail}</p>
   {step===0&&course?.state==='in_progress'&&<p className={styles.saved}>{course.percent}% watched · Continue at your own pace.</p>}
   {error&&<p className={styles.error} role="alert">{error}</p>}
   <div className={styles.actions}>
    {step===0?<><button type="button" className={styles.primary} disabled={busy} onClick={onCourse}><BookOpen size={17}/>{watched?'Revisit course':'Watch course'}</button><button type="button" className={styles.secondary} disabled={busy} onClick={()=>onMove(1)}>Show me around<ArrowRight size={16}/></button></>:<><button type="button" className={styles.secondary} disabled={busy} onClick={()=>onMove(step-1)}>Back</button><button type="button" className={styles.primary} disabled={busy} onClick={step===walkthroughSteps.length-1?onFinish:()=>onMove(step+1)}>{step===walkthroughSteps.length-1?'Finish walkthrough':'Next'}{step===walkthroughSteps.length-1?<Check size={17}/>:<ArrowRight size={17}/>}</button></>}
   </div>
   <p className={styles.note}>{busy?'Saving your place…':'You can come back to this walkthrough anytime.'}</p>
  </div>
 </dialog>;
}

export function WorkspaceWalkthrough({openRequest,blocked,onOpenChange}:{openRequest:number;blocked:boolean;onOpenChange:(open:boolean)=>void}){
 const [tour,setTour]=useState<WalkthroughState|null>(null),[course,setCourse]=useState<CourseProgress|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[occupied,setOccupied]=useState(false);
 const queue=useRef<Promise<unknown>>(Promise.resolve()),revision=useRef(0),mounted=useRef(false),manual=useRef(false),retry=useRef<SaveState|null>(null),writeController=useRef<AbortController|null>(null);
 useEffect(()=>{
  mounted.current=true;const controller=new AbortController();writeController.current=new AbortController();
  const url=new URL(window.location.href),returning=url.searchParams.get('walkthrough')==='1';
  if(returning){manual.current=true;setTour({step:1,state:'active'});setOpen(true);url.searchParams.delete('walkthrough');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);}
  void webinarRequest<{tour:unknown;course:unknown}>('/api/account/walkthrough',{cache:'no-store',signal:controller.signal},10000).then(data=>{
   if(controller.signal.aborted)return;
   const saved=walkthroughState.parse(data.tour),progress=courseProgressSchema.safeParse(data.course);
   setCourse(progress.success?progress.data:null);
   if(!manual.current){setTour(saved);setOpen(saved.state==='new'||saved.state==='active');}
  }).catch(()=>{/* A guide outage must not block the customer's workspace; the menu can still open it. */});
  return()=>{mounted.current=false;controller.abort();writeController.current?.abort();};
 },[]);
 useEffect(()=>{if(openRequest>0){manual.current=true;setTour({step:0,state:'active'});setOpen(true);setError('');}},[openRequest]);
 useEffect(()=>{
  const check=()=>setOccupied(!!document.querySelector('dialog[open]:not([data-workspace-tour]),.workspace-account-menu[open]')||!!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'));
  check();const observer=new MutationObserver(check);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
  document.addEventListener('focusin',check);document.addEventListener('focusout',check);
  return()=>{observer.disconnect();document.removeEventListener('focusin',check);document.removeEventListener('focusout',check);};
 },[]);
 const visible=open&&!blocked&&!occupied;
 useEffect(()=>{onOpenChange(visible);return()=>onOpenChange(false);},[visible,onOpenChange]);
 async function save(next:SaveState){
  manual.current=true;setTour(next);setBusy(true);setError('');retry.current=next;
  const sequence=++revision.current,signal=writeController.current?.signal;
  // Serialize teaching-progress writes so a quick dismissal wins over an earlier Next.
  const pending=queue.current.catch(()=>{}).then(()=>{
   if(!mounted.current||signal?.aborted)throw Error('Walkthrough closed');
   return webinarRequest<{tour:unknown}>('/api/account/walkthrough',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next),signal},10000);
  });
  queue.current=pending;
  try{const result=await pending;walkthroughState.parse(result.tour);if(mounted.current&&revision.current===sequence)retry.current=null;return true;}
  catch{if(mounted.current&&revision.current===sequence)setError('We couldn’t save your place. You can retry or keep using your workspace.');return false;}
  finally{if(mounted.current&&revision.current===sequence)setBusy(false);}
 }
 function close(){setOpen(false);void save({step:tour?.step??0,state:'dismissed'});}
 async function watchCourse(){if(await save({step:1,state:'active'})&&mounted.current)window.location.assign('/course');}
 const reminder=!visible&&tour&&['active','dismissed'].includes(tour.state);
 return <>
  {reminder&&!blocked&&<section className={styles.reminder} aria-label="Getting started"><div><strong>{course?.state==='completed'?'Ready for a quick tour?':'Start with the course'}</strong><p>{course?.state==='completed'?'See where everything lives in your workspace.':'Learn the steps, then explore your workspace.'}</p></div><div className={styles.reminderActions}><a href="/course">{course?.state==='completed'?'Course':'Watch course'}</a><button type="button" onClick={()=>setOpen(true)}>Continue walkthrough<ArrowRight size={15}/></button></div></section>}
  {!visible&&error&&<p className={styles.saveError} role="status">{error} <button type="button" disabled={busy} onClick={()=>{if(retry.current)void save(retry.current);}}>Retry</button></p>}
  {visible&&<TourDialog step={tour?.step??0} course={course} busy={busy} error={error} onMove={step=>void save({step,state:'active'})} onClose={close} onCourse={()=>void watchCourse()} onFinish={()=>{setOpen(false);void save({step:walkthroughSteps.length-1,state:'completed'});}}/>}
 </>;
}
