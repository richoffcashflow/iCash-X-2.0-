'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {WebinarCheckout} from '@/components/webinar-checkout-adapter';
import {WebinarAudience} from '@/components/webinar-audience';
import {WebinarPurchaseNotifications} from '@/components/webinar-purchase-notifications';
import {availableOffers,selectOffer} from '@/packages/webinar-engine/src/index';
import {webinarSite} from '@/lib/webinar-site';
import {webinarBrowserReady,webinarBrowserEvent} from '@/lib/webinar-browser-events';
import {MessageCircle,Send,X,ChevronDown,ShieldCheck} from 'lucide-react';
import {WebinarPlayer} from '@/components/webinar-player';
import {WebinarPanelBoundary} from '@/components/webinar-panel-boundary';
import {webinarPost as post,webinarBeacon} from '@/lib/webinar-client';
import {restoredPosition,savePosition,clearPosition} from '@/lib/webinar-playback';
import {webinarPrompt,readPromptHistory,savePromptHistory,emptyPromptHistory} from '@/lib/webinar-prompts';
import {AccountAccess} from '@/components/account-access';
import {publicWebinar,webinarSchema,formatWatchTime,webinarOffers,webinarPitchAt,webinarEndOffer,offerDestination,webinarConsent,webinarConsentVersion,type Webinar,type WebinarEvent} from '@/lib/webinar-policy';
type PublicWebinar=ReturnType<typeof publicWebinar>;
type Message={id:string;role:'user'|'assistant';text:string};
type Session={webinar:PublicWebinar;sessionId:string;progress:number;name:string;email?:string;phone?:string;contactSaved:boolean;messages:Message[];preview:boolean;serverNow:number};
export function WebinarRoom({webinarCode}:{webinarCode?:string}){
 const [session,setSession]=useState<Session|null>(null),[error,setError]=useState(''),[unavailable,setUnavailable]=useState(''),[login,setLogin]=useState(false);
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[funding,setFunding]=useState(false),[chatOpen,setChatOpen]=useState(true),[messages,setMessages]=useState<Message[]>([]),[question,setQuestion]=useState(''),[chatBusy,setChatBusy]=useState(false),[chatError,setChatError]=useState('');
 const [name,setName]=useState(''),[draftName,setDraftName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[consent,setConsent]=useState(false),[contactSaved,setContactSaved]=useState(false),[formBusy,setFormBusy]=useState(false),[formError,setFormError]=useState('');
 const [selectedOfferId,setSelectedOfferId]=useState(''),[checkoutEngaged,setCheckoutEngaged]=useState(false);
 const [now,setNow]=useState(Date.now()),[endCountdown,setEndCountdown]=useState<number|null>(null),[saved,setSaved]=useState(true);
 const starting=useRef(false),syncing=useRef(false),completed=useRef(false),sessionRef=useRef<Session|null>(null);
 const [editingName,setEditingName]=useState(false),[promptHistory,setPromptHistory]=useState({...emptyPromptHistory});
 const chatEnd=useRef<HTMLDivElement>(null),lastSync=useRef(0),pitchSeen=useRef(false),startSeen=useRef(false),alive=useRef(true),offset=useRef(0),position=useRef(0),shownOffers=useRef(new Set<string>());
 const load=useCallback(async()=>{if(starting.current)return;starting.current=true;setError('');setUnavailable('');try{
  const params=new URLSearchParams(location.search),attribution=Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ad_id','adset_id','campaign_id','fbclid'].flatMap(k=>params.has(k)?[[k,params.get(k)!]]:[]));
  const d=await post<Session&{redirect?:string;unavailable?:boolean;message?:string}>('/api/webinar/start',{...(webinarCode?{code:webinarCode}:{}),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Chicago',...(params.get('r')?{resume:params.get('r')}:{}),...(params.get('preview')?{preview:params.get('preview'),variant:params.get('variant')==='night'?'night':'day'}:{}),attribution});
  if(d.redirect){location.replace(d.redirect);return;}if(d.unavailable){setUnavailable(d.message||'The next session is being prepared.');return;}if(!alive.current)return;
  if(params.has('r')){params.delete('r');history.replaceState(null,'',location.pathname+(params.size?'?'+params.toString():''));}
  if(typeof d.sessionId!=='string'||!Number.isFinite(d.progress)||!Number.isFinite(d.serverNow))throw Error('The session could not load. Please try again.');
  d.webinar=publicWebinar(webinarSchema.parse({...d.webinar,faq:'',chatStyle:''}));
  d.messages=Array.isArray(d.messages)?d.messages.filter(m=>m&&typeof m.id==='string'&&typeof m.text==='string'&&['user','assistant'].includes(m.role)):[];
  d.name=typeof d.name==='string'?d.name:'';
  d.progress=d.preview?d.progress:restoredPosition(d.sessionId,d.progress,d.webinar.durationSeconds);
  webinarBrowserReady(d.sessionId,d.preview);offset.current=d.serverNow-Date.now();sessionRef.current=d;setSession(d);setName(d.name);setDraftName(d.name);setEmail(d.email||'');setPhone(d.phone||'');setPromptHistory(readPromptHistory(d.sessionId));setContactSaved(d.contactSaved);setMessages(d.messages);setTime(d.progress);position.current=d.progress;
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not open the session.');}finally{starting.current=false;}},[webinarCode]);
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[load]);
 const track=useCallback((kind:WebinarEvent,beacon=false,key='once')=>{
  if(!session||session.preview)return;const body={sessionId:session.sessionId,seconds:Math.floor(position.current),kind,key};
  if(kind==='completed'){completed.current=true;clearPosition(session.sessionId);}
  else if(!completed.current)savePosition(session.sessionId,position.current);
  if(beacon){webinarBeacon('/api/webinar/event',body);if(key==='once'&&kind==='add_to_cart')webinarBrowserEvent('add_to_cart',session.sessionId);return;}
  if(kind==='progress'&&syncing.current)return;if(kind==='progress')syncing.current=true;
  void post('/api/webinar/event',body,10000).then(()=>{if(alive.current)setSaved(true);if(key==='once'&&['started','contact_saved','add_to_cart','checkout_opened'].includes(kind))webinarBrowserEvent(kind as 'started'|'contact_saved'|'add_to_cart'|'checkout_opened',session.sessionId);}).catch(()=>{if(alive.current)setSaved(false);}).finally(()=>{if(kind==='progress')syncing.current=false;});
 },[session]);
 useEffect(()=>{if(session)savePromptHistory(session.sessionId,promptHistory);},[session,promptHistory]);
 useEffect(()=>{const online=()=>{if(sessionRef.current)track('progress');else void load();};window.addEventListener('online',online);return()=>window.removeEventListener('online',online);},[load,track]);
 useEffect(()=>{const id=setInterval(()=>setNow(Date.now()+offset.current),1000);return()=>clearInterval(id);},[]);
 useEffect(()=>{if(endCountdown===null||!session||checkoutEngaged)return;if(endCountdown===0){const offer=webinarEndOffer(session.webinar,Date.now()+offset.current);if(offer?.action==='checkout'){setSelectedOfferId(offer.id);setFunding(true);setChatOpen(false);setEndCountdown(null);}else if(offer)location.assign(offerDestination(offer));else setEndCountdown(null);return;}const id=setTimeout(()=>setEndCountdown(n=>n===null?null:n-1),1000);return()=>clearTimeout(id);},[endCountdown,session,checkoutEngaged]);
 useEffect(()=>{chatEnd.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages]);
 function openFunding(){if(!session)return;const offer=checkoutEngaged?webinarOffers(session.webinar).find(o=>o.id===selectedOfferId):selectOffer(webinarOffers(session.webinar),position.current,Date.now()+offset.current,selectedOfferId);if(!offer)return;track('add_to_cart');track('checkout_opened');track('checkout_opened',false,'offer:'+offer.id);setSelectedOfferId(offer.id);setFunding(true);setChatOpen(false);setEndCountdown(null);}
 function tick(n:number){if(!session)return;position.current=n;setTime(n);
  if(Date.now()-lastSync.current>15000){lastSync.current=Date.now();track('progress');}
  const offer=selectOffer(webinarOffers(session.webinar),n,Date.now()+offset.current);
  if(offer&&!checkoutEngaged&&!shownOffers.current.has(offer.id)){shownOffers.current.add(offer.id);if(!pitchSeen.current){pitchSeen.current=true;track('pitch_shown');}track('pitch_shown',false,'offer:'+offer.id);setSelectedOfferId(offer.id);setFunding(true);setChatOpen(false);}
 }
 async function saveContact(onlyName:boolean){if(!session||formBusy)return;setFormBusy(true);setFormError('');try{
  const d=await post<{name:string;contactSaved:boolean}>('/api/webinar/contact',{sessionId:session.sessionId,name:draftName.trim(),email,phone,consent,version:webinarConsentVersion,onlyName});setName(d.name);setEditingName(false);setPromptHistory(h=>onlyName?{...h,nameSavedAt:time}:{...h,contactDismissedAt:time,contactAttempts:Math.min(2,h.contactAttempts+1)});if(!onlyName)setContactSaved(d.contactSaved);track(onlyName?'name_saved':'contact_saved');
 }catch(e){setFormError(e instanceof Error?e.message:'Could not save.');}finally{setFormBusy(false);}}
 async function send(e:React.FormEvent){e.preventDefault();if(!question.trim()||chatBusy||!session)return;setChatBusy(true);setChatError('');const text=question.trim();try{const d=await post<{messages:Message[]}>('/api/webinar/chat',{sessionId:session.sessionId,text});if(!Array.isArray(d.messages)||d.messages.some(m=>!m||typeof m.id!=='string'||typeof m.text!=='string'||!['user','assistant'].includes(m.role)))throw Error('The reply could not load. Your video is still playing.');setMessages(m=>[...m,...d.messages]);setQuestion('');}catch(e){setChatError(e instanceof Error?e.message:'Message was not sent.');}finally{setChatBusy(false);}}
 const w=session?.webinar,cues=w?.chat.filter(c=>c.at<=time).sort((a,b)=>a.at-b.at)??[];
 const offers=w?webinarOffers(w):[],available=availableOffers(offers,time,now),currentOffer=checkoutEngaged?offers.find(o=>o.id===selectedOfferId):selectOffer(offers,time,now,selectedOfferId);
 const allOffersEnded=offers.length>0&&offers.every(o=>o.expiresAt&&Date.parse(o.expiresAt)<=now);
 const automaticPrompt=w?webinarPrompt({name,contactSaved,seconds:time,nameAt:w.nameAt,contactAt:w.contactAt,history:promptHistory}):null;
 const namePrompt=!!w&&(editingName||automaticPrompt==='name');
 const contactPrompt=!!w&&!namePrompt&&automaticPrompt==='contact';
 const contactForm=(namePrompt||contactPrompt)&&<form className="wb-prompt" onSubmit={e=>{e.preventDefault();void saveContact(namePrompt);}}>
     <div><span className="wb-eyebrow">{namePrompt?'JOIN THE CHAT':'KEEP YOUR PLACE'}</span><h2>{namePrompt?'What’s your name?':'Where can we reach you?'}</h2><p>{namePrompt?'Use your name in chat.':'Save your details without leaving the video.'}</p></div>
     {namePrompt&&<label className="wb-label">First name<input required autoComplete="given-name" maxLength={80} value={draftName} onChange={e=>setDraftName(e.target.value)} placeholder="Your first name"/></label>}
     {contactPrompt&&<><label className="wb-label">Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label><label className="wb-label">Phone <small>optional</small><input type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Your phone number"/></label><label className="wb-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>{webinarConsent}</span></label><a className="wb-privacy-link" href="/webinar/privacy" target="_blank" rel="noopener noreferrer">Privacy &amp; follow-ups</a></>}
     <div className="wb-prompt-actions"><button className="wb-primary" disabled={formBusy}>{formBusy?'Saving…':namePrompt?'Save name':'Save my details'}</button><button type="button" className="wb-text" onClick={()=>{if(namePrompt){setPromptHistory(h=>({...h,nameDismissedAt:time,nameAttempts:Math.min(2,h.nameAttempts+1)}));setEditingName(false);setDraftName(name);}else setPromptHistory(h=>({...h,contactDismissedAt:time,contactAttempts:Math.min(2,h.contactAttempts+1)}));}}>Not now</button></div>{formError&&<p role="alert">{formError}</p>}
    </form>;
 return <div className={`wb-room${currentOffer?' wb-with-offer':''}`}>
  {login&&<div className="wb-login"><button className="wb-icon" aria-label="Close sign in" onClick={()=>setLogin(false)}><X/></button><h2>Welcome back</h2><p>Use your existing account to open your workspace.</p><WebinarPanelBoundary label="Sign in"><AccountAccess onSignedIn={()=>location.assign(webinarSite.workspacePath)}/></WebinarPanelBoundary></div>}
  {!session?<main className="wb-empty"><span className="wb-eyebrow">{webinarSite.hostName} · {webinarSite.brandName}</span><h1>{unavailable?'Your next session is coming.':error?'Let’s get you connected.':'Opening your session…'}</h1><p>{unavailable||error||'Finding your place and preparing the video.'}</p>{error&&<button className="wb-primary" onClick={()=>void load()}>Try again</button>}{unavailable&&<a className="wb-primary" href="/">Open iCash X</a>}</main>:<main className={`wb-stage ${funding&&currentOffer?'wb-selling':''}`}>
   <section className="wb-watch">
    <h1 className="wb-sr">{w!.title}</h1>
    <WebinarPlayer key={session.sessionId} sessionId={session.sessionId} videoUrl={w!.videoUrl} posterUrl={w!.posterUrl} title={w!.title} progress={session.progress} preview={session.preview} onProgress={tick} onPlayingChange={setPlaying} onCheckpoint={()=>track('progress',true)} onStarted={()=>{if(!startSeen.current){startSeen.current=true;track('started');}}} onEnded={()=>{track('completed');if(checkoutEngaged)return;const offer=webinarEndOffer(w!,now);if(offer)setSelectedOfferId(offer.id);if(offer&&w!.redirectAtEnd&&!session.preview)setEndCountdown(8);setFunding(!!offer);setChatOpen(!offer);}}/>
    <div className="wb-under-video"><WebinarPanelBoundary quiet><WebinarAudience sessionId={session.sessionId} enabled={w!.showAudienceCount} preview={session.preview} playing={playing} display={w!.audienceDisplay} seconds={time} durationSeconds={w!.durationSeconds}/></WebinarPanelBoundary>{!saved&&<span className="wb-sr" role="status">Your progress will sync when the connection returns.</span>}</div>
    {endCountdown!==null&&<div className="wb-prompt"><strong>Opening your next step in {endCountdown} seconds</strong><button className="wb-text" onClick={()=>setEndCountdown(null)}>Stay here</button></div>}
   </section>
   <aside className="wb-side"><WebinarPanelBoundary label="Chat and offers">
    {currentOffer&&<section className="wb-offer" hidden={!funding}><div className="wb-panel-heading"><span className="wb-eyebrow">YOUR NEXT STEP</span><button className="wb-icon" aria-label="Minimize offer" onClick={()=>{setFunding(false);setChatOpen(true);}}><ChevronDown size={20}/></button></div>{available.length>1&&<div className="wb-offer-options" aria-label="Available offers">{available.map(offer=><button key={offer.id} disabled={checkoutEngaged} aria-pressed={currentOffer.id===offer.id} onClick={()=>{setSelectedOfferId(offer.id);track('pitch_shown',false,'offer:'+offer.id);}}>{offer.title}</button>)}</div>}<h2>{currentOffer.title}</h2>{currentOffer.description&&<p className="wb-offer-description">{currentOffer.description}</p>}{currentOffer.expiresAt&&!checkoutEngaged&&<p className="wb-deadline">Offer closes in <strong>{formatWatchTime(Math.ceil((Date.parse(currentOffer.expiresAt)-now)/1000))}</strong></p>}{currentOffer.action==='checkout'?<div className="wb-embedded-checkout"><WebinarPanelBoundary label="Checkout" fallbackHref={webinarSite.checkoutPath}><WebinarCheckout preview={session.preview} onEngaged={()=>{setCheckoutEngaged(true);setSelectedOfferId(currentOffer.id);setEndCountdown(null);track('add_to_cart');track('checkout_opened');track('checkout_opened',false,'offer:'+currentOffer.id);}}/></WebinarPanelBoundary></div>:<a className="wb-primary wb-offer-link" href={offerDestination(currentOffer)} onClick={()=>{track('add_to_cart',true);track('checkout_opened',true);track('checkout_opened',true,'offer:'+currentOffer.id);track('progress',true);}}>{currentOffer.ctaLabel}</a>}<p className="wb-secure"><ShieldCheck size={14}/>Your video keeps playing while you review.</p></section>}
    {allOffersEnded&&time>=webinarPitchAt(w!)&&<section className="wb-offer"><h2>This session’s offers have ended.</h2><a className="wb-primary" href={webinarSite.checkoutPath}>See current options</a></section>}
    <section className={`wb-chat ${chatOpen?'':'wb-chat-collapsed'}`}><button className="wb-chat-heading" onClick={()=>setChatOpen(v=>!v)} aria-expanded={chatOpen}><span><MessageCircle size={18}/><strong>Chat</strong></span><span>{chatOpen?'Minimize':'Open chat'}</span></button>
     {chatOpen&&<><div className="wb-chat-log" role="log" aria-label="Session messages"><p className="wb-chat-note">Scheduled host notes, AI notes and replay comments appear with the video. Your questions get a private AI reply.</p>{cues.map(c=><article className="wb-message" key={c.id}><div className="wb-avatar">{c.name.slice(0,1).toUpperCase()}</div><div><b>{c.name}</b><small>{c.kind==='replay'?'REPLAY':c.kind==='ai'?'AI SESSION NOTE':'HOST NOTE'} · {formatWatchTime(c.at)}</small><p>{c.text.replaceAll('{{name}}',name||'there')}</p></div></article>)}{messages.map(m=><article className={`wb-message ${m.role==='user'?'wb-message-own':''}`} key={m.id}><div className="wb-avatar">{m.role==='user'?(name||'G').slice(0,1):'X'}</div><div><b>{m.role==='user'?name||'Guest':webinarSite.assistantName}</b><small>{m.role==='user'?'ONLY YOU CAN SEE THIS':'AI REPLY'}</small><p>{m.text}</p></div></article>)}{chatBusy&&<p role="status" className="wb-chat-note">The assistant is replying…</p>}<div ref={chatEnd}/></div>{contactForm}<div className="wb-chat-identity">Chatting as <b>{name||'Guest'}</b><button type="button" onClick={()=>{setDraftName(name);setEditingName(true);setFormError('');}}>{name?'Edit name':'Add name'}</button></div><form className="wb-chat-input" onSubmit={send}><label className="wb-sr" htmlFor="wb-question">Send a message</label><input id="wb-question" value={question} maxLength={1200} onChange={e=>setQuestion(e.target.value)} placeholder="Send a message…"/><button disabled={chatBusy||!question.trim()} aria-label="Send message"><Send size={18}/></button></form>{chatError&&<p className="wb-chat-note" role="alert">{chatError}</p>}</>}
    </section>
   </WebinarPanelBoundary></aside>
  </main>}
  {session&&<WebinarPanelBoundary quiet><WebinarPurchaseNotifications sessionId={session.sessionId} preview={session.preview} enabled={session.webinar.purchaseNotifications.enabled&&!!currentOffer&&!checkoutEngaged&&playing&&!login&&time>=Math.max(webinarPitchAt(session.webinar),session.webinar.purchaseNotifications.startAt??0)} intervalSeconds={session.webinar.purchaseNotifications.intervalSeconds}/></WebinarPanelBoundary>}
  {session&&currentOffer&&<div className="wb-bottom"><span>{name&&<b>{name}</b>}</span><button className="wb-primary" onClick={openFunding}>{currentOffer.ctaLabel}</button></div>}
  <footer className="wb-room-footer"><span>Automated webinar</span><button type="button" className="wb-text" onClick={()=>setLogin(x=>!x)}>Already a member? Sign in</button></footer>
 </div>;
}
