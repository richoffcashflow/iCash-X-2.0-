'use client';
import {useEffect,useRef,useState} from 'react';
import {Bell,Mail,MessageCircle,X} from 'lucide-react';
import {botUpdateConsentVersion,type InboxItem,type BotUpdatePreferences as Preferences} from '@/lib/customer-updates';

export function WorkspaceUpdates({onPreferences,onBudget}:{onPreferences:()=>void;onBudget:()=>void}){
 const [items,setItems]=useState<InboxItem[]>([]),[seenAt,setSeenAt]=useState<string|null>(null),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[retry,setRetry]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  let alive=true,inFlight=false;const controller=new AbortController();
  async function load(){if(document.hidden||inFlight)return;inFlight=true;try{const response=await fetch('/api/notifications/updates',{cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error);if(alive){setItems(data.items);setSeenAt(data.preferences.seenAt??null);setError('');setLoaded(true);}}catch{if(alive)setError('Could not refresh updates. Your saved properties are still available.');}finally{inFlight=false;}}
  void load();const timer=setInterval(load,60000);document.addEventListener('visibilitychange',load);
  return()=>{alive=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
 },[retry]);
 const unread=items.filter(item=>!seenAt||Date.parse(item.createdAt)>Date.parse(seenAt)).length;
 async function markSeen(){const before=items[0]?.createdAt;if(!before)return;try{const response=await fetch('/api/notifications/updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'seen',before})});if(!response.ok)throw Error();setSeenAt(before);}catch{setError('Could not mark updates read. Please try again.');}}
 return <>
  <button className="workspace-updates-button" aria-label={`Updates${unread?`, ${unread} unread`:''}`} onClick={()=>dialog.current?.showModal()}><Bell size={18} aria-hidden="true"/><span>Updates</span>{unread>0&&<b>{unread>9?'9+':unread}</b>}</button>
  <dialog className="updates-dialog" ref={dialog} aria-labelledby="updates-title"><div className="updates-heading"><div><span className="workspace-eyebrow">Your bot, at a glance</span><h2 id="updates-title">Updates</h2></div><button className="icon-close" aria-label="Close updates" onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
   <div className="updates-toolbar"><button onClick={()=>{dialog.current?.close();onPreferences();}}>Email & text updates</button>{unread>0&&<button onClick={()=>void markSeen()}>Mark read</button>}</div>
   {error&&<p className="updates-error" role="alert">{error} <button onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
   {!loaded&&!error&&<p className="updates-empty" role="status">Loading your bot’s updates…</p>}
   {loaded&&!items.length&&<div className="updates-empty"><Bell size={24}/><h3>You’re all caught up.</h3><p>Seller replies, completed research and deal milestones will appear here.</p></div>}
   <ul className="updates-list">{items.map(item=><li key={item.id} data-unread={!seenAt||Date.parse(item.createdAt)>Date.parse(seenAt)}><a href={`/?screeningId=${encodeURIComponent(item.screeningId)}`}><span className="update-unread-dot" aria-hidden="true"/><span><strong>{item.title}</strong><p>{item.address??item.detail}</p><small>{new Date(item.createdAt).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small></span></a></li>)}</ul>
   {loaded&&items.length>0&&<div className="updates-budget"><strong>Ready for more eligible work?</strong><p>Choose how much your bot can spend each day.</p><button className="coach-action" onClick={()=>{dialog.current?.close();onBudget();}}>Review daily budget</button></div>}
  </dialog>
 </>;
}

export function BotUpdatePreferences({phone:accountPhone}:{phone?:string}){
 const [saved,setSaved]=useState<Preferences|null>(null),[email,setEmail]=useState(false),[sms,setSms]=useState(false),[phone,setPhone]=useState(accountPhone??''),[timezone,setTimezone]=useState('America/Chicago');
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();fetch('/api/notifications/updates',{cache:'no-store',signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);if(controller.signal.aborted)return;const p=data.preferences;setSaved(p);setEmail(p.emailEnabled);setSms(p.smsEnabled);setPhone(p.phone??accountPhone??'');setTimezone(p.timezone??Intl.DateTimeFormat().resolvedOptions().timeZone);setError('');}).catch(()=>{if(!controller.signal.aborted)setError('Could not load update preferences.');});return()=>controller.abort();},[accountPhone,retry]);
 function changed(){setConsent(false);setMessage('');}
 async function save(){if(busy||!saved||(email||sms)&&!consent)return;setBusy(true);setError('');setMessage('');try{const response=await fetch('/api/notifications/updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preferences',emailEnabled:email,smsEnabled:sms,phone,timezone,...(email||sms?{consentVersion:botUpdateConsentVersion}:{})})});const data=await response.json();if(!response.ok)throw Error(data.error);setSaved({...saved,...data.preferences});setConsent(false);setMessage(email||sms?'Saved. New bot activity will arrive through the channels you chose.':'Activity updates are off. Your bot and budget stay as they are.');}catch(error){setError(error instanceof Error?error.message:'Could not save updates.');}finally{setBusy(false);}}
 return <section className="bot-update-preferences" aria-labelledby="bot-updates-heading"><span className="workspace-eyebrow">Stay in the loop</span><h3 id="bot-updates-heading">Your bot. Wherever you are.</h3><p>Get a direct link when a seller replies, research finishes or a deal moves forward.</p>
  {!saved&&!error&&<p role="status">Loading your preferences…</p>}
  {saved&&<><label className="update-channel"><Mail size={20} aria-hidden="true"/><span><strong>Email updates</strong><small>{saved.email??'Verify your account email first'}</small></span><input type="checkbox" aria-label="Email activity updates" checked={email} disabled={busy||((!saved.emailAvailable||saved.emailSuppressed)&&!email)} onChange={event=>{setEmail(event.target.checked);changed();}}/></label>
   <label className="update-channel"><MessageCircle size={20} aria-hidden="true"/><span><strong>Text updates</strong><small>Important bot activity, on your phone</small></span><input type="checkbox" aria-label="Text activity updates" checked={sms} disabled={busy||(!saved.smsAvailable&&!sms)} onChange={event=>{setSms(event.target.checked);changed();}}/></label>
   {sms&&<><label className="update-phone-label">Your mobile number<input type="tel" autoComplete="tel" value={phone} placeholder="+1 (555) 123-4567" maxLength={30} disabled={busy} onChange={event=>{setPhone(event.target.value);changed();}}/></label><label className="update-phone-label">Your timezone<select value={timezone} disabled={busy} onChange={event=>{setTimezone(event.target.value);changed();}}>{[...new Set([timezone,'America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix','America/Anchorage','Pacific/Honolulu'])].map(zone=><option key={zone} value={zone}>{zone.replace('America/','').replaceAll('_',' ')}</option>)}</select></label></>}
   {saved.emailSuppressed&&<small className="updates-availability">Email updates are paused after a delivery issue. Contact support for help.</small>}
   {(!saved.emailAvailable||!saved.smsAvailable)&&<small className="updates-availability">{!saved.emailAvailable&&!saved.smsAvailable?'Email and text':!saved.emailAvailable?'Email':'Text'} delivery setup is still finishing. In-app updates remain available.</small>}
   {(email||sms)&&<label className="update-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/><span>I agree to ongoing bot activity updates by the channels selected above{sms?' at my mobile number':''}. Up to 3 per day per channel. {sms?'Texts arrive 9 AM–8 PM in my timezone. Message and data rates may apply. Reply STOP to stop texts. ':''}I can turn updates off anytime.</span></label>}
   <button className="coach-action" disabled={busy||(email||sms)&&!consent} onClick={()=>void save()}>{busy?'Saving…':'Save update preferences'}</button>
  </>}
  {error&&<p role="alert">{error} <button className="workspace-quiet" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}{message&&<p role="status">{message}</p>}
 </section>;
}
