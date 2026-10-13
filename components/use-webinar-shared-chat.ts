'use client';
import {useEffect,useState,type RefObject} from 'react';
import {webinarRequest} from '@/lib/webinar-client';
import type {WebinarMessage} from '@/lib/webinar-chat-stream';
import type {ChatModeration} from '@/lib/webinar-shared-chat';
type ChatFeed={messages:WebinarMessage[];statuses:{id:string;public_status:ChatModeration}[]};
export function useWebinarSharedChat(sessionId:string|undefined,position:RefObject<number>){
 const [feed,setFeed]=useState<ChatFeed>({messages:[],statuses:[]});
 useEffect(()=>{
  setFeed({messages:[],statuses:[]});if(!sessionId)return;
  let disposed=false,busy=false,denied=false;const controller=new AbortController(),positions=new Map<string,number>();
  async function load(){
   if(disposed||busy||denied||document.hidden)return;busy=true;
   try{
    const data=await webinarRequest<ChatFeed>('/api/webinar/chat/feed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId}),signal:controller.signal},10000);
    if(disposed||!Array.isArray(data.messages)||!Array.isArray(data.statuses))return;
    const messages=data.messages.filter(m=>m&&typeof m.id==='string'&&typeof m.text==='string'&&m.public_status==='approved').map(m=>{
     // Approved comments join this viewer's feed when received, even if their video is at a different point.
     if(!positions.has(m.id))positions.set(m.id,Math.floor(position.current));
     return {...m,shared:true,playback_seconds:positions.get(m.id)!};
    });
    setFeed({messages,statuses:data.statuses});
   }catch(e){const status=(e as {status?:number}).status;if(status===401||status===403||status===404)denied=true;}
   finally{busy=false;}
  }
  void load();const timer=setInterval(()=>void load(),5000);const visible=()=>void load();document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[sessionId,position]);
 return feed;
}
