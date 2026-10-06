type Checkpoint={seconds:number;updatedAt:number};
const prefix='icash-webinar-progress:';
const lifetime=24*60*60*1000;
export function boundedPosition(seconds:number,duration:number){
 return Math.max(0,Math.min(Number.isFinite(seconds)?seconds:0,Number.isFinite(duration)&&duration>0?Math.max(0,duration-1):14400));
}
/** Session-scoped and timestamped: another recording or visitor never inherits it. */
export function restoredPosition(sessionId:string,serverSeconds:number,duration:number,now=Date.now()){
 let seconds=serverSeconds;
 try{
  const data=JSON.parse(localStorage.getItem(prefix+sessionId)||'null') as Checkpoint|null;
  if(data&&Number.isFinite(data.seconds)&&data.seconds>=0&&Number.isFinite(data.updatedAt)&&now-data.updatedAt>=0&&now-data.updatedAt<lifetime)seconds=Math.max(seconds,data.seconds);
 }catch{/* Storage may be disabled, full, or unavailable in private browsing. */}
 return boundedPosition(seconds,duration);
}
export function savePosition(sessionId:string,seconds:number,now=Date.now()){
 if(!Number.isFinite(seconds)||seconds<0)return false;
 try{localStorage.setItem(prefix+sessionId,JSON.stringify({seconds:Math.min(seconds,14400),updatedAt:now}));return true;}catch{return false;}
}
export function clearPosition(sessionId:string){try{localStorage.removeItem(prefix+sessionId);}catch{/* Optional local recovery. */}}
export function seekToPosition(video:Pick<HTMLVideoElement,'currentTime'|'duration'>,seconds:number){
 const target=boundedPosition(seconds,video.duration);
 try{video.currentTime=target;return true;}catch{return false;}
}
