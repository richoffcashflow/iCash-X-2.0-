'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccessHelpConversation} from '@/lib/access-help';
import {supportRequest} from '@/lib/support-client';
export function AccessHelp(){
 const [conversation,setConversation]=useState<AccessHelpConversation|null>(null),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[draft,setDraft]=useState('');
 const [loading,setLoading]=useState(true),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const mounted=useRef(true),pending=useRef<{id:string;body:string}|null>(null),working=useRef(false);
 const load=useCallback(async()=>{
  try{const {ok,data}=await supportRequest<{ready:boolean;conversation:AccessHelpConversation|null;error?:string}>('/api/support/access',{cache:'no-store'});if(!mounted.current)return;if(!ok)throw Error(data.error);setReady(data.ready);setConversation(data.conversation);if(data.conversation){setEmail(data.conversation.email);setPhone(data.conversation.phone??'');if(pending.current&&data.conversation.messages.some(message=>message.role==='user'&&message.requestId===pending.current?.id)){const saved=JSON.parse(pending.current.body).message;setDraft(current=>current.trim()===saved?'':current);pending.current=null;setNotice('Your earlier message was saved. Support continues here.');}}setError('');}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Support could not load.');}
  finally{if(mounted.current)setLoading(false);}
 },[]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[load]);
 useEffect(()=>{if(!conversation)return;const refresh=()=>{if(!document.hidden&&!working.current)void load();};const timer=setInterval(refresh,20000);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[conversation?.id,load]);
 async function send(event:React.FormEvent){
  event.preventDefault();if(working.current||!ready)return;working.current=true;setBusy(true);setError('');setNotice('');
  const body=JSON.stringify({email,phone,message:draft.trim()});if(!pending.current||pending.current.body!==body)pending.current={id:crypto.randomUUID(),body};
  try{const {ok,data}=await supportRequest<{saved?:boolean;conversation:AccessHelpConversation;error?:string}>('/api/support/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(body),requestId:pending.current.id})});if(!ok||!data.saved||!data.conversation)throw Error(data.error||'Could not confirm your request. Your draft is still here.');setConversation(data.conversation);setEmail(data.conversation.email);setPhone(data.conversation.phone??'');setDraft('');pending.current=null;setNotice('Your message is saved. Replies appear here, and we’ll email you a link back to this conversation.');}
  catch(e){setError(e instanceof Error?e.message:'Could not send. Your draft is still here.');}
  finally{working.current=false;setBusy(false);}
 }
 return <section aria-label="Help getting into your account" className="access-help">
  <h1>Already paid and need help getting in?</h1><p>Get help here without signing in. AI support checks for recoverable account setup and helps troubleshoot here. You do not need to pay again.</p>
  <p><a href="/access">Try email or checkout-phone sign-in</a></p>
  {error&&<p role="alert">{error} <button type="button" disabled={busy} onClick={()=>void load()}>Refresh support</button></p>}
  {notice&&<p role="status">{notice}</p>}
  {loading?<p role="status">Opening support…</p>:<>
   {conversation&&<><p><strong>{conversation.status==='waiting_on_customer'?'Support replied':conversation.status==='resolved'?'Marked resolved — reply below if you still need help':'Request saved'}</strong></p><div className="access-help-messages" role="log" aria-label="Access support messages">{conversation.messages.map(message=><article key={message.id}><strong>{message.role==='user'?'You':'AI support'}</strong><p>{message.content}</p></article>)}</div><p className="sign-in-help">We’ll email {conversation.email} when support replies. Use the private link in that email to return on any device. You can also return in this browser within 7 days. Reference: {conversation.id.slice(0,8)}</p></>}
   {conversation?.notification&&(conversation.notification.status==='needs_review'||['bounced','complained','failed','suppressed'].includes(conversation.notification.delivery??''))&&<p role="status">We couldn’t confirm email delivery. Your replies are saved here; keep this page so you can continue the conversation.</p>}
   {ready?<form onSubmit={send} className="account-access">
    <label>Payment email<input type="email" autoComplete="email" required maxLength={254} disabled={busy||!!conversation} value={email} onChange={event=>setEmail(event.target.value)}/></label>
    {!conversation&&<p className="sign-in-help">We’ll email you when support replies, with a link straight back to your chat. No account needed.</p>}
    <label>Mobile number (optional)<input type="tel" autoComplete="tel" maxLength={40} disabled={busy||!!conversation} value={phone} onChange={event=>setPhone(event.target.value)}/></label>
    <label>{conversation?'Reply to support':'What happened?'}<textarea aria-label={conversation?'Reply to support':'What happened?'} required maxLength={2000} rows={4} disabled={busy} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="For example: I paid, but neither sign-in code arrived."/></label>
    <p className="sign-in-help">Do not send passwords, sign-in codes, or full card numbers.</p>
    <button className="fund-button full" disabled={busy||!draft.trim()}>{busy?'Getting your reply…':conversation?'Send reply':'Send to support'}</button>
   </form>:<p>Use the live support page at <a href="https://www.geticashx.com/access/help">geticashx.com/access/help</a>.</p>}
  </>}
  <p className="sign-in-help">You can also email <a href="mailto:support@geticashx.com">support@geticashx.com</a>.</p>
 </section>;
}
