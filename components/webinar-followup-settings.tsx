'use client';
import {Mail,MessageSquare,Save} from 'lucide-react';
import type {WebinarSettings} from '@/lib/webinar-policy';
export type FollowupReadiness={emailConnection:boolean;smsConnection:boolean;email:boolean;sms:boolean};
export type FollowupStats={emailSent:number;textsSent:number;pending:number;needsReview:number};
export function WebinarFollowupSettings({settings,readiness,stats,busy,onChange,onSave}:{settings:WebinarSettings;readiness:FollowupReadiness|null;stats:FollowupStats|null;busy:boolean;onChange:(value:WebinarSettings)=>void;onSave:()=>void}){
 const emailStatus=!settings.enabled?'Paused':!settings.fromEmail?'Add verified sender':!settings.postalAddress.trim()?'Add mailing address':!readiness?.emailConnection?'Connection needed':readiness.email?'Ready':'Ready in production';
 const smsStatus=!settings.smsEnabled?'Paused':!readiness?.smsConnection?'Connection needed':readiness.sms?'Ready':'Ready in production';
 return <div className="ws-followups">
  <section className="ws-card"><div className="ws-card-heading"><div><h2>Bring the right people back</h2><p>Personal reminders that follow each viewer’s progress.</p></div></div>
   <div className="ws-followup-channels">
    <label className="ws-followup-channel"><Mail size={22}/><span><b>Email follow-ups</b><small>{emailStatus}</small></span><input type="checkbox" checked={settings.enabled} onChange={e=>onChange({...settings,enabled:e.target.checked})}/></label>
    <label className="ws-followup-channel"><MessageSquare size={22}/><span><b>Text follow-ups</b><small>{smsStatus}</small></span><input type="checkbox" checked={settings.smsEnabled} onChange={e=>onChange({...settings,smsEnabled:e.target.checked})}/></label>
   </div>
   <p className="ws-hint">Separate opt-ins for email and text. Messages pause while someone is watching and stop after purchase. Text replies also stop this text sequence.</p>
   <div className="ws-two-col"><label className="wb-label">Verified sender email<input type="email" value={settings.fromEmail} onChange={e=>onChange({...settings,fromEmail:e.target.value})} placeholder="sessions@yourdomain.com"/></label><label className="wb-label">Business mailing address<input value={settings.postalAddress} maxLength={400} onChange={e=>onChange({...settings,postalAddress:e.target.value})} placeholder="Shown in the email footer"/></label></div>
   {settings.enabled&&!settings.postalAddress.trim()&&<p className="ws-hint">Email waits until you add your business mailing address and save. Texts can run independently.</p>}
  </section>
  <section className="ws-card"><div className="ws-card-heading"><div><h2>One link. The right next step.</h2><p>Every link checks their progress again when opened.</p></div></div><div className="ws-followup-journey"><div><span>01</span><b>Left early</b><p>Resume the saved session that day.</p></div><div><span>02</span><b>Finished watching</b><p>Go to express checkout for {settings.routing.checkoutWindowHours} hours after finishing.</p></div><div><span>03</span><b>Still deciding</b><p>Return to the same webinar, using Day or Night automatically. Paid buyers continue to VIP.</p></div></div>
   <label className="wb-check"><input type="checkbox" checked={settings.smartFollowups} onChange={e=>onChange({...settings,smartFollowups:e.target.checked})}/><span>Automatically personalize email copy</span></label><p className="ws-hint">Uses their first name, actual progress and next step. Texts are always personalized. No artificial deadlines.</p>
  </section>
  <section className="ws-card"><div className="ws-card-heading"><div><h2>A light follow-up sequence</h2><p>Up to three emails and two texts. No more than two messages in 24 hours.</p></div></div><ol className="ws-followup-sequence">{['20 min · Email','90 min · Text','24 hr · Email','48 hr · Text','72 hr · Email'].map(label=><li key={label}>{label}</li>)}</ol><p className="ws-hint">Timing starts at opt-in. Sends wait for 15 minutes of inactivity and 9 AM–8 PM in the viewer’s local time. Refreshing or entering details again never restarts the sequence.</p>
   {stats?<div className="ws-followup-stats">{[['Emails sent',stats.emailSent],['Texts sent',stats.textsSent],['Queued',stats.pending],['Needs review',stats.needsReview]].map(([label,value])=><div key={label}><strong>{Number(value).toLocaleString()}</strong><span>{label}</span></div>)}</div>:<p className="ws-hint">Delivery totals are temporarily unavailable.</p>}
  </section>
  <details className="ws-card"><summary>Custom email copy</summary><p className="ws-hint">Turn off automatic email copy to use these templates. Available fields: {'{{first_name}}'}, {'{{webinar}}'}, {'{{watch_time}}'} and {'{{next_step}}'}. The smart link and unsubscribe footer are always added.</p>{settings.subjects.map((subject,n)=><div key={n} className="ws-followup-template"><span className="wb-eyebrow">EMAIL {n+1}</span><label className="wb-label">Subject<input maxLength={150} value={subject} onChange={e=>onChange({...settings,subjects:settings.subjects.map((s,i)=>i===n?e.target.value:s)})}/></label><label className="wb-label">Message<textarea rows={3} maxLength={2000} value={settings.messages[n]} onChange={e=>onChange({...settings,messages:settings.messages.map((s,i)=>i===n?e.target.value:s)})}/></label></div>)}</details>
  <button className="wb-primary" disabled={busy} onClick={onSave}><Save size={16}/>{busy?'Saving…':'Save follow-ups'}</button>
 </div>;
}
