'use client';
import {useEffect,useState} from 'react';
import {Mail,MessageSquare,Save,RefreshCw,ArrowRight} from 'lucide-react';
import type {WebinarSettings} from '@/lib/webinar-policy';
import {CampaignReplies} from '@/components/campaign-replies';
import {webinarRequest} from '@/lib/webinar-client';
export type FollowupReadiness={emailConnection:boolean;smsConnection:boolean;email:boolean;sms:boolean;senderCount?:number};
export type FollowupStats={emailSent:number;textsSent:number;pending:number;needsReview:number};
type Sender={phone:string;enabled:boolean;preferred:boolean};
export function WebinarFollowupSettings({settings,readiness,stats,busy,onChange,onSave}:{settings:WebinarSettings;readiness:FollowupReadiness|null;stats:FollowupStats|null;busy:boolean;onChange:(value:WebinarSettings)=>void;onSave:()=>void}){
 const [senders,setSenders]=useState<Sender[]>([]),[senderBusy,setSenderBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;void webinarRequest<{senders:Sender[]}>('/api/webinar/studio/senders',{cache:'no-store'}).then(d=>{if(active)setSenders(d.senders);}).catch(()=>{if(active)setError('Texting numbers could not load. Refresh numbers to try again.');});return()=>{active=false;};},[]);
 async function updateSenders(body:Record<string,unknown>){setSenderBusy(true);setError('');try{const d=await webinarRequest<{senders:Sender[]}>('/api/webinar/studio/senders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});setSenders(d.senders);}catch(e){setError(e instanceof Error?e.message:'Numbers could not update.');}finally{setSenderBusy(false);}}
 const emailStatus=!settings.enabled?'Paused':!settings.fromEmail?'Add verified sender':!settings.postalAddress.trim()?'Add mailing address':!readiness?.emailConnection?'Connection needed':readiness.email?'Ready':'Ready in production';
 const smsStatus=!settings.smsEnabled?'Paused':!readiness?.smsConnection?'Connection needed':!senders.some(s=>s.enabled)?'Add a texting number':'Ready';
 return <div className="ws-followups">
  <section className="ws-card"><div className="ws-card-heading"><div><span className="wb-eyebrow">ONE AUTOMATIC CAMPAIGN</span><h2>Turn viewers into customers</h2><p>Keep the conversation going across every webinar. Purchase stops the sales campaign.</p></div><span className="ws-status">Strong follow-up</span></div>
   <div className="ws-followup-channels">
    <label className="ws-followup-channel"><Mail size={22}/><span><b>Email campaign</b><small>{emailStatus}</small></span><input type="checkbox" checked={settings.enabled} onChange={e=>onChange({...settings,enabled:e.target.checked})}/></label>
    <label className="ws-followup-channel"><MessageSquare size={22}/><span><b>Text campaign</b><small>{smsStatus}</small></span><input type="checkbox" checked={settings.smsEnabled} onChange={e=>onChange({...settings,smsEnabled:e.target.checked})}/></label>
   </div>
   <div className="ws-followup-journey"><div><span>01</span><b>Bring them back</b><p>Personal reminders and saved playback.</p></div><div><span>02</span><b>Give them another angle</b><p>An unwatched webinar, with Day or Night chosen automatically.</p></div><div><span>03</span><b>Ask for the sale</b><p>Direct checkout offers with their saved details carried forward.</p></div></div>
  </section>
  <section className="ws-card"><div className="ws-card-heading"><div><h2>Starts strong. Keeps working.</h2><p>Copy and destinations adapt automatically. No separate email sequence to build for each webinar.</p></div></div><ol className="ws-followup-sequence">{['First 72 hr · Up to 2 emails + 1 text per day','Days 4–7 · Daily email + selected texts','Days 8–30 · Email every other day + weekly texts','Days 31–60 · Email every 3 days + occasional texts','Then · Weekly email while engaged'].map(label=><li key={label}>{label}</li>)}</ol><p className="ws-hint">At least 3 hours between messages. 9 AM–8 PM in their timezone. Pauses while they watch; stops on purchase or opt-out. Weekly emails pause after 90 days without a visit.</p>
   {stats?<div className="ws-followup-stats">{[['Emails sent',stats.emailSent],['Texts sent',stats.textsSent],['Queued',stats.pending],['Needs review',stats.needsReview]].map(([label,value])=><div key={label}><strong>{Number(value).toLocaleString()}</strong><span>{label}</span></div>)}</div>:<p className="ws-hint">Delivery totals are temporarily unavailable.</p>}
  </section>
  <section className="ws-card"><div className="ws-card-heading"><div><h2>Your sending setup</h2><p>Use your verified email domain and active Contiguity numbers.</p></div></div>
   <div className="ws-two-col"><label className="wb-label">Sender email<input type="email" value={settings.fromEmail} onChange={e=>onChange({...settings,fromEmail:e.target.value})} placeholder="sessions@geticashx.com"/></label><label className="wb-label">Business mailing address<input value={settings.postalAddress} maxLength={400} onChange={e=>onChange({...settings,postalAddress:e.target.value})} placeholder="Shown in your email footer"/></label></div>
   {settings.enabled&&!settings.postalAddress.trim()&&<p className="ws-hint">Add your mailing address to start email delivery. Texts can run independently.</p>}
   <div className="ws-card-heading"><div><h3>Texting numbers</h3><p>New leads and customer reminders use your preferred number first. Existing conversations keep their number.</p></div><button type="button" className="ws-secondary" disabled={senderBusy} onClick={()=>void updateSenders({action:'sync'})}><RefreshCw size={15}/>{senderBusy?'Refreshing…':'Refresh numbers'}</button></div>
   {senders.map(s=><div key={s.phone} className="ws-followup-channel ws-sender"><MessageSquare size={19}/><span><b>{s.phone}</b><small>{s.preferred?'Preferred for iCash X · ':''}{s.enabled?'Enabled':'Paused'}</small></span><input aria-label={`Enable ${s.phone}`} type="checkbox" disabled={senderBusy} checked={s.enabled} onChange={e=>void updateSenders({action:'toggle',phone:s.phone,enabled:e.target.checked})}/>{!s.preferred&&<button type="button" className="ws-secondary" disabled={senderBusy} onClick={()=>void updateSenders({action:'prefer',phone:s.phone})}>Make preferred</button>}</div>)}
   {!senders.length&&<p className="ws-hint">Lease a number in Contiguity, then refresh to add it here.</p>}{error&&<p role="alert">{error}</p>}
  </section>
  <section className="ws-card"><div className="ws-card-heading"><div><h2>After they buy <ArrowRight size={18}/></h2><p>Sales messages stop. Their selected channels switch to property updates and credit reminders after the purchase is linked to their account. Seller conversations stay separate.</p></div></div></section>
  <CampaignReplies/>
  <button className="wb-primary" disabled={busy} onClick={onSave}><Save size={16}/>{busy?'Saving…':'Save campaign'}</button>
 </div>;
}
