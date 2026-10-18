'use client';
import {supportRequest} from '@/lib/support-client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowLeft,ArrowUp,LifeBuoy,MoreHorizontal,X} from 'lucide-react';
import '@/app/membership.css';
import {AccountAccess} from '@/components/account-access';
import '@/app/support/support.css';
import '@/app/support/self-service.css';
import '@/app/support/chat.css';
type Message={id:string;role:string;content:string;created_at:string};
type Thread={id:string;subject:string;status:string};
type Cancellation={id:string;source:string;state:string;result:string|null};
export function SupportChat({onClose,active=true,onMembershipChanged,initialThreadId}:{initialThreadId?:string;onClose?:()=>void;active?:boolean;onMembershipChanged?:(stopped?:boolean)=>void|Promise<unknown>}){
 const [threads,setThreads]=useState<Thread[]>([]),[messages,setMessages]=useState<Message[]>([]),[thread,setThread]=useState<string|null>(initialThreadId??null);
 const [draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[needsSignIn,setNeedsSignIn]=useState(false);
 const [cancellations,setCancellations]=useState<Cancellation[]>([]),[confirmation,setConfirmation]=useState<{token:string;summary:string}|null>(null),[ack,setAck]=useState(false),[notice,setNotice]=useState('');
 const request=useRef<{id:string;text:string;threadId:string|null}|null>(null),operation=useRef(false);
 const confirmationHeading=useRef<HTMLHeadingElement>(null);
 const historyLog=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null),readSequence=useRef(0);
 const nearLatest=useRef(true),reading=useRef(false),currentThread=useRef(thread);currentThread.current=thread;
 const [showLatest,setShowLatest]=useState(false);
 const clearAccount=useCallback(()=>{setNeedsSignIn(true);setThreads([]);setMessages([]);setThread(null);setCancellations([]);setConfirmation(null);setAck(false);setDraft('');setNotice('');setError('');request.current=null;},[]);
 const load=useCallback(async(id?:string,background=false)=>{
  if(background&&reading.current)return;reading.current=true;
  const sequence=++readSequence.current;if(!background)setLoading(true);
  try{
   const {data:d,...r}=await supportRequest<{error?:string;threads:Thread[];messages:Message[];threadId:string|null;cancellations:Cancellation[]}>('/api/support'+(id?'?threadId='+encodeURIComponent(id):''),{cache:'no-store'},undefined,15000);
   if(sequence!==readSequence.current)return;
   if(r.status===401){clearAccount();return 'signed_out';}
   if(!r.ok)throw Error(d.error||'Could not load support.');
   setNeedsSignIn(false);setThreads(d.threads);setMessages(d.messages);setThread(d.threadId);setCancellations(d.cancellations);setError('');
  }catch(e){if(sequence===readSequence.current){setError(e instanceof Error?e.message:'Could not load support.');}}
  finally{if(sequence===readSequence.current){reading.current=false;setLoading(false);}}
 },[clearAccount]);
 useEffect(()=>{if(!active)return;void load(currentThread.current??initialThreadId);return()=>{readSequence.current++;reading.current=false;};},[load,active,initialThreadId]);
 useEffect(()=>{if(!active)return;const refresh=()=>{if(!document.hidden&&!operation.current)void load(thread??initialThreadId,true);};const timer=setInterval(refresh,20000);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[active,thread,initialThreadId,load]);
 useEffect(()=>{if(confirmation)confirmationHeading.current?.focus();},[confirmation]);
 // Follow new replies only when the reader is already at the latest message.
 useEffect(()=>{const log=historyLog.current;if(log&&nearLatest.current)log.scrollTop=log.scrollHeight;},[messages]);
 useEffect(()=>{const input=composer.current;if(input){input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,128)}px`;}},[draft]);
 function latest(){nearLatest.current=true;setShowLatest(false);const log=historyLog.current;if(log)log.scrollTop=log.scrollHeight;}
 function chooseConversation(id:string){if(draft.trim()){setNotice('Send or clear your draft before switching conversations.');composer.current?.focus();return;}request.current=null;setConfirmation(null);setAck(false);nearLatest.current=true;void load(id);}
 function startOperation(){if(operation.current)return false;operation.current=true;setBusy(true);setError('');setNotice('');return true;}
 function finishOperation(){operation.current=false;setBusy(false);}
 async function send(e:Pick<React.FormEvent,'preventDefault'>){
  e.preventDefault();if(!draft.trim()||loading||!startOperation())return;
  const text=draft.trim();
  if(!request.current||request.current.text!==text)request.current={id:crypto.randomUUID(),text,threadId:thread};
  try{
   const {data:d,...r}=await supportRequest<{error?:string;threadId?:string;pending?:boolean}>('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:request.current.id,...(request.current.threadId?{threadId:request.current.threadId}:{}),message:text})});
   if(r.status===401){clearAccount();return;}
   if(!r.ok||!d.threadId)throw Error(d.error||'Could not confirm your message was saved. Your draft is still here.');
   setDraft('');request.current=null;setThread(d.threadId);nearLatest.current=true;
   const refreshed=await load(d.threadId);
   if(d.pending&&refreshed!=='signed_out')setNotice('Your message is saved. A reply is still pending.');
  }catch(e){setError(e instanceof Error?e.message:'Could not send. Your draft is still here.');}
  finally{finishOperation();}
 }
 async function cancel(action:'prepare'|'confirm',requestId?:string){
  if(loading||(action==='confirm'&&(!confirmation||!ack))||!startOperation())return;
  try{
   const {data:d,...r}=await supportRequest<{error?:string;token?:string;summary?:string;confirmed?:boolean;message?:string}>('/api/support/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='prepare'?{action,...(requestId?{requestId}:{})}:{action,token:confirmation?.token,acknowledged:ack})});
   if(r.status===401){clearAccount();return;}
   if(!r.ok)throw Error(d.error||'Could not confirm cancellation. Refresh its status before retrying.');
   if(action==='prepare'){
    if(typeof d.token!=='string'||typeof d.summary!=='string')throw Error('Could not prepare cancellation. Nothing was confirmed.');
    setConfirmation({token:d.token,summary:d.summary});setAck(false);
   }else{
    if(typeof d.confirmed!=='boolean'||typeof d.message!=='string')throw Error('Cancellation outcome is unknown. Refresh its status before retrying.');
    setConfirmation(null);setAck(false);if(await load(thread??undefined)==='signed_out')return;setNotice(d.message);
   }
  }catch(e){setError(e instanceof Error?e.message:'Could not confirm cancellation.');}
  finally{finishOperation();}
 }
 const currentStatus=threads.find(item=>item.id===thread)?.status;
 const statusLabel=currentStatus==='escalated'||currentStatus==='open'?'Troubleshooting here':currentStatus==='waiting_on_customer'?'Your reply is needed':currentStatus==='resolved'?'Resolved · Reply to reopen':'Ask us anything';
 const exit=onClose?<button className="support-close" aria-label="Close support" onClick={onClose} type="button"><X size={20}/></button>:<a className="support-back" href="/" aria-label="Back to workspace"><ArrowLeft size={18}/><span>Workspace</span></a>;
 if(needsSignIn)return <section className="support-shell support-chat support-sign-in"><header className="support-heading"><div><p className="support-eyebrow">iCash X</p><h1>Let’s get you some help</h1></div>{exit}</header><div className="support-sign-in-body"><div className="support-welcome-icon"><LifeBuoy size={25}/></div><p><a href="/access/help">Can’t sign in? Contact support without signing in.</a></p><p>Sign in to review your account and earlier conversations.</p><AccountAccess onSignedIn={()=>void load(initialThreadId)}/><small>Already paid? Your payment is saved. You don’t need to pay again.</small></div></section>;
 return <section className="support-shell support-chat" aria-label="Support conversation">
  <header className="support-heading"><div className="support-title"><span className="support-avatar" aria-hidden="true"><LifeBuoy size={22}/></span><div><h1>Support</h1><p className="support-status">{statusLabel}</p></div></div>{exit}</header>
  <details className="support-options"><summary aria-label="Chat options"><MoreHorizontal size={20}/></summary><div><button type="button" disabled={busy||loading} onClick={()=>void load(thread??undefined)}>Refresh conversation</button>{threads.length>1&&<label>Past conversations<select value={thread??''} disabled={busy||loading} onChange={e=>chooseConversation(e.target.value)}>{threads.map(t=><option value={t.id} key={t.id}>{t.subject.slice(0,50)}</option>)}</select></label>}{cancellations.length>0&&<details className="support-cancellation-history"><summary>Cancellation requests</summary>{cancellations.map(c=><div className="support-notice" key={c.id}><p>{c.state==='awaiting_confirmation'?`${c.source==='email'?'Email cancellation request received. ':''}Awaiting your confirmation. This request has not changed your bot or renewals.`:c.state==='cancelled'?`Cancellation confirmed when this request was completed. ${c.result??'Refresh account checks for the current state.'}`:c.result??'Your confirmed cancellation is still being checked.'}</p>{!['processing','cancelled'].includes(c.state)&&<button disabled={busy||loading} onClick={()=>void cancel('prepare',c.id)}>Review this request</button>}</div>)}</details>}</div></details>
  <div className="support-chat-alerts">
   {error&&<p className="support-error" role="alert">{error} <button type="button" disabled={busy||loading} onClick={()=>void load(thread??undefined)}>Refresh status</button></p>}{notice&&<p className="support-notice" role="status">{notice}</p>}

   {confirmation&&<section className="support-confirm" aria-labelledby="support-cancel-heading"><h2 ref={confirmationHeading} tabIndex={-1} id="support-cancel-heading">Stop future work and renewals?</h2><p>{confirmation.summary}</p><label><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/> I want to pause my bot and stop future subscription renewals</label><div><button disabled={busy} onClick={()=>{setConfirmation(null);setAck(false);}}>Keep my current settings</button><button className="support-primary" disabled={busy||loading||!ack} onClick={()=>void cancel('confirm')}>Confirm cancellation</button></div><small>This confirmation expires in 10 minutes. Messages alone do not cancel anything.</small></section>}
  </div>
  <section className="support-conversation-section" aria-label="Messages">
   <div ref={historyLog} className="support-messages" role="log" aria-label="Support messages" aria-live="polite" aria-busy={busy||loading} onScroll={()=>{const log=historyLog.current;if(log){nearLatest.current=log.scrollHeight-log.clientHeight-log.scrollTop<72;setShowLatest(!nearLatest.current);}}}>
    {loading&&!messages.length?<p className="support-loading" role="status">Opening your conversation…</p>:!messages.length?<div className="support-empty"><div className="support-welcome-icon"><LifeBuoy size={25}/></div><h2>How can we help?</h2><p>Send a message below.</p></div>:messages.map(m=><article key={m.id} className={`support-message support-message-${m.role}`}><strong>{m.role==='user'?'You':m.role==='system'?'Update':'Support'}</strong><p>{m.content}</p></article>)}
    {busy&&<div className="support-working" role="status"><span aria-hidden="true">•••</span> Replying…</div>}
   </div>
   {showLatest&&<button className="support-latest" type="button" onClick={latest}><ArrowDown size={14}/>Back to latest</button>}
  </section>
  <div className="support-compose-dock">
   <form onSubmit={send} className="support-composer" data-unsaved-draft={draft.trim()?'true':undefined}><label htmlFor="support-message" className="sr-only">Your message</label><div className="support-input-row"><textarea ref={composer} id="support-message" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&window.matchMedia('(pointer: fine)').matches){e.preventDefault();void send(e);}}} maxLength={2000} rows={1} placeholder="Message support…" disabled={busy}/><button type="submit" className="support-primary support-send" aria-label={busy?'Sending message':'Send message'} disabled={busy||loading||!draft.trim()}><ArrowUp size={20}/></button></div></form>

  </div>
 </section>;
}
