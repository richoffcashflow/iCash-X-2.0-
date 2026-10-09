'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Bell,ChevronDown,Mail,MessageSquare,RefreshCw,X} from 'lucide-react';
import type {CampaignSettings} from '@/lib/messaging-settings';
import {CampaignReplies} from '@/components/campaign-replies';
import {webinarRequest} from '@/lib/webinar-client';
export type FollowupReadiness={emailConnection:boolean;smsConnection:boolean;email:boolean;sms:boolean;senderCount?:number};
export type CustomerStats={subscribers:number;emails:number;texts:number;needsReview:number};
export type FollowupStats={emailSent:number;textsSent:number;pending:number;needsReview:number};
type Sender={phone:string;enabled:boolean;preferred:boolean};
function displayPhone(phone:string){return /^\+1\d{10}$/.test(phone)?`(${phone.slice(2,5)}) ${phone.slice(5,8)}-${phone.slice(8)}`:phone;}
export function MessagingSettings({settings,readiness,stats,customerEnabled,customerStats,customerReadiness,busy,dirty,settingsOpen,saveError,onChange,onCustomerChange,onSave,onOpenSettings,onCloseSettings}:{settings:CampaignSettings;customerEnabled:boolean;customerStats:CustomerStats|null;customerReadiness:{email:boolean;sms:boolean}|null;onCustomerChange:(value:boolean)=>void;readiness:FollowupReadiness|null;stats:FollowupStats|null;busy:boolean;dirty:boolean;settingsOpen:boolean;saveError:string;onChange:(value:CampaignSettings)=>void;onSave:()=>void;onOpenSettings:()=>void;onCloseSettings:()=>void}){
 const [senders,setSenders]=useState<Sender[]>([]),[senderBusy,setSenderBusy]=useState(false),[sendersLoaded,setSendersLoaded]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{let active=true;void webinarRequest<{senders:Sender[]}>('/api/messaging/admin/senders',{cache:'no-store'}).then(d=>{if(active){setSenders(d.senders);setSendersLoaded(true);}}).catch(()=>{if(active)setError('Numbers could not load. Refresh to try again.');});return()=>{active=false;};},[]);
 useEffect(()=>{const el=dialog.current;if(!el)return;if(settingsOpen&&!el.open)el.showModal();else if(!settingsOpen&&el.open)el.close();},[settingsOpen]);
 async function updateSenders(body:Record<string,unknown>){setSenderBusy(true);setError('');try{const d=await webinarRequest<{senders:Sender[]}>('/api/messaging/admin/senders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});setSenders(d.senders);setSendersLoaded(true);}catch(e){setError(e instanceof Error?e.message:'Numbers could not update.');}finally{setSenderBusy(false);}}
 const emailStatus=!settings.enabled?'Off':!settings.fromEmail?'Needs setup':!settings.postalAddress.trim()?'Needs address':!readiness?.emailConnection?'Needs connection':readiness.email?'On':'Ready in production';
 const smsStatus=!settings.smsEnabled?'Off':!readiness?.smsConnection?'Needs connection':!sendersLoaded?error?'Check settings':'Checking…':!senders.some(s=>s.enabled)?'Needs a number':'On';
 const needsSetup=settings.enabled&&(!settings.fromEmail||!settings.postalAddress.trim()||!readiness?.emailConnection)||settings.smsEnabled&&(!readiness?.smsConnection||sendersLoaded&&!senders.some(s=>s.enabled));
 const preferred=senders.find(s=>s.preferred&&s.enabled)??senders.find(s=>s.enabled);
 const reviewCount=stats&&customerStats?stats.needsReview+customerStats.needsReview:null;
 return <div className="ms-overview">
  {needsSetup&&<div className="ms-setup-note"><span>{settings.enabled&&!settings.postalAddress.trim()?'Add your business address to start campaign emails.':'Finish setup to start your follow-ups.'}</span><button type="button" onClick={onOpenSettings}>Finish setup <ArrowUpRight size={14}/></button></div>}
  <section className="ms-automation-card" aria-labelledby="ms-sales-title">
   <div className="ms-card-intro"><span className="ms-card-icon"><MessageSquare size={21}/></span><div><h2 id="ms-sales-title">Automatic sales follow-ups</h2><p>Leads enter when they opt in. Follow-ups continue until they buy or opt out.</p></div></div>
   <div className="ms-channel-grid">
    <label className="ms-channel"><span><Mail size={16}/><b>Email</b><small>{emailStatus}</small></span><input className="ms-switch" role="switch" aria-label="Sales follow-ups by email" type="checkbox" checked={settings.enabled} onChange={e=>onChange({...settings,enabled:e.target.checked})}/></label>
    <label className="ms-channel"><span><MessageSquare size={16}/><b>Text</b><small>{smsStatus}</small></span><input className="ms-switch" role="switch" aria-label="Sales follow-ups by text" type="checkbox" checked={settings.smsEnabled} onChange={e=>onChange({...settings,smsEnabled:e.target.checked})}/></label>
   </div>
  </section>
  <section className="ms-automation-card ms-customer-card" aria-labelledby="ms-customer-title">
   <div className="ms-card-intro"><span className="ms-card-icon"><Bell size={21}/></span><div><h2 id="ms-customer-title">Customer reminders</h2><p>Property updates and reminders to add credits.</p></div></div>
   <label className="ms-customer-switch"><span>{customerEnabled?'On':'Off'}</span><input className="ms-switch" role="switch" aria-label="Customer reminders" type="checkbox" checked={customerEnabled} onChange={e=>onCustomerChange(e.target.checked)}/></label>
  </section>
  <div className="ms-mini-stats" aria-label="Message activity">
   <div><strong>{stats?.pending.toLocaleString()??'—'}</strong><span>Messages queued</span></div>
   <div><strong>{customerStats?(customerStats.emails+customerStats.texts).toLocaleString():'—'}</strong><span>Customer updates <small>Last 24 hr</small></span></div>
   <div><strong>{reviewCount?.toLocaleString()??'—'}</strong><span>Deliveries to review</span></div>
  </div>
  <div className="ms-details-list"><CampaignReplies/>
   <details className="ms-how"><summary>How it works <ChevronDown size={16}/></summary><div className="ms-details-content"><p>Follow-ups bring people back to a saved or unwatched webinar, or straight to checkout. After purchase, their selected channels switch to customer updates.</p><p>Messages run between 9 AM and 8 PM in their timezone, at least 3 hours apart. They stop on purchase or opt-out, pause while a person watches, and hold automated texts when someone replies.</p><p>Starts with up to 2 emails and 1 text per day, then tapers over 60 days. After that, an email and a text continue each week until purchase or opt-out. Each channel needs its own opt-in; older signups keep their original limits.</p><p>Customer reminders use the channels each customer chooses. Seller and buyer conversations stay with their property.</p>
    <div className="ms-detail-totals"><span>Campaign emails sent <b>{stats?.emailSent.toLocaleString()??'—'}</b></span><span>Campaign texts sent <b>{stats?.textsSent.toLocaleString()??'—'}</b></span><span>Opted-in customers <b>{customerStats?.subscribers.toLocaleString()??'—'}</b></span></div>
   </div></details>
  </div>
  <dialog ref={dialog} id="ms-settings" className="ms-settings-dialog" aria-labelledby="ms-settings-title" onClose={onCloseSettings}>
   <form onSubmit={e=>{e.preventDefault();onSave();}}>
    <div className="ms-dialog-header"><div><h2 id="ms-settings-title">Settings</h2><p>Your email and texting number.</p></div><button type="button" className="ms-close" aria-label="Close settings" onClick={onCloseSettings}><X size={20}/></button></div>
    <div className="ms-dialog-body">
     <label className="wb-label">Sender email<input type="email" value={settings.fromEmail} onChange={e=>onChange({...settings,fromEmail:e.target.value})} placeholder="sessions@geticashx.com"/></label>
     <label className="wb-label">Business mailing address<input value={settings.postalAddress} maxLength={400} onChange={e=>onChange({...settings,postalAddress:e.target.value})} placeholder="Shown at the bottom of campaign emails"/></label>
     <div className="ms-sender-summary"><MessageSquare size={18}/><div><span>Texting number</span><b>{preferred?displayPhone(preferred.phone):sendersLoaded?'No active number':'Loading…'}</b></div></div>
     <details className="ms-number-settings"><summary>Manage numbers <ChevronDown size={15}/></summary><p>New conversations use your preferred number. Existing conversations keep theirs. Number changes save immediately.</p><a href="/messagingadmin/calls">Call settings</a>
      {senders.map(s=><div className="ms-number-row" key={s.phone}><span><b>{displayPhone(s.phone)}</b><small>{s.preferred?'Preferred':s.enabled?'Available':'Paused'}</small></span><input className="ms-switch" role="switch" aria-label={`Enable ${displayPhone(s.phone)}`} type="checkbox" disabled={senderBusy} checked={s.enabled} onChange={e=>void updateSenders({action:'toggle',phone:s.phone,enabled:e.target.checked})}/>{!s.preferred&&<button type="button" className="ms-number-prefer" disabled={senderBusy} onClick={()=>void updateSenders({action:'prefer',phone:s.phone})}>Make preferred</button>}</div>)}
      <button type="button" className="ws-secondary" disabled={senderBusy} onClick={()=>void updateSenders({action:'sync'})}><RefreshCw size={14}/>{senderBusy?'Refreshing…':'Refresh numbers'}</button>
     </details>
     {(error||saveError)&&<p role="alert" className="ms-dialog-error">{saveError||error}</p>}
     <small className="ms-connection-note">Customer email: {customerReadiness?.email?'connected':'needs setup'} · Texts: {customerReadiness?.sms?'connected':'needs setup'}</small>
    </div>
    <div className="ms-dialog-footer"><button type="button" className="ws-secondary" onClick={onCloseSettings}>Done</button><button type="submit" className="wb-primary" disabled={busy||!dirty}>{busy?'Saving…':'Save changes'}</button></div>
   </form>
  </dialog>
 </div>;
}
