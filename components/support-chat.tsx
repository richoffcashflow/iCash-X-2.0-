'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowLeft,ArrowUp,ChevronDown,LifeBuoy,RefreshCw,X} from 'lucide-react';
import {AccountAccess} from '@/components/account-access';
import {SupportAccountChecks} from '@/components/support-account-checks';
import {supportCheckLabels,supportCheckTime,supportPrompts} from '@/lib/support-self-service';
import type {SupportEvidence} from '@/lib/support-policy';
import '@/app/support/support.css';
import '@/app/support/self-service.css';
import '@/app/support/chat.css';
type Message={id:string;role:string;content:string;evidence:SupportEvidence[];created_at:string};
type Thread={id:string;subject:string;status:string};
type Cancellation={id:string;source:string;state:string;result:string|null};
export function SupportChat({onClose,active=true}:{onClose?:()=>void;active?:boolean}){
 const [threads,setThreads]=useState<Thread[]>([]),[messages,setMessages]=useState<Message[]>([]),[thread,setThread]=useState<string|null>(null);
 const [draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[needsSignIn,setNeedsSignIn]=useState(false);
 const [evidence,setEvidence]=useState<SupportEvidence[]>([]);
 const [cancellations,setCancellations]=useState<Cancellation[]>([]),[confirmation,setConfirmation]=useState<{token:string;summary:string}|null>(null),[ack,setAck]=useState(false),[notice,setNotice]=useState('');
 const request=useRef<{id:string;text:string;threadId:string|null}|null>(null),operation=useRef(false);
 const confirmationHeading=useRef<HTMLHeadingElement>(null);
 const historyLog=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null),readSequence=useRef(0);
 const nearLatest=useRef(true),reading=useRef(false),currentThread=useRef(thread);currentThread.current=thread;
 const [showLatest,setShowLatest]=useState(false);
 const clearAccount=useCallback(()=>{setNeedsSignIn(true);setThreads([]);setMessages([]);setThread(null);setEvidence([]);setCancellations([]);setConfirmation(null);setAck(false);setDraft('');setNotice('');setError('');request.current=null;},[]);
 const load=useCallback(async(id?:string,background=false)=>{
  if(background&&reading.current)return;reading.current=true;
  const sequence=++readSequence.current;if(!background)setLoading(true);
  try{
   const r=await fetch('/api/support'+(id?'?threadId='+encodeURIComponent(id):''),{cache:'no-store'});const d=await r.json();
   if(sequence!==readSequence.current)return;
   if(r.status===401){clearAccount();return 'signed_out';}
   if(!r.ok)throw Error(d.error||'Could not load support.');
   setNeedsSignIn(false);setThreads(d.threads);setMessages(d.messages);setThread(d.threadId);setCancellations(d.cancellations);setEvidence(d.evidence??[]);setError('');
  }catch(e){if(sequence===readSequence.current){setEvidence([]);setError(e instanceof Error?e.message:'Could not load support.');}}
  finally{if(sequence===readSequence.current){reading.current=false;setLoading(false);}}
 },[clearAccount]);
 useEffect(()=>{if(!active)return;void load(currentThread.current??undefined);return()=>{readSequence.current++;reading.current=false;};},[load,active]);
 useEffect(()=>{if(!active)return;const refresh=()=>{if(!document.hidden&&!operation.current)void load(thread??undefined,true);};const timer=setInterval(refresh,20000);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[active,thread,load]);
 useEffect(()=>{if(confirmation)confirmationHeading.current?.focus();},[confirmation]);
 // Follow new replies only when the reader is already at the latest message.
 useEffect(()=>{const log=historyLog.current;if(log&&nearLatest.current)log.scrollTop=log.scrollHeight;},[messages]);
 useEffect(()=>{const input=composer.current;if(input){input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,128)}px`;}},[draft]);
 function latest(){nearLatest.current=true;setShowLatest(false);const log=historyLog.current;if(log)log.scrollTop=log.scrollHeight;}
 function chooseConversation(id:string){if(draft.trim()){setNotice('Send or clear your draft before switching conversations.');composer.current?.focus();return;}request.current=null;setConfirmation(null);setAck(false);nearLatest.current=true;void load(id);}
 function startOperation(){if(operation.current)return false;operation.current=true;setBusy(true);setError('');setNotice('');return true;}
 function finishOperation(){operation.current=false;setBusy(false);}
 function usePrompt(text:string){if(operation.current)return false;if(draft.trim()){setNotice('You have an unsent message. Send it or clear it before choosing another question.');composer.current?.focus();return false;}setDraft(text);composer.current?.focus();return true;}
 function prepareHelp(check:SupportEvidence){if(usePrompt(`I need help with ${supportCheckLabels[check.key]??'my account'}.\nWhat I expected: \nWhat happened instead: \nWhat I already tried: `))setNotice('Add what happened, then send for an answer or choose “Send to team”.');}
 async function send(e:Pick<React.FormEvent,'preventDefault'>,toTeam=false){
  e.preventDefault();if(!draft.trim()||loading||!startOperation())return;
  const text=draft.trim();
  if(!request.current||request.current.text!==text)request.current={id:crypto.randomUUID(),text,threadId:thread};
  try{
   const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:request.current.id,...(request.current.threadId?{threadId:request.current.threadId}:{}),message:text})});const d=await r.json();
   if(r.status===401){clearAccount();return;}
   if(!r.ok||!d.threadId)throw Error(d.error||'Could not confirm your message was saved. Your draft is still here.');
   setDraft('');request.current=null;setThread(d.threadId);nearLatest.current=true;
   if(toTeam){const response=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'escalate',threadId:d.threadId})});const result=await response.json();if(response.status===401){clearAccount();return;}if(!response.ok||result.escalated!==true){await load(d.threadId);throw Error('Your message is saved. The team request was not confirmed. Choose Ask the team to retry.');}}
   const refreshed=await load(d.threadId);
   if(toTeam&&refreshed!=='signed_out')setNotice('Sent this conversation and its saved account checks to the support team. Their reply will appear here.');
   if(d.pending&&!toTeam&&refreshed!=='signed_out')setNotice('Your message is saved, but its reply is not yet confirmed. Refresh the conversation or ask the team; do not send the same message again.');
  }catch(e){setError(e instanceof Error?e.message:'Could not send. Your draft is still here.');}
  finally{finishOperation();}
 }
 async function escalate(){
  if(draft.trim()){await send({preventDefault(){}},true);return;}
  if(!thread){usePrompt('I need the support team to review my account.\nWhat I expected: \nWhat happened instead: \nWhat I already tried: ');setNotice('Describe the issue, then choose “Send to team”. Your account checks are included.');return;}
  if(loading||!startOperation())return;
  try{
   const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'escalate',threadId:thread})});const d=await r.json();
   if(r.status===401){clearAccount();return;}
   if(!r.ok||d.escalated!==true)throw Error(d.error||'Could not confirm the support request. Refresh its status before retrying.');
   if(await load(thread)==='signed_out')return;setNotice('Sent this conversation and its saved account checks to the support team. Their reply will appear here.');
  }catch(e){setError(e instanceof Error?e.message:'Could not send to the team.');}
  finally{finishOperation();}
 }
 async function cancel(action:'prepare'|'confirm',requestId?:string){
  if(loading||(action==='confirm'&&(!confirmation||!ack))||!startOperation())return;
  try{
   const r=await fetch('/api/support/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='prepare'?{action,...(requestId?{requestId}:{})}:{action,token:confirmation?.token,acknowledged:ack})});const d=await r.json();
   if(r.status===401){clearAccount();return;}
   if(!r.ok)throw Error(d.error||'Could not confirm cancellation. Refresh its status before retrying.');
   if(action==='prepare'){
    if(typeof d.token!=='string'||typeof d.summary!=='string')throw Error('Could not prepare cancellation. Nothing was confirmed.');
    setConfirmation(d);setAck(false);
   }else{
    if(typeof d.confirmed!=='boolean'||typeof d.message!=='string')throw Error('Cancellation outcome is unknown. Refresh its status before retrying.');
    setConfirmation(null);setAck(false);if(await load(thread??undefined)==='signed_out')return;setNotice(d.message);
   }
  }catch(e){setError(e instanceof Error?e.message:'Could not confirm cancellation.');}
  finally{finishOperation();}
 }
 const attentionCount=evidence.filter(item=>item.status==='attention').length;
 const currentStatus=threads.find(item=>item.id===thread)?.status;
 const statusLabel=currentStatus==='escalated'?'Sent to the team':currentStatus==='waiting_on_customer'?'Your reply is needed':currentStatus==='resolved'?'Resolved':'Account assistant';
 const prompts=<div className="support-prompts" aria-label="Start a support question">{supportPrompts.map(p=><button type="button" key={p.label} disabled={busy||loading} onClick={()=>usePrompt(p.message)}>{p.label}</button>)}</div>;
 const exit=onClose?<button className="support-close" aria-label="Close support" onClick={onClose} type="button"><X size={20}/></button>:<a className="support-back" href="/" aria-label="Back to workspace"><ArrowLeft size={18}/><span>Workspace</span></a>;
 if(needsSignIn)return <section className="support-shell support-chat support-sign-in"><header className="support-heading"><div><p className="support-eyebrow">iCash X</p><h1>Let’s get you some help</h1></div>{exit}</header><div className="support-sign-in-body"><div className="support-welcome-icon"><LifeBuoy size={25}/></div><p>Sign in so we can check only your account. Use your account or payment email.</p><AccountAccess onSignedIn={()=>void load()}/><small>Already paid? Your payment is saved. You don’t need to pay again.</small></div></section>;
 return <section className="support-shell support-chat" aria-label="Support conversation">
  <header className="support-heading"><div className="support-title"><span className="support-avatar" aria-hidden="true"><LifeBuoy size={22}/></span><div><h1>iCash X support</h1><p className="support-status">{statusLabel}</p></div></div>{exit}</header>
  <div className="support-utilities"><details className="support-account-drawer"><summary>Account checks{attentionCount>0&&<span>{attentionCount} need attention</span>}<ChevronDown size={15} aria-hidden="true"/></summary><div className="support-account-drawer-body"><SupportAccountChecks evidence={evidence} loading={loading} busy={busy} onRefresh={()=>void load(thread??undefined)} onCancel={()=>void cancel('prepare')} onTeam={prepareHelp}/></div></details><button type="button" className="support-refresh" aria-label="Refresh status" title="Refresh conversation and account checks" disabled={busy||loading} onClick={()=>void load(thread??undefined)}><RefreshCw size={16}/></button></div>
  {threads.length>1&&<details className="support-history"><summary>Past conversations</summary><label>Conversation<select value={thread??''} disabled={busy||loading} onChange={e=>chooseConversation(e.target.value)}>{threads.map(t=><option value={t.id} key={t.id}>{t.subject.slice(0,50)} · {t.status.replaceAll('_',' ')}</option>)}</select></label></details>}
  <div className="support-chat-alerts">
   {error&&<p className="support-error" role="alert">{error} <button type="button" disabled={busy||loading} onClick={()=>void load(thread??undefined)}>Refresh status</button></p>}{notice&&<p className="support-notice" role="status">{notice}</p>}
   {cancellations.length>0&&<details className="support-cancellation-history" open={cancellations.some(c=>c.state!=='cancelled')}><summary>Cancellation requests</summary>{cancellations.map(c=><div className="support-notice" key={c.id}><p>{c.state==='awaiting_confirmation'?`${c.source==='email'?'Email cancellation request received. ':''}Awaiting your confirmation. This request has not changed your bot or renewals.`:c.state==='cancelled'?`Cancellation confirmed when this request was completed. ${c.result??'Refresh account checks for the current state.'}`:c.result??'Your confirmed cancellation is still being checked.'}</p>{!['processing','cancelled'].includes(c.state)&&<button disabled={busy||loading} onClick={()=>void cancel('prepare',c.id)}>Review this request</button>}</div>)}</details>}
   {confirmation&&<section className="support-confirm" aria-labelledby="support-cancel-heading"><h2 ref={confirmationHeading} tabIndex={-1} id="support-cancel-heading">Stop future work and renewals?</h2><p>{confirmation.summary}</p><label><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/> I want to pause my bot and stop future subscription renewals</label><div><button disabled={busy} onClick={()=>{setConfirmation(null);setAck(false);}}>Keep my current settings</button><button className="support-primary" disabled={busy||loading||!ack} onClick={()=>void cancel('confirm')}>Confirm cancellation</button></div><small>This confirmation expires in 10 minutes. Messages alone do not cancel anything.</small></section>}
  </div>
  <section className="support-conversation-section" aria-label="Messages">
   <div ref={historyLog} className="support-messages" role="log" aria-label="Support messages" aria-live="polite" aria-busy={busy||loading} onScroll={()=>{const log=historyLog.current;if(log){nearLatest.current=log.scrollHeight-log.clientHeight-log.scrollTop<72;setShowLatest(!nearLatest.current);}}}>
    {loading&&!messages.length?<p className="support-loading" role="status">Opening your conversation…</p>:!messages.length?<div className="support-empty"><div className="support-welcome-icon"><LifeBuoy size={25}/></div><h2>How can we help?</h2><p>Choose a topic or ask a question below.</p>{prompts}<small>Your account details are included automatically.</small></div>:messages.map(m=><article key={m.id} className={`support-message support-message-${m.role}`}><strong>{m.role==='user'?'You':m.role==='operator'?'Support team':m.role==='system'?'Update':'Account assistant'}</strong><p>{m.content}</p>{m.evidence?.length>0&&<details><summary>View the checks saved with this answer</summary><ul>{m.evidence.map(e=><li key={e.key}><strong>{e.status==='unknown'?'Could not verify':e.status==='attention'?'Needs attention':'Checked'}:</strong> {e.detail}<small>Source: {e.source} · {supportCheckTime(e.observedAt)}</small></li>)}</ul></details>}</article>)}
    {busy&&<div className="support-working" role="status"><span aria-hidden="true">•••</span> Checking your request…</div>}
   </div>
   {showLatest&&<button className="support-latest" type="button" onClick={latest}><ArrowDown size={14}/>Back to latest</button>}
  </section>
  <div className="support-compose-dock">
   {messages.length>0&&<details className="support-topic-menu"><summary>Common questions</summary>{prompts}</details>}
   <form onSubmit={send} className="support-composer" data-unsaved-draft={draft.trim()?'true':undefined}><label htmlFor="support-message" className="sr-only">Your message</label><div className="support-input-row"><textarea ref={composer} id="support-message" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&window.matchMedia('(pointer: fine)').matches){e.preventDefault();void send(e);}}} maxLength={2000} rows={2} placeholder="Ask about your bot, billing, or a deal…" disabled={busy}/><button type="submit" className="support-primary support-send" aria-label={busy?'Sending message':'Send message'} disabled={busy||loading||!draft.trim()}><ArrowUp size={20}/></button></div><small>Keep passwords and card numbers out of chat.</small></form>
   <div className="support-actions"><button type="button" disabled={busy||loading} onClick={()=>void escalate()}>{draft.trim()?'Send to team':'Ask the team'}</button><button type="button" disabled={busy||loading} onClick={()=>void cancel('prepare')}>Review cancellation</button></div>
  </div>
 </section>;
}
