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
 const phone=item.recipient.replace(/^\+1(\d{3})(\d{3})(\d{4})$/,'($1) $2-$3');
 return <article className="sms-review-card"><p className="sms-review-explanation">{item.needs_review?'This phone number is on more than one lead. The bot couldn’t tell which property this reply was about.':'The sender later confirmed the property, but this earlier reply wasn’t linked to one.'}</p><blockquote className="reply-quote"><span className="sms-review-sender">Reply from {phone}</span>{item.body||'Attachment-only message'}</blockquote>
  {item.attachments?.map((attachment,index)=>{
   let safe=false;try{const url=new URL(attachment.url);safe=url.protocol==='https:'&&url.hostname==='api.contiguity.com'&&url.pathname.startsWith('/attachments/')&&!url.username&&!url.password;}catch{}
   return safe?<p key={index}><a href={attachment.url} target="_blank" rel="noopener noreferrer">View attachment {index+1}</a></p>:<p key={index}>Attachment held for review. Check the original attachment before releasing this hold.</p>;
  })}
  {item.candidates.length>0&&<div className="sms-review-conversations"><span>Check the property conversations</span><ul>{item.candidates.map(c=><li key={c.threadId}><button type="button" onClick={()=>onOpen(c.screeningId)}><span>{c.address||'Property conversation'}</span><span className="sms-review-view">View</span></button></li>)}</ul></div>}
  {item.needs_review&&<p className="sms-review-hold">New texts to this number are on hold until these replies are reviewed.</p>}
  <p className="sms-review-next">{item.candidates.length?'Read the reply and check the conversations above. When you’re finished, tap Done reviewing.':'Read the reply, then tap Done reviewing when you’re finished.'}</p>
  <div className="sms-review-actions"><button type="button" disabled={busy} onClick={()=>void reviewed()}>{busy?'Saving…':'Done reviewing'}</button><small>Clears this notice without sending a reply.</small></div>{error&&<p role="alert">{error}</p>}
 </article>;
}
