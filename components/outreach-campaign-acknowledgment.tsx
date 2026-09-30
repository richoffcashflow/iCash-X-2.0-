'use client';
import {useEffect, useReducer, useRef} from 'react';
import {canSaveCampaign, hasCurrentCampaignAcknowledgment, initialOutreachCampaignState, outreachCampaignReducer, parseCampaignStatus} from './outreach-campaign-state';

const endpoint = '/api/work/outreach-campaign';
export function OutreachCampaignAcknowledgment() {
  const [state, dispatch] = useReducer(outreachCampaignReducer, initialOutreachCampaignState);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  async function load() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    dispatch({type: 'loading'});
    try {
      const response = await fetch(endpoint, {cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Could not load campaign status.');
      if (!controller.signal.aborted) dispatch({type: 'loaded', status: parseCampaignStatus(data)});
    } catch (error) {
      if (!controller.signal.aborted) dispatch({type: 'error', error: error instanceof Error ? error.message : 'Could not load campaign status.'});
    }
  }
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, []);
  async function save() {
    if (saving.current || !canSaveCampaign(state) || !state.status) return;
    saving.current = true;
    const version = state.status.policy.version;
    dispatch({type: 'saving'});
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        body: JSON.stringify({accepted: true, version, mode: 'sms_inbound'}),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 409) {
        dispatch({type: 'error', error: 'The campaign acknowledgment changed. Refresh and review the latest text before saving again.'});
        return;
      }
      if (!response.ok) throw Error(data.error || 'Could not save the campaign acknowledgment.');
      // Verify persisted server state; a successful click is never evidence of acceptance.
      await load();
    } catch (error) {
      if (!controller.signal.aborted) dispatch({type: 'error', error: `${error instanceof Error ? error.message : 'Could not confirm the save.'} Refresh to check the saved status before trying again.`});
    } finally {saving.current = false;}
  }
  const status = state.status;
  const current = hasCurrentCampaignAcknowledgment(status);
  const recorded = current && status?.configured;
  const busy = state.phase === 'loading' || state.phase === 'saving';
  return <section className="space-y-3 rounded-2xl border p-4 text-sm" aria-labelledby="outreach-campaign-heading" aria-busy={busy}>
    <h3 id="outreach-campaign-heading" className="font-semibold">SMS-to-inbound campaign</h3>
    <p>Ask about interest in a cash offer by permitted SMS. After a positive reply, invite the recipient to call your AI assistant.</p>
    {busy && <p role="status">{state.phase === 'saving' ? 'Saving your acknowledgment…' : 'Checking saved campaign status…'}</p>}
    {status && <>
      <p id="outreach-campaign-policy">{status.policy.text}</p>
      <p className="text-muted-foreground">Version {status.policy.version}</p>
      {state.phase === 'ready' && <p role="status">{recorded
        ? `Acknowledgment saved${status.acknowledgment ? ` on ${new Date(status.acknowledgment.acceptedAt).toLocaleString()}` : ''}. ${!status.released ? 'Awaiting campaign release. Saving this acknowledgment does not release the campaign or start outreach.' : status.liveWorkReady ? 'Server setup checks are ready. This does not mean the bot is running.' : 'Pending setup: required evidence or provider checks still keep outreach paused.'}`
        : current ? 'Acknowledgment recorded. Save below to select the SMS-to-inbound campaign.'
        : status.acknowledgment ? 'A previous version was acknowledged. Review and accept this version to continue.' : 'Review and acknowledge before campaign activation.'}</p>}
      {state.phase === 'ready' && !recorded && !status.liveWorkReady && <p>Pending setup: required evidence or provider checks still keep outreach paused.</p>}
      {!recorded && <>
        <label className="flex items-start gap-2" htmlFor="outreach-campaign-accept">
          <input id="outreach-campaign-accept" type="checkbox" className="mt-1" checked={state.checked} disabled={state.phase !== 'ready'} aria-describedby="outreach-campaign-policy outreach-campaign-safety" onChange={event => dispatch({type: 'checked', checked: event.target.checked})}/>
          <span>I have read and acknowledge the campaign responsibilities above.</span>
        </label>
        <button type="button" className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={!canSaveCampaign(state)} onClick={() => void save()}>Save SMS-to-inbound campaign</button>
      </>}
    </>}
    <p id="outreach-campaign-safety" className="text-muted-foreground">Saving records your acknowledgment only. It does not start outreach, resume your bot, charge your account, or establish a recipient’s consent.</p>
    {state.error && <p role="alert">{state.error}</p>}
    <button type="button" className="underline" disabled={busy} onClick={() => void load()}>Refresh campaign status</button>
  </section>;
}
