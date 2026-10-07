'use client';
import {DateTimeInput} from '@/components/date-time-input';
import {Clock, Plus, Trash2} from 'lucide-react';
import {WebinarTimeInput} from '@/components/webinar-time-input';
import {formatWatchTime, webinarPitchAt, type Webinar} from '@/lib/webinar-policy';
import {newWebinarTimer, type WebinarTimer} from '@/lib/webinar-timers';

function localDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function WebinarTimersEditor({webinar, onChange}: {webinar: Webinar; onChange: (patch: Partial<Webinar>) => void}) {
  const timers = webinar.timers ?? [];
  const edit = (id: string, patch: Partial<WebinarTimer>) => onChange({timers: timers.map(timer => timer.id === id ? {...timer, ...patch} : timer)});
  return <div className="ws-timers-editor">
    <div className="ws-section-intro"><div><h2>Put a countdown at the right moment</h2><p>Choose when it appears and what viewers see when time runs out.</p></div><button className="wb-primary" disabled={timers.length >= 8} onClick={() => onChange({timers: [...timers, newWebinarTimer(crypto.randomUUID(), webinarPitchAt(webinar))]})}><Plus size={17}/>Add timer</button></div>
    {timers.length === 0 && <section className="ws-card ws-timer-empty"><Clock size={28}/><h3>Your first timer starts here</h3><p>Add a countdown above your offer or below the video. Each recording can have up to 8 timers.</p></section>}
    {timers.map((timer, index) => <section className="ws-card ws-timer-editor" key={timer.id}>
      <div className="ws-card-heading"><div><span className="wb-eyebrow">TIMER {index + 1}</span><h2>{timer.label || 'New timer'}</h2></div><button className="wb-icon" aria-label={`Remove timer ${index + 1}`} onClick={() => onChange({timers: timers.filter(item => item.id !== timer.id)})}><Trash2 size={17}/></button></div>
      <label className="wb-label">Message above the countdown<input value={timer.label} maxLength={100} onChange={event => edit(timer.id, {label: event.target.value})} placeholder="Time remaining"/></label>
      <div className="ws-fields"><WebinarTimeInput label={`Timer ${index + 1} appears at`} value={timer.at} max={webinar.durationSeconds} onChange={at => edit(timer.id, {at})}/><label className="wb-label">Where it appears<select value={timer.placement} onChange={event => edit(timer.id, {placement: event.target.value as WebinarTimer['placement']})}><option value="offer">Above the offer</option><option value="video">Below the video</option></select></label></div>
      <label className="wb-label">Timer type<select value={timer.mode} onChange={event => edit(timer.id, {mode: event.target.value as WebinarTimer['mode']})}><option value="duration">Countdown · starts when this viewer reaches the moment</option><option value="deadline">Fixed date and time · same deadline for everyone</option></select></label>
      {timer.mode === 'duration' ? <><WebinarTimeInput label={`Timer ${index + 1} duration`} value={timer.durationSeconds} max={604800} onChange={durationSeconds => edit(timer.id, {durationSeconds: Math.max(1, durationSeconds)})}/><p className="ws-hint">Starts once. Keeps counting while they pause, refresh or leave, and remembers the original deadline when they return.</p></> : <DateTimeInput className="wb-label" label="Ends on" hint="your local time" required value={localDate(timer.endsAt)} onChange={event => {const date = new Date(event.target.value); edit(timer.id, {endsAt: Number.isFinite(date.getTime()) ? date.toISOString() : null});}}/>}
      <details className="ws-advanced"><summary>When the timer ends</summary><label className="wb-label">At zero<select value={timer.onExpire} onChange={event => edit(timer.id, {onExpire: event.target.value as WebinarTimer['onExpire']})}><option value="hide">Hide the timer</option><option value="message">Show a message</option></select></label>{timer.onExpire === 'message' && <label className="wb-label">Finished message<input value={timer.expiredMessage} maxLength={150} onChange={event => edit(timer.id, {expiredMessage: event.target.value})}/></label>}</details>
      <div className="wb-timer ws-timer-preview" aria-label="Timer appearance preview"><Clock size={18}/><span>{timer.label || 'Time remaining'}</span><strong>{timer.mode === 'duration' ? formatWatchTime(timer.durationSeconds) : '09:42'}</strong></div>
    </section>)}
    <p className="ws-hint">Timers change the room display. To close an offer, set its actual closing date in Offers. Day and Night have their own timers.</p>
  </div>;
}
