'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {AccountAccess} from '@/components/account-access';
import {SupportAccountChecks} from '@/components/support-account-checks';
import {supportCheckLabels,supportCheckTime,supportPrompts} from '@/lib/support-self-service';
import type {SupportEvidence} from '@/lib/support-policy';
import '@/app/support/self-service.css';
type Message={id:string;role:string;content:string;evidence:SupportEvidence[];created_at:string};
type Thread={id:string;subject:string;status:string};
type Cancellation={id:string;source:string;state:string;result:string|null};
export function SupportChat({onClose}:{onClose?:()=>void}){
 const [threads,setThreads]=useState<Thread[]>([]),[messages,setMessages]=useState<Message[]>([]),[thread,setThread]=useState<string|null>(null);
 const [draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[needsSignIn,setNeedsSignIn]=useState(false);
 const [evidence,setEvidence]=useState<SupportEvidence[]>([]);
 const [cancellations,setCancellations]=useState<Cancellation[]>([]),[confirmation,setConfirmation]=useState<{token:string;summary:string}|null>(null),[ack,setAck]=useState(false),[notice,setNotice]=useState('');
 const request=useRef<{id:string;text:string;threadId:string|null}|null>(null),operation=useRef(false);
 const confirmationHeading=useRef<HTMLHeadingElement>(null);
 const historyLog=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null),readSequence=useRef(0);
 const clearAccount=useCallback(()=>{setNeedsSignIn(true);setThreads([]);setMessages([]);setThread(null);setEvidence([]);setCancellations([]);setConfirmation(null);setAck(false);setDraft('');setNotice('');setError('');request.current=null;},[]);
 const load=useCallback(async(id?:string)=>{
  const sequence=++readSequence.current;setLoading(true);
  try{
   const r=await fetch('/api/support'+(id?'?threadId='+encodeURIComponent(id):''),{cache:'no-store'});const d=await r.json();
   if(sequence!==readSequence.current)return;
   if(r.status===401){clearAccount();return 'signed_out';}
   if(!r.ok)throw Error(d.error||'Could not load support.');
   setNeedsSignIn(false);setThreads(d.threads);setMessages(d.messages);setThread(d.threadId);setCancellations(d.cancellations);setEvidence(d.evidence??[]);setError('');
  }catch(e){if(sequence===readSequence.current){setEvidence([]);setError(e instanceof Error?e.message:'Could not load support.');}}
  finally{if(sequence===readSequence.current)setLoading(false);}
 },[clearAccount]);
 useEffect(()=>{void load();return()=>{readSequence.current++;};},[load]);
 useEffect(()=>{if(confirmation)confirmationHeading.current?.focus();},[confirmation]);
 // Keep saved/new replies visible inside the log without moving the account checks offscreen.
 useEffect(()=>{const log=historyLog.current;if(log)log.scrollTop=log.scrollHeight;},[messages]);
 function startOperation(){if(operation.current)return false;operation.current=true;setBusy(true);setError('');setNotice('');return true;}
 function finishOperation(){operation.current=false;setBusy(false);}
 function usePrompt(text:string){if(operation.current)return false;if(draft.trim()){setNotice('You have an unsent message. Send it or clear it before choosing another question.');composer.current?.focus();return false;}setDraft(text);composer.current?.focus();return true;}
 function prepareHelp(check:SupportEvidence){if(usePrompt(`I need help with ${supportCheckLabels[check.key]??'my account'}.\nWhat I expected: \nWhat happened instead: \nWhat I already tried: `))setNotice('Review and send this question to save fresh account checks with it. Then choose “Ask the team” if you still need help.');}
 async function send(e:React.FormEvent){
  e.preventDefault();if(!draft.trim()||loading||!startOperation())return;
  const text=draft.trim();
  if(!request.current||request.current.text!==text)request.current={id:crypto.randomUUID(),text,threadId:thread};
  try{
   const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:request.current.id,...(request.current.threadId?{threadId:request.current.threadId}:{}),message:text})});const d=await r.json();
   if(r.status===401){clearAccount();return;}
   if(!r.ok||!d.threadId)throw Error(d.error||'Could not confirm your message was saved. Your draft is still here.');
   setDraft('');request.current=null;setThread(d.threadId);const refreshed=await load(d.threadId);
   if(d.pending&&refreshed!=='signed_out')setNotice('Your message is saved, but its reply is not yet confirmed. Refresh the conversation or ask the team; do not send the same message again.');
  }catch(e){setError(e instanceof Error?e.message:'Could not send. Your draft is still here.');}
  finally{finishOperation();}
 }
 async function escalate(){
  if(draft.trim()){setNotice('Send your message first so the team receives the issue and fresh account checks.');composer.current?.focus();return;}
  if(!thread){usePrompt('I need the support team to review my account.\nWhat I expected: \nWhat happened instead: \nWhat I already tried: ');setNotice('Describe the issue and send your message first. Then choose “Ask the team” to include the conversation and its account checks.');return;}
  if(loading||!startOperation())return;
  try{
   const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'escalate',threadId:thread})});const d=await r.json();
   if(r.status===401){clearAccount();return;}
   if(!r.ok||d.escalated!==true)throw Error(d.error||'Could not confirm the support request. Refresh its status before retrying.');
   if(await load(thread)==='signed_out')return;setNotice('Sent this conversation and its saved account checks to the support team. They can also refresh the current checks. Check here for a reply. No response time is guaranteed.');
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
 if(needsSignIn)return <section className="support-shell"><header className="support-heading"><h1>Let’s get you some help</h1>{onClose&&<button onClick={onClose} type="button">Close</button>}</header><p>Sign in so we can check only your account. Use the email you used for your account or payment. If you already paid, do not pay again to sign in.</p><AccountAccess onSignedIn={()=>void load()}/><a href="/">Back to workspace</a></section>;
 return <section className="support-shell" aria-label="Support conversation">
  <header className="support-heading"><div><p className="support-eyebrow">iCash X support</p><h1>Let’s get it sorted</h1></div>{onClose?<button onClick={onClose} type="button">Close</button>:<a href="/">Back to workspace</a>}</header>
  <p className="support-intro">Check what is happening with your bot, credit, and renewals. Start with the next step below, or send a question. Anything unresolved can go to the support team with the account checks attached.</p>
  <div className="support-tools">{threads.length>1&&<label>Conversation<select value={thread??''} disabled={busy||loading} onChange={e=>{request.current=null;void load(e.target.value);}}>{threads.map(t=><option value={t.id} key={t.id}>{t.subject.slice(0,50)} · {t.status.replaceAll('_',' ')}</option>)}</select></label>}<button disabled={busy||loading} onClick={()=>void load(thread??undefined)}>Refresh status</button>{thread&&<span className="support-status">{threads.find(t=>t.id===thread)?.status.replaceAll('_',' ')}</span>}</div>
  {error&&<p className="support-error" role="alert">{error}</p>}{notice&&<p className="support-notice" role="status">{notice}</p>}
  <SupportAccountChecks evidence={evidence} loading={loading} busy={busy} onRefresh={()=>void load(thread??undefined)} onCancel={()=>void cancel('prepare')} onTeam={prepareHelp}/>
  {cancellations.map(c=><div className="support-notice" key={c.id}><p>{c.state==='awaiting_confirmation'?`${c.source==='email'?'Email cancellation request received. ':''}Awaiting your confirmation. This request has not changed your bot or renewals.`:c.state==='cancelled'?`Cancellation confirmed when this request was completed. ${c.result??'Refresh account checks above for the current state.'}`:c.result??'Your confirmed cancellation is still being checked.'}</p>{!['processing','cancelled'].includes(c.state)&&<button disabled={busy||loading} onClick={()=>void cancel('prepare',c.id)}>Review this request</button>}</div>)}
  {confirmation&&<section className="support-confirm" aria-labelledby="support-cancel-heading"><h2 ref={confirmationHeading} tabIndex={-1} id="support-cancel-heading">Stop future work and renewals?</h2><p>{confirmation.summary}</p><label><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/> I want to pause my bot and stop future daily renewals</label><div><button disabled={busy} onClick={()=>{setConfirmation(null);setAck(false);}}>Keep my current settings</button><button className="support-primary" disabled={busy||loading||!ack} onClick={()=>void cancel('confirm')}>Confirm cancellation</button></div><small>This confirmation expires in 10 minutes. Chat messages and email requests alone do not cancel anything.</small></section>}
  <section className="support-conversation-section" aria-labelledby="support-conversation-heading"><h2 id="support-conversation-heading">Still need a hand?</h2><p className="support-conversation-hint">AI only helps choose account checks. It cannot spend money, refund charges, delete your account, or repeat calls.</p>
   <div className="support-prompts" aria-label="Start a support question">{supportPrompts.map(p=><button type="button" key={p.label} disabled={busy||loading} onClick={()=>usePrompt(p.message)}>{p.label}</button>)}</div>
   <div ref={historyLog} className="support-messages" role="log" aria-live="polite" aria-busy={busy||loading}>{loading&&!messages.length?<p>Loading your conversation…</p>:!messages.length?<div className="support-empty"><h3>Tell us what you expected and what happened</h3><p>Choose a question above or write your own. Your account checks will be saved with the answer.</p></div>:messages.map(m=><article key={m.id} className={`support-message support-message-${m.role}`}><strong>{m.role==='user'?'You':m.role==='operator'?'Support team':m.role==='system'?'Update':'Account assistant'}</strong><p>{m.content}</p>{m.evidence?.length>0&&<details><summary>View the checks saved with this answer</summary><ul>{m.evidence.map(e=><li key={e.key}><strong>{e.status==='unknown'?'Could not verify':e.status==='attention'?'Needs attention':'Checked'}:</strong> {e.detail}<small>Source: {e.source} · {supportCheckTime(e.observedAt)}</small></li>)}</ul></details>}</article>)}</div>
   <form onSubmit={send} className="support-composer"><label htmlFor="support-message">Your message</label><textarea ref={composer} id="support-message" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={2000} rows={3} placeholder="What happened? What have you tried?" disabled={busy}/><div><small>Don’t include passwords, payment details, or private documents.</small><button className="support-primary" disabled={busy||loading||!draft.trim()}>{busy?'Checking…':'Send message'}</button></div></form>
   <div className="support-actions"><button disabled={busy||loading} onClick={()=>void escalate()}>Ask the team</button><button disabled={busy||loading} onClick={()=>void cancel('prepare')}>Review cancellation</button></div>
   <p className="support-conversation-hint">Cancellation pauses new bot work and stops future daily renewals after confirmation. Existing credit and account records remain. Refunds and account deletion need a separate support review.</p>
  </section>
 </section>;
}
