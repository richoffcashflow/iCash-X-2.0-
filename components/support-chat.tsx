'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowLeft,ArrowUp,LifeBuoy,MoreHorizontal,X} from 'lucide-react';
import '@/app/membership.css';
import {AccountAccess} from '@/components/account-access';
import {supportRequest,supportReplyWaitMs,supportTransport,type SupportTransport} from '@/lib/support-client';
import '@/app/support/support.css';
import '@/app/support/self-service.css';
import '@/app/support/chat.css';
type Message={id:string;role:string;content:string;created_at:string};
type Thread={id:string;subject:string;status:string};
type Cancellation={id:string;source:string;state:string;result:string|null};
type History={threads:Thread[];messages:Message[];threadId:string|null;cancellations:Cancellation[];error?:string};
type Mutation={threadId?:string;pending?:boolean;escalated?:boolean;error?:string;token?:string;summary?:string;confirmed?:boolean;message?:string};
export function SupportChat({onClose,active=true,onMembershipChanged,transport=supportTransport,initialDraft=''}:{onClose?:()=>void;active?:boolean;onMembershipChanged?:(stopped?:boolean)=>void|Promise<unknown>;transport?:SupportTransport;initialDraft?:string}){
 const [threads,setThreads]=useState<Thread[]>([]),[messages,setMessages]=useState<Message[]>([]),[thread,setThread]=useState<string|null>(null);
 const [draft,setDraft]=useState(initialDraft),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[needsSignIn,setNeedsSignIn]=useState(false);
 const [cancellations,setCancellations]=useState<Cancellation[]>([]),[confirmation,setConfirmation]=useState<{token:string;summary:string}|null>(null),[ack,setAck]=useState(false),[notice,setNotice]=useState('');
 const request=useRef<{id:string;text:string;threadId:string|null}|null>(null),operation=useRef(false);
 const confirmationHeading=useRef<HTMLHeadingElement>(null);
 const historyLog=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null),readSequence=useRef(0);
 const nearLatest=useRef(true),reading=useRef(false),currentThread=useRef(thread);currentThread.current=thread;
 const [showLatest,setShowLatest]=useState(false);
 const [sendingText,setSendingText]=useState(''),[replyPhase,setReplyPhase]=useState<'reading'|'typing'|'checking'|null>(null);
 const savedMessages=useRef(messages);savedMessages.current=messages;
 const clearAccount=useCallback(()=>{setNeedsSignIn(true);setThreads([]);setMessages([]);setThread(null);setCancellations([]);setConfirmation(null);setAck(false);setDraft('');setNotice('');setError('');setSendingText('');setReplyPhase(null);request.current=null;},[]);
 const load=useCallback(async(id?:string,background=false,replyStarted?:number)=>{
  if(background&&reading.current)return;reading.current=true;
  const sequence=++readSequence.current;if(!background&&replyStarted===undefined)setLoading(true);
  try{
   const r=await supportRequest<History>('/api/support'+(id?'?threadId='+encodeURIComponent(id):''),{cache:'no-store'},transport,15000);const d=r.data;
   if(sequence!==readSequence.current)return;
   if(r.status===401){clearAccount();return 'signed_out';}
   if(!r.ok)throw Error(d.error||'Could not load support.');
   if(!Array.isArray(d.threads)||!Array.isArray(d.messages)||!Array.isArray(d.cancellations))throw Error('Could not read your conversation. Please refresh.');
   if(replyStarted!==undefined){
    const known=new Set(savedMessages.current.map(message=>message.id));
    const fresh=d.messages.filter(message=>message.role==='assistant'&&!known.has(message.id));
    const wait=supportReplyWaitMs(fresh.map(message=>message.content).join(' '),Date.now()-replyStarted);
    if(fresh.length&&wait>0){
     setSendingText('');setMessages(d.messages.filter(message=>!fresh.includes(message)));
     await new Promise(resolve=>setTimeout(resolve,wait));
     if(sequence!==readSequence.current)return;
    }
   }
   setNeedsSignIn(false);setThreads(d.threads);setMessages(d.messages);setThread(d.threadId);setCancellations(d.cancellations);setError('');
   return 'loaded';
  }catch(e){if(sequence===readSequence.current){setError(e instanceof Error?e.message:'Could not load support.');}}
  finally{if(sequence===readSequence.current){reading.current=false;setLoading(false);}}
 },[clearAccount,transport]);
 // Hiding the mounted panel must not discard an in-flight reply. Unmounting does.
 useEffect(()=>()=>{readSequence.current++;reading.current=false;},[]);
 useEffect(()=>{if(!active)return;if(!operation.current)void load(currentThread.current??undefined);return()=>{if(!operation.current){readSequence.current++;reading.current=false;}};},[load,active]);
 useEffect(()=>{if(!active)return;const refresh=()=>{if(!document.hidden&&!operation.current)void load(thread??undefined,true);};const timer=setInterval(refresh,20000);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[active,thread,load]);
 useEffect(()=>{if(confirmation)confirmationHeading.current?.focus();},[confirmation]);
 // Follow new replies only when the reader is already at the latest message.
 useEffect(()=>{const log=historyLog.current;if(log&&nearLatest.current)log.scrollTop=log.scrollHeight;},[messages,sendingText,replyPhase]);
 useEffect(()=>{const input=composer.current;if(input){input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,128)}px`;}},[draft]);
 function latest(){nearLatest.current=true;setShowLatest(false);const log=historyLog.current;if(log)log.scrollTop=log.scrollHeight;}
 function chooseConversation(id:string){if(draft.trim()){setNotice('Send or clear your draft before switching conversations.');composer.current?.focus();return;}request.current=null;setConfirmation(null);setAck(false);nearLatest.current=true;void load(id);}
 function startOperation(){if(operation.current)return false;operation.current=true;readSequence.current++;reading.current=false;setBusy(true);setError('');setNotice('');return true;}
 function finishOperation(){operation.current=false;setBusy(false);setSendingText('');setReplyPhase(null);}
 function usePrompt(text:string){if(operation.current)return false;if(draft.trim()){setNotice('You have an unsent message. Send it or clear it before choosing another question.');composer.current?.focus();return false;}setDraft(text);composer.current?.focus();return true;}
 async function send(e:Pick<React.FormEvent,'preventDefault'>,toTeam=false){
  e.preventDefault();if(!draft.trim()||loading||!startOperation())return;
  const text=draft.trim();
  if(!request.current||request.current.text!==text)request.current={id:crypto.randomUUID(),text,threadId:thread};
  const started=Date.now();nearLatest.current=true;setSendingText(text);if(!toTeam)setReplyPhase('reading');
  const typingTimer=setTimeout(()=>{if(!toTeam)setReplyPhase('typing');},600);
  const slowTimer=setTimeout(()=>{if(!toTeam)setReplyPhase('checking');},8000);
  try{
   const r=await supportRequest<Mutation>('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:request.current.id,...(request.current.threadId?{threadId:request.current.threadId}:{}),message:text})},transport);const d=r.data;
   if(r.status===401){clearAccount();return;}
   if(!r.ok||!d.threadId)throw Error(d.error||'Could not confirm your message was saved. Your draft is still here.');
   setDraft('');request.current=null;setThread(d.threadId);nearLatest.current=true;
   if(toTeam){const response=await supportRequest<Mutation>('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'escalate',threadId:d.threadId})},transport);const result=response.data;if(response.status===401){clearAccount();return;}if(!response.ok||result.escalated!==true){await load(d.threadId);throw Error('Your message is saved. The team request was not confirmed. Choose Ask the team to retry.');}}
   const refreshed=await load(d.threadId,false,toTeam?undefined:started);
   if(refreshed!=='loaded'&&refreshed!=='signed_out')setNotice('Your message is saved. Refresh the conversation to see the reply.');
   if(toTeam&&refreshed!=='signed_out')setNotice('Sent to the team. Their reply will appear here.');
   if(d.pending&&!toTeam&&refreshed!=='signed_out')setNotice('Your message is saved. A reply is still pending.');
  }catch(e){setError(e instanceof Error?e.message:'Could not send. Your draft is still here.');}
  finally{clearTimeout(typingTimer);clearTimeout(slowTimer);finishOperation();}
 }
 async function escalate(){
  if(draft.trim()){await send({preventDefault(){}},true);return;}
  if(!thread){usePrompt('I need help with ');setNotice('Describe the issue, then choose “Send to team”.');return;}
  if(loading||!startOperation())return;
  try{
   const r=await supportRequest<Mutation>('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'escalate',threadId:thread})},transport);const d=r.data;
   if(r.status===401){clearAccount();return;}
   if(!r.ok||d.escalated!==true)throw Error(d.error||'Could not confirm the support request. Refresh its status before retrying.');
   if(await load(thread)==='signed_out')return;setNotice('Sent to the team. Their reply will appear here.');
  }catch(e){setError(e instanceof Error?e.message:'Could not send to the team.');}
  finally{finishOperation();}
 }
 async function cancel(action:'prepare'|'confirm',requestId?:string){
  if(loading||(action==='confirm'&&(!confirmation||!ack))||!startOperation())return;
  try{
   const r=await supportRequest<Mutation>('/api/support/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='prepare'?{action,...(requestId?{requestId}:{})}:{action,token:confirmation?.token,acknowledged:ack})},transport);const d=r.data;
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
 const statusLabel=currentStatus==='escalated'?'Sent to the team':currentStatus==='waiting_on_customer'?'Your reply is needed':currentStatus==='resolved'?'Resolved':'Ask us anything';
 const exit=onClose?<button className="support-close" aria-label="Close support" onClick={onClose} type="button"><X size={20}/></button>:<a className="support-back" href="/" aria-label="Back to workspace"><ArrowLeft size={18}/><span>Workspace</span></a>;
 if(needsSignIn)return <section className="support-shell support-chat support-sign-in"><header className="support-heading"><div><p className="support-eyebrow">iCash X</p><h1>Let’s get you some help</h1></div>{exit}</header><div className="support-sign-in-body"><div className="support-welcome-icon"><LifeBuoy size={25}/></div><p>Sign in so we can check only your account. Use your account or payment email.</p><AccountAccess onSignedIn={()=>void load()}/><small>Already paid? Your payment is saved. You don’t need to pay again.</small></div></section>;
 return <section className="support-shell support-chat" aria-label="Support conversation">
  <header className="support-heading"><div className="support-title"><span className="support-avatar support-james-avatar" aria-hidden="true">J</span><div><h1>James <span className="support-ai-label">AI Support</span></h1><p className="support-status">{statusLabel}</p></div></div>{exit}</header>
  <details className="support-options"><summary aria-label="Chat options"><MoreHorizontal size={20}/></summary><div><button type="button" disabled={busy||loading} onClick={()=>void load(thread??undefined)}>Refresh conversation</button><button type="button" disabled={busy||loading} onClick={()=>void cancel('prepare')}>Manage cancellation</button>{threads.length>1&&<label>Past conversations<select value={thread??''} disabled={busy||loading} onChange={e=>chooseConversation(e.target.value)}>{threads.map(t=><option value={t.id} key={t.id}>{t.subject.slice(0,50)}</option>)}</select></label>}{cancellations.length>0&&<details className="support-cancellation-history"><summary>Cancellation requests</summary>{cancellations.map(c=><div className="support-notice" key={c.id}><p>{c.state==='awaiting_confirmation'?`${c.source==='email'?'Email cancellation request received. ':''}Awaiting your confirmation. This request has not changed your bot or renewals.`:c.state==='cancelled'?`Cancellation confirmed when this request was completed. ${c.result??'Refresh account checks for the current state.'}`:c.result??'Your confirmed cancellation is still being checked.'}</p>{!['processing','cancelled'].includes(c.state)&&<button disabled={busy||loading} onClick={()=>void cancel('prepare',c.id)}>Review this request</button>}</div>)}</details>}</div></details>
  <div className="support-chat-alerts">
   {error&&<p className="support-error" role="alert">{error} <button type="button" disabled={busy||loading} onClick={()=>void load(thread??undefined)}>Refresh status</button></p>}{notice&&<p className="support-notice" role="status">{notice}</p>}

   {confirmation&&<section className="support-confirm" aria-labelledby="support-cancel-heading"><h2 ref={confirmationHeading} tabIndex={-1} id="support-cancel-heading">Stop future work and renewals?</h2><p>{confirmation.summary}</p><label><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/> I want to pause my bot and stop future subscription renewals</label><div><button disabled={busy} onClick={()=>{setConfirmation(null);setAck(false);}}>Keep my current settings</button><button className="support-primary" disabled={busy||loading||!ack} onClick={()=>void cancel('confirm')}>Confirm cancellation</button></div><small>This confirmation expires in 10 minutes. Messages alone do not cancel anything.</small></section>}
  </div>
  <section className="support-conversation-section" aria-label="Messages">
   <div ref={historyLog} className="support-messages" role="log" aria-label="Support messages" aria-live="polite" aria-busy={busy||loading} onScroll={()=>{const log=historyLog.current;if(log){nearLatest.current=log.scrollHeight-log.clientHeight-log.scrollTop<72;setShowLatest(!nearLatest.current);}}}>
    {loading&&!messages.length?<p className="support-loading" role="status">Opening your conversation…</p>:!messages.length&&!sendingText?<div className="support-empty"><div className="support-welcome-icon support-james-avatar" aria-hidden="true">J</div><h2>Hey, I’m James.</h2><p>Your iCash X AI support assistant.<br/>How can I help?</p></div>:messages.map(m=><article key={m.id} className={`support-message support-message-${m.role}`}><strong>{m.role==='user'?'You':m.role==='operator'?'Support team':m.role==='system'?'Update':'James · AI Support'}</strong><p>{m.content}</p></article>)}
    {sendingText&&<article className="support-message support-message-user support-message-pending"><strong>You · Sending</strong><p>{sendingText}</p></article>}
    {busy&&<div className="support-working" role="status"><span className="support-typing-dots" aria-hidden="true"><i/><i/><i/></span>{replyPhase==='reading'?'James is reading your message…':replyPhase==='typing'?'James is typing…':replyPhase==='checking'?'Still checking your account…':'Updating your conversation…'}</div>}
   </div>
   {showLatest&&<button className="support-latest" type="button" onClick={latest}><ArrowDown size={14}/>Back to latest</button>}
  </section>
  <div className="support-compose-dock">
   <form onSubmit={send} className="support-composer" data-unsaved-draft={draft.trim()?'true':undefined}><label htmlFor="support-message" className="sr-only">Your message</label><div className="support-input-row"><textarea ref={composer} id="support-message" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&window.matchMedia('(pointer: fine)').matches){e.preventDefault();void send(e);}}} maxLength={2000} rows={1} placeholder="Message James…" disabled={busy}/><button type="submit" className="support-primary support-send" aria-label={busy?'Sending message':'Send message'} disabled={busy||loading||!draft.trim()}><ArrowUp size={20}/></button></div><small>James is an AI assistant. You can ask the team for help anytime.</small></form>
   <div className="support-actions"><button type="button" disabled={busy||loading} onClick={()=>void escalate()}>{draft.trim()?'Send to team':'Ask the team'}</button></div>
  </div>
 </section>;
}
