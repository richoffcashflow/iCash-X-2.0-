'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Maximize,Pause,Play,Volume2,VolumeX} from 'lucide-react';
import {savePosition,seekToPosition} from '@/lib/webinar-playback';

type Props={sessionId:string;videoUrl:string;posterUrl:string;title:string;progress:number;preview:boolean;onProgress:(seconds:number)=>void;onStarted:()=>void;onCheckpoint:()=>void;onPlayingChange:(playing:boolean)=>void;onEnded:()=>void};
export function WebinarPlayer(props:Props){
 const video=useRef<HTMLVideoElement>(null),position=useRef(props.progress),loaded=useRef(false),lastLocalSave=useRef(-1),resumeOnVisible=useRef(false),alive=useRef(true);
 const callbacks=useRef(props);callbacks.current=props;
 const [playing,setPlaying]=useState(false),[muted,setMuted]=useState(true),[error,setError]=useState(''),[buffering,setBuffering]=useState(!!props.videoUrl),[slow,setSlow]=useState(false),[offline,setOffline]=useState(false);
 const playback=useCallback((value:boolean)=>{setPlaying(value);callbacks.current.onPlayingChange(value);},[]);
 const checkpoint=useCallback(()=>{if(!callbacks.current.preview&&!video.current?.ended)savePosition(callbacks.current.sessionId,position.current);callbacks.current.onCheckpoint();},[]);
 const reload=useCallback(()=>{const v=video.current;if(!v)return;checkpoint();loaded.current=false;setError('');setSlow(false);setBuffering(true);v.load();},[checkpoint]);
 const attemptPlay=useCallback(async(sound=false)=>{
  const v=video.current;if(!v||document.hidden)return;
  if(sound){v.muted=false;setMuted(false);}
  try{await v.play();if(alive.current)setError('');}catch{if(alive.current){playback(false);setBuffering(false);setSlow(false);}}
 },[playback]);
 useEffect(()=>{
  alive.current=true;setOffline(!navigator.onLine);
  const hidden=()=>{
   const v=video.current;if(!v)return;
   if(document.hidden){resumeOnVisible.current=!v.paused&&!v.ended;checkpoint();v.pause();}
   else if(resumeOnVisible.current){resumeOnVisible.current=false;void attemptPlay();}
  };
  const online=()=>{setOffline(false);checkpoint();if(video.current?.error)reload();else if(video.current&&!video.current.paused)void attemptPlay();};
  const disconnected=()=>{setOffline(true);checkpoint();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',checkpoint);window.addEventListener('online',online);window.addEventListener('offline',disconnected);
  return()=>{alive.current=false;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',checkpoint);window.removeEventListener('online',online);window.removeEventListener('offline',disconnected);};
 },[attemptPlay,checkpoint,reload]);
 useEffect(()=>{if(!buffering)return;const timer=setTimeout(()=>setSlow(true),12000);return()=>clearTimeout(timer);},[buffering]);
 function tick(){
  const v=video.current;if(!v||!loaded.current||!Number.isFinite(v.currentTime))return;
  position.current=v.currentTime;callbacks.current.onProgress(Math.floor(v.currentTime));
  const bucket=Math.floor(v.currentTime/5);
  if(!props.preview&&lastLocalSave.current!==bucket){lastLocalSave.current=bucket;savePosition(props.sessionId,v.currentTime);}
 }
 function metadata(){
  const v=video.current;if(!v||loaded.current)return;
  if(!seekToPosition(v,position.current)){setError('Your video is ready to reconnect.');return;}
  loaded.current=true;void attemptPlay();
 }
 async function fullscreen(){
  const v=video.current as (HTMLVideoElement&{webkitEnterFullscreen?:()=>void})|null;
  try{if(v?.requestFullscreen)await v.requestFullscreen();else v?.webkitEnterFullscreen?.();}catch{/* Fullscreen is optional in embedded browsers. */}
 }
 if(props.preview&&!props.videoUrl)return <div className="wb-player"><div className="wb-stream-status"><span>Owner preview</span></div><div className="wb-video-placeholder" role="status"><Play size={32} aria-hidden="true"/><strong>Your video goes here</strong><p>Upload your recording in the studio to preview playback.</p></div></div>;
 return <div className="wb-player">
  <video ref={video} src={props.videoUrl||undefined} poster={props.posterUrl||undefined} playsInline autoPlay muted preload="auto" aria-label={props.title}
   onLoadedMetadata={metadata} onCanPlay={()=>{metadata();setBuffering(false);setSlow(false);}}
   onPlay={()=>{playback(true);callbacks.current.onStarted();}}
   onPlaying={()=>{playback(true);setError('');setBuffering(false);setSlow(false);}}
   onPause={()=>{playback(false);checkpoint();}}
   onTimeUpdate={tick} onVolumeChange={()=>setMuted(video.current?.muted??true)}
   onWaiting={()=>setBuffering(true)} onStalled={()=>setBuffering(true)}
   onError={()=>{playback(false);setBuffering(false);setError('Your video connection was interrupted.');checkpoint();}}
   onEnded={()=>{setBuffering(false);setSlow(false);tick();playback(false);callbacks.current.onEnded();}}/>
  <div className="wb-stream-status"><span className="wb-live">● LIVE</span>{props.preview&&<span>Owner preview</span>}</div>
  {(!playing||muted)&&!error&&!slow&&<button type="button" className="wb-unmute" onClick={()=>void attemptPlay(true)}><VolumeX aria-hidden="true"/><strong>{playing?'Tap to unmute':position.current>0?'Continue watching':'Tap to play'}</strong></button>}
  {(error||slow)&&<div className="wb-player-recovery" role="status"><p>{offline?'You’re offline. Reconnect to continue.':error||'The video is taking longer to load.'}</p><button type="button" onClick={reload}>Resume video</button><a href="/support">Get help</a></div>}
  <div className="wb-player-actions"><button type="button" aria-label={playing?'Pause video':'Play video'} onClick={()=>playing?video.current?.pause():void attemptPlay(true)}>{playing?<Pause/>:<Play/>}</button><button type="button" aria-label={muted?'Unmute video':'Mute video'} onClick={()=>{if(video.current){video.current.muted=!video.current.muted;setMuted(video.current.muted);}}}>{muted?<VolumeX/>:<Volume2/>}</button><button type="button" aria-label="Full screen" onClick={()=>void fullscreen()}><Maximize/></button></div>
 </div>;
}
