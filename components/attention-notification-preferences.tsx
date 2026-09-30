'use client';
import {useEffect, useState} from 'react';
import {attentionCategories, attentionConsentVersion, type AttentionCategory} from '@/lib/attention-notifications';
type Preferences = {enabled: boolean; available: boolean; categories: AttentionCategory[]; suppressed: boolean; email?: string};
const labels: Record<AttentionCategory, string> = {needs_you: 'Requests that need me', signatures: 'Signatures to review', callbacks: 'Callbacks needing attention', closing: 'Title tasks and closing deadlines'};
export function AttentionNotificationPreferences() {
  const [saved, setSaved] = useState<Preferences | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [categories, setCategories] = useState<AttentionCategory[]>([...attentionCategories]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch('/api/notifications/preferences', {cache: 'no-store', signal: controller.signal}).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? 'Could not load email alerts.');
      if (controller.signal.aborted) return;
      setSaved(data); setEnabled(data.enabled); setCategories(data.categories); setConsent(data.enabled);
    }).catch(error => {if (!controller.signal.aborted) setError(error.message ?? 'Could not load email alerts.');});
    return () => controller.abort();
  }, [retry]);
  async function save(turnOff = false) {
    if (busy || !saved) return;
    setBusy(true); setError(''); setMessage('');
    const nextEnabled = turnOff ? false : enabled;
    try {
      const response = await fetch('/api/notifications/preferences', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({enabled: nextEnabled, categories, ...(nextEnabled ? {consentVersion: attentionConsentVersion} : {})})});
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? 'Could not save email alerts.');
      setSaved({...saved, ...data.preferences}); setEnabled(nextEnabled); setConsent(nextEnabled);
      setMessage(nextEnabled ? 'Email alerts are on. We’ll send them only to your verified account email.' : 'Email alerts are off. Your tasks remain in the workspace.');
    } catch (error) {setError(error instanceof Error ? error.message : 'Could not save email alerts.');}
    finally {setBusy(false);}
  }
  return <section className="space-y-3 rounded-2xl border p-4" aria-labelledby="attention-email-heading">
    <h3 id="attention-email-heading" className="font-semibold">Email alerts</h3>
    <p className="text-sm text-muted-foreground">Get a private link when a saved task needs you. Up to 3 emails per 24 hours, at least 1 hour apart. Keep checking your workspace for time-sensitive work.</p>
    {!saved && !error && <p className="text-sm" role="status">Loading your preference…</p>}
    {saved && <>
      {saved.email && <p className="break-all text-sm">Send to your verified account email: {saved.email}</p>}
      {!saved.available && <p className="text-sm text-muted-foreground">Email delivery is not available yet. Review Needs you in your workspace.</p>}
      {saved.suppressed && <p className="text-sm">Delivery is paused after an email delivery problem or spam report. Contact support before turning alerts back on.</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={busy || !saved.available || saved.suppressed} onChange={event => {setEnabled(event.target.checked); setMessage(''); if (!event.target.checked) setConsent(false);}} className="mt-1"/>Email me when my attention is needed</label>
      {enabled && <fieldset className="space-y-2" disabled={busy || !saved.available || saved.suppressed}><legend className="mb-2 text-sm font-medium">Which tasks?</legend>
        {attentionCategories.map(category => <label key={category} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={categories.includes(category)} onChange={event => setCategories(current => event.target.checked ? [...current, category] : current.filter(value => value !== category))} className="mt-1"/>{labels[category]}</label>)}
        <label className="flex items-start gap-2 pt-2 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1"/>I agree to receive ongoing emails about these tasks at my verified account email. I can turn them off here or from any alert.</label>
      </fieldset>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={busy || (enabled && (!saved.available || saved.suppressed || !consent || !categories.length))} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save email preferences'}</button>
        {saved.enabled && <button type="button" disabled={busy} onClick={() => void save(true)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Turn off all email alerts</button>}
      </div>
    </>}
    {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p>{!saved && <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button>}</div>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
