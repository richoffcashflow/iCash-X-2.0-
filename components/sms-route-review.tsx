'use client';
import {useRef,useState} from 'react';
export type SmsRouteReview={message_id:string;recipient:string;body:string;attachments?:{url:string;filename?:string}[];created_at:string;revision:number;needs_review:boolean;candidates:{threadId:string;screeningId:string;address:string|null}[]};
export function SmsRouteReviewCard({item,onHandled,onOpen}:{item:SmsRouteReview;onHandled:()=>void;onOpen:(id:string)=>void}){
 const pending=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function reviewed(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{
   const response=await fetch('/api/work/sms-route-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:item.message_id,revision:item.revision})});
   const result=await response.json();if(!response.ok||result.saved!==true)throw Error(result.error||'Could not save. Refresh and try again.');onHandled();
  }catch(e){setError(e instanceof Error?e.message:'Could not save. Refresh and try again.');}
  finally{pending.current=false;setBusy(false);}
 }
 return <article><p>A message from {item.recipient} could refer to more than one property.</p><blockquote className="reply-quote">{item.body||'Attachment-only message'}</blockquote>
  {item.attachments?.map((attachment,index)=>{
   let safe=false;try{const url=new URL(attachment.url);safe=url.protocol==='https:'&&url.hostname==='api.contiguity.com'&&url.pathname.startsWith('/attachments/')&&!url.username&&!url.password;}catch{}
   return safe?<p key={index}><a href={attachment.url} target="_blank" rel="noopener noreferrer">View attachment {index+1}</a></p>:<p key={index}>Attachment held for review. Check the original attachment before releasing this hold.</p>;
  })}
  <p>This message is saved without a property assignment. Review the conversations below before preparing any reply.</p>
  <ul>{item.candidates.map(c=><li key={c.threadId}><button type="button" onClick={()=>onOpen(c.screeningId)}>{c.address||'Open property conversation'}</button></li>)}</ul>
  <p>{item.needs_review?'New outgoing texts to this number are on hold until every unresolved message is reviewed.':'The sender has since identified a property. Review this earlier message separately.'}</p>
  <button type="button" disabled={busy} onClick={()=>void reviewed()}>{busy?'Saving…':'Reviewed, allow new replies'}</button>
  <small>Reviewing sends nothing, does not assign these words to a property, and keeps existing manual controls and opt-outs in place.</small>{error&&<p role="alert">{error}</p>}
 </article>;
}
