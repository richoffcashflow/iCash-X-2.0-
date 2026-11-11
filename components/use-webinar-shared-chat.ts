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
  let disposed=false,busy=false,denied=false;const controller=new AbortController();
  async function load(){
   if(disposed||busy||denied||document.hidden)return;busy=true;
   try{
    const seconds=Number.isFinite(position.current)?Math.max(0,Math.min(14400,Math.floor(position.current))):0;
    const data=await webinarRequest<ChatFeed>('/api/webinar/chat/feed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,seconds}),signal:controller.signal},10000);
    if(disposed||!Array.isArray(data.messages)||!Array.isArray(data.statuses))return;
    const messages=data.messages.filter(m=>m&&typeof m.id==='string'&&typeof m.text==='string'&&m.public_status==='approved'&&typeof m.playback_seconds==='number'&&Number.isInteger(m.playback_seconds)&&m.playback_seconds>=0&&m.playback_seconds<=14400).map(m=>({...m,shared:true}));
    setFeed({messages,statuses:data.statuses});
   }catch(e){const status=(e as {status?:number}).status;if(status===401||status===403||status===404)denied=true;}
   finally{busy=false;}
  }
  void load();const timer=setInterval(()=>void load(),5000);const visible=()=>void load();document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[sessionId,position]);
 return feed;
}
