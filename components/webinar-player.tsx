'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Play,Pause,Volume2,VolumeX} from 'lucide-react';
import {formatWatchTime} from '@/lib/webinar-policy';
import {savePosition,seekToPosition} from '@/lib/webinar-playback';

type Props={sessionId:string;videoUrl:string;posterUrl:string;title:string;progress:number;preview:boolean;overlay?:React.ReactNode;onPreviewSeek:(seconds:number)=>void;onProgress:(seconds:number)=>void;onStarted:()=>void;onCheckpoint:()=>void;onPlayingChange:(playing:boolean)=>void;onEnded:()=>void};
export function WebinarPlayer(props:Props){
 const video=useRef<HTMLVideoElement>(null),position=useRef(props.progress),loaded=useRef(false),lastLocalSave=useRef(-1),resumeOnVisible=useRef(false),alive=useRef(true),playAttempt=useRef(0),mutedByViewer=useRef(false);
 const callbacks=useRef(props);callbacks.current=props;
 const [playing,setPlaying]=useState(false),[muted,setMuted]=useState(false),[error,setError]=useState(''),[buffering,setBuffering]=useState(!!props.videoUrl),[slow,setSlow]=useState(false),[offline,setOffline]=useState(false);
 const [previewTime,setPreviewTime]=useState(props.progress),[duration,setDuration]=useState(0);
 const playback=useCallback((value:boolean)=>{setPlaying(value);callbacks.current.onPlayingChange(value);},[]);
 const checkpoint=useCallback(()=>{if(!callbacks.current.preview&&!video.current?.ended)savePosition(callbacks.current.sessionId,position.current);callbacks.current.onCheckpoint();},[]);
 const reload=useCallback(()=>{const v=video.current;if(!v)return;++playAttempt.current;checkpoint();loaded.current=false;setError('');setSlow(false);setBuffering(true);v.load();},[checkpoint]);
 const attemptPlay=useCallback(async(sound=false)=>{
  const v=video.current;if(!v||document.hidden)return;
  const attempt=++playAttempt.current;
  const current=()=>alive.current&&video.current===v&&playAttempt.current===attempt&&!document.hidden;
  if(sound){v.muted=false;setMuted(false);}
  try{
   try{await v.play();}catch(e){
    if(!current())return;
    // Only an automatic sound attempt can fall back. A tap asks for sound directly.
    if(sound||v.muted||(e as {name?:string})?.name!=='NotAllowedError')throw e;
    v.muted=true;setMuted(true);await v.play();
   }
   if(current())setError('');
  }catch{if(current()){playback(false);setBuffering(false);setSlow(false);}}
 },[playback]);
 function rememberMute(value:boolean){mutedByViewer.current=value;try{if(value)sessionStorage.setItem('icash-webinar-muted','true');else sessionStorage.removeItem('icash-webinar-muted');}catch{/* Sound controls work without browser storage. */}}
 function listen(){rememberMute(false);void attemptPlay(true);}
 function play(){void attemptPlay(!mutedByViewer.current);}
 useEffect(()=>{
  alive.current=true;setOffline(!navigator.onLine);
  const hidden=()=>{
   const v=video.current;if(!v)return;
   if(document.hidden){++playAttempt.current;resumeOnVisible.current=!v.paused&&!v.ended;checkpoint();v.pause();}
   else if(resumeOnVisible.current){resumeOnVisible.current=false;void attemptPlay();}
  };
  const online=()=>{setOffline(false);checkpoint();if(video.current?.error)reload();else if(video.current&&!video.current.paused)void attemptPlay();};
  const disconnected=()=>{setOffline(true);checkpoint();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',checkpoint);window.addEventListener('online',online);window.addEventListener('offline',disconnected);
  return()=>{alive.current=false;++playAttempt.current;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',checkpoint);window.removeEventListener('online',online);window.removeEventListener('offline',disconnected);};
 },[attemptPlay,checkpoint,reload]);
 useEffect(()=>{if(!buffering)return;const timer=setTimeout(()=>{const v=video.current;if(v&&!document.hidden&&!v.paused&&!v.ended&&v.readyState<3)setSlow(true);},12000);return()=>clearTimeout(timer);},[buffering]);
 function tick(){
  const v=video.current;if(!v||!loaded.current||!Number.isFinite(v.currentTime))return;
  // Some mobile browsers emit stalled while already buffered video keeps playing.
  if(v.currentTime>position.current&&!v.paused&&!v.ended){setBuffering(false);setSlow(false);setError('');}
  position.current=v.currentTime;if(props.preview)setPreviewTime(v.currentTime);callbacks.current.onProgress(Math.floor(v.currentTime));
  const bucket=Math.floor(v.currentTime/5);
  if(!props.preview&&lastLocalSave.current!==bucket){lastLocalSave.current=bucket;savePosition(props.sessionId,v.currentTime);}
 }
 function previewSeek(){
  const v=video.current;if(!props.preview||!v||!loaded.current||!Number.isFinite(v.currentTime))return;
  position.current=v.currentTime;setPreviewTime(v.currentTime);setSlow(false);callbacks.current.onPreviewSeek(Math.floor(v.currentTime));
 }
 function seekPreview(value:number){
  const v=video.current;if(!props.preview||!v||!loaded.current||!Number.isFinite(v.duration)||!Number.isFinite(value))return;
  v.currentTime=Math.max(0,Math.min(v.duration,value));previewSeek();
 }
 function previewMute(){const v=video.current;if(!v)return;v.muted=!v.muted;setMuted(v.muted);rememberMute(v.muted);}
 function updateDuration(){const value=video.current?.duration;if(value&&Number.isFinite(value))setDuration(value);}
 function metadata(){
  const v=video.current;if(!v||loaded.current)return;
  if(!seekToPosition(v,position.current)){setError('Your video is ready to reconnect.');return;}
  try{if(sessionStorage.getItem('icash-webinar-muted')==='true'){mutedByViewer.current=true;v.muted=true;setMuted(true);}}catch{/* Muting does not require storage. */}
  loaded.current=true;updateDuration();setPreviewTime(v.currentTime);void attemptPlay();
 }
 if(props.preview&&!props.videoUrl)return <div className="wb-player"><div className="wb-stream-status"><span>Owner preview</span></div><div className="wb-video-placeholder" role="status"><Play size={32} aria-hidden="true"/><strong>Your video goes here</strong><p>Upload your recording in the studio to preview playback.</p></div></div>;
 return <><div className="wb-player">
  <video ref={video} src={props.videoUrl||undefined} poster={props.posterUrl||undefined} playsInline controls={false} muted={muted} preload="auto" aria-label={props.title}
   onDurationChange={updateDuration} onLoadedMetadata={metadata} onCanPlay={()=>{metadata();setBuffering(false);setSlow(false);}}
   onPlay={()=>{playback(true);callbacks.current.onStarted();}}
   onPlaying={()=>{playback(true);setError('');setBuffering(false);setSlow(false);}}
   onPause={()=>{playback(false);setBuffering(false);setSlow(false);checkpoint();}}
   onTimeUpdate={tick} onSeeking={previewSeek} onSeeked={tick} onVolumeChange={()=>setMuted(video.current?.muted??true)}
   onWaiting={()=>{if(!video.current?.paused)setBuffering(true);}} onStalled={()=>{const v=video.current;if(v&&!v.paused&&v.readyState<3)setBuffering(true);}}
   onError={()=>{++playAttempt.current;playback(false);setBuffering(false);setError('Your video connection was interrupted.');checkpoint();}}
   onEnded={()=>{++playAttempt.current;setBuffering(false);setSlow(false);tick();playback(false);callbacks.current.onEnded();}}/>
  <div className="wb-stream-status"><span className="wb-live"><span className="wb-live-dot" aria-hidden="true"/>LIVE</span>{props.preview&&<span>Owner preview</span>}</div>
  {!props.preview&&(!playing||muted)&&!error&&!slow&&<button type="button" className="wb-unmute" onClick={playing?listen:play}><VolumeX aria-hidden="true"/><strong>{playing?'Tap to listen':position.current>0?'Continue watching':'Tap to play'}</strong></button>}
  {(error||slow)&&<div className="wb-player-recovery" role="status"><p>{offline?'You’re offline. Reconnect to continue.':error||'Video paused. Tap to resume.'}</p><button type="button" onClick={reload}>Resume video</button><a href="/support">Get help</a></div>}
  {props.overlay}
 </div>
 {props.preview&&<div className="wb-preview-player-controls" role="group" aria-label="Preview playback controls">
  <input type="range" aria-label="Preview video timeline" aria-valuetext={`${formatWatchTime(previewTime)} of ${formatWatchTime(duration)}`} min={0} max={duration||1} step={1} value={Math.min(previewTime,duration||0)} disabled={!duration} onChange={e=>seekPreview(Number(e.target.value))}/>
  <div><button type="button" aria-label={playing?'Pause preview':'Play preview'} onClick={()=>{if(video.current?.paused)play();else video.current?.pause();}}>{playing?<Pause size={20}/>:<Play size={20}/>}</button><span>{formatWatchTime(previewTime)} / {formatWatchTime(duration)}</span><button type="button" aria-label={muted?'Unmute preview':'Mute preview'} onClick={previewMute}>{muted?<VolumeX size={20}/>:<Volume2 size={20}/>}</button></div>
 </div>}
 </>;
}
