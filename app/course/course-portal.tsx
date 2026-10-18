'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,BookOpen,Check,Download,FileText,Gem,MessageCircle,Play,Upload,Users,Volume2} from 'lucide-react';
import {AccountAccess} from '@/components/account-access';
import type {CourseOverview} from '@/lib/course-policy';
import {useCourseProgress} from '@/lib/use-course-progress';
import {uploadCourseFile} from '@/lib/course-upload';
import styles from './course.module.css';

function CourseUpload({kind,revision,name,onSaved}:{kind:'video'|'pdf';revision:number;name:string|null;onSaved:()=>Promise<void>}){
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[message,setMessage]=useState('');
 const request=useRef<AbortController|null>(null),input=useRef<HTMLInputElement>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function upload(){
  if(!file||request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');setProgress(0);
  try{await uploadCourseFile(file,kind,revision,setProgress,controller.signal);setFile(null);if(input.current)input.current.value='';setMessage('Published. Customers can now open this file.');await onSaved();}
  catch(e){setMessage(controller.signal.aborted?'Upload canceled. Your published file is unchanged.':e instanceof Error?e.message:'Upload failed. Please retry.');}
  finally{request.current=null;setBusy(false);}
 }
 return <section className={styles.upload}><h3>{kind==='video'?'Upload course video':'Upload course PDF'}</h3><p>{name?`Published: ${name}`:'No file published yet.'}</p><label>Choose {kind==='video'?'video':'PDF'}<input ref={input} type="file" accept={kind==='video'?'.mp4,.webm,video/mp4,video/webm':'.pdf,application/pdf'} disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);setMessage('');}}/></label><small>{kind==='video'?'MP4 (H.264 recommended) or WebM · up to 2 GB':'PDF · up to 50 MB'}</small><div className={styles.uploadActions}><button type="button" disabled={!file||busy} onClick={()=>void upload()}><Upload size={16}/>{busy?progress===100?'Publishing…':`Uploading ${progress}%`:'Upload & publish'}</button>{busy&&<button type="button" onClick={()=>request.current?.abort()}>Cancel</button>}</div>{busy&&<progress value={progress} max={100} aria-label={`${kind} upload progress`}/>}<p role="status">{message}</p></section>;
}

export function CoursePortal(){
 const [course,setCourse]=useState<CourseOverview|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[signIn,setSignIn]=useState(false),[videoError,setVideoError]=useState(false),[videoAttempt,setVideoAttempt]=useState(0);
 const controller=useRef<AbortController|null>(null),video=useRef<HTMLVideoElement|null>(null);
 const savedProgress=useCourseProgress(video,course?.assets.video.ready?course.assets.video.revision:undefined,videoAttempt);
 const progress=savedProgress??course?.progress;
 const refresh=useCallback(async()=>{
  controller.current?.abort();const request=new AbortController();controller.current=request;setLoading(true);setError('');
  try{const res=await fetch('/api/course',{cache:'no-store',signal:request.signal});const data=await res.json();if(request.signal.aborted)return;if(!res.ok){setCourse(null);setSignIn(res.status===401);throw Error(data.error||'Could not load your course.');}setCourse(data);setSignIn(false);}
  catch(e){if(!request.signal.aborted)setError(e instanceof Error?e.message:'Could not load your course.');}
  finally{if(!request.signal.aborted)setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();return()=>controller.current?.abort();},[refresh]);
 return <div className={styles.portal}>
  <header className={styles.header}><a href="/" className={styles.brand}>iCash X<span>MEMBER COURSE</span></a><a href="/" className={styles.back}><ArrowLeft size={16}/>My workspace</a></header>
  <main className={styles.main}>
   <div className={styles.intro}><span className={styles.eyebrow}>START HERE</span><h1>Learn it. See it. Put it to work.</h1><p>Your guide to iCash X, from the first seller conversation to closing.</p></div>
   {loading&&!course?<div className={styles.notice} role="status">Loading your course…</div>:!course?<section className={styles.notice}>{signIn?<><h2>Welcome to your course</h2><p>Sign in with the email you used to join iCash X.</p><AccountAccess onSignedIn={()=>void refresh()}/></>:<><p role="alert">{error}</p><button onClick={()=>void refresh()}>Try again</button><a href="/">Open my workspace</a></>}</section>:<>
    {error&&<p role="alert">{error}</p>}
    {course.owner&&<section className={styles.owner} aria-labelledby="course-files-title"><h2 id="course-files-title"><Upload size={18}/>Manage course files</h2><p>{course.canUpload?'Choose your video or PDF, then select Upload & publish. Customers will see the file once the upload finishes.':'Unlock your owner tools to upload the course video and PDF.'}</p>{course.canUpload?<div className={styles.uploadGrid}><CourseUpload kind="video" revision={course.assets.video.revision} name={course.assets.video.name} onSaved={refresh}/><CourseUpload kind="pdf" revision={course.assets.pdf.revision} name={course.assets.pdf.name} onSaved={refresh}/></div>:<a className={styles.resourceButton} href="/dashboard-unlock?next=%2Fcourse">Unlock owner uploads<ArrowUpRight size={16}/></a>}</section>}
    <section className={styles.lesson} aria-labelledby="lesson-title"><div className={styles.videoShell}>
     {course.assets.video.ready?<><video ref={video} key={`${course.assets.video.revision}:${videoAttempt}`} controls playsInline preload="metadata" aria-label="How to use iCash X course video" src={`/api/course/assets/video?v=${course.assets.video.revision}&retry=${videoAttempt}`} onError={()=>setVideoError(true)}/>{videoError&&<div className={styles.videoError} role="alert"><p>The video couldn’t load. Refresh playback to try again.</p><button onClick={()=>{setVideoError(false);setVideoAttempt(v=>v+1);}}>Reload video</button></div>}</>:<div className={styles.videoPlaceholder}><span className={styles.play}><Play size={30}/></span><h2>Your iCash X walkthrough</h2><p>{course.owner?'Upload your course video below to publish it here.':'Your course video is being prepared. Explore the practice workspace below.'}</p></div>}
    </div><div className={styles.lessonCaption}><div><span className={styles.eyebrow}>THE COMPLETE WALKTHROUGH</span><h2 id="lesson-title">How to use iCash X</h2>{progress?.percent!=null&&<p className={styles.watchProgress} role="status">{progress.state==='completed'?'Course watched':`${progress.percent}% watched`}</p>}</div><span className={styles.lessonTag}><BookOpen size={16}/>One course. Every step.</span></div></section>
    <section className={styles.resources} aria-labelledby="resources-title"><h2 id="resources-title">Keep learning below the video</h2>
     <div className={styles.resource}><span className={styles.resourceIcon}><FileText size={24}/></span><div><span className={styles.step}>01 · YOUR REFERENCE</span><h3>Download the course PDF</h3><p>Keep the slides nearby while you watch and use your workspace.</p></div>{course.assets.pdf.ready?<a href="/api/course/assets/pdf" download="iCash-X-Course-Guide.pdf" className={styles.resourceButton}><Download size={17}/>Download PDF</a>:<span className={styles.pending}>PDF coming soon</span>}</div>
     <div className={styles.resource}><span className={styles.resourceIcon}><BookOpen size={24}/></span><div><span className={styles.step}>02 · TRY IT YOURSELF</span><h3>Explore the practice workspace</h3><p>Follow a sample deal, review contracts and see each step through closing.</p></div><a href="/preview/workspace" className={styles.resourceButton}>Open practice workspace<ArrowUpRight size={17}/></a></div>
     <div className={styles.resource}><span className={styles.resourceIcon}><ArrowUpRight size={24}/></span><div><span className={styles.step}>YOUR NEXT STEP</span><h3>Get to know your workspace</h3><p>Take a guided tour of your bot controls, properties and Help.</p></div><a href="/?walkthrough=1" className={styles.resourceButton}>Continue workspace walkthrough<ArrowUpRight size={17}/></a></div>
    </section>
    <section className={styles.vip} aria-labelledby="course-vip-title"><div className={styles.vipTop}><span className={styles.vipBadge}><Gem size={17}/>iCash X VIP</span>{course.vip&&<span className={styles.included}><Check size={16}/>Included in your plan</span>}</div><div className={styles.vipHeading}><div><h2 id="course-vip-title">{course.vip?'Your VIP tools are ready.':'Give your workspace the VIP upgrade.'}</h2><p>More guidance. More reach. Your own AI voice.</p></div>{!course.vip&&<div className={styles.price}><strong>$50<span> more today</span></strong><p>Then $100/month total on your existing renewal date.</p></div>}</div><div className={styles.benefits}><div><MessageCircle size={22}/><h3>Ask AI Bot</h3><p>Ask about a deal and your next move.</p></div><div><Users size={22}/><h3>A wider buyer network</h3><p>Access eligible buyers across the platform.</p></div><div><Volume2 size={22}/><h3>Your voice. More value.</h3><p>Custom AI voice, priority eligible leads and 20% off AI work and leads.</p></div></div><div className={styles.vipBottom}><a href={course.vip?'/':'/?upgrade=vip'} className={styles.vipCta}>{course.vip?'Open my VIP workspace':'Upgrade to VIP'}<ArrowUpRight size={18}/></a><p>{course.vip?'Use your VIP tools directly from your workspace.':'Review your plan and payment before confirming. Usage credits are separate.'}</p></div></section>
   </>}
   <footer className={styles.footer}><span>iCash X · Learn at your own pace.</span><a href="/">Go to my workspace<ArrowUpRight size={15}/></a></footer>
  </main>
 </div>;
}
