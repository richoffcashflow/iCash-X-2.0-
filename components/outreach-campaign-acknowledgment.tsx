'use client';
import {useEffect, useReducer, useRef} from 'react';
import {canSaveCampaign, hasCurrentCampaignAcknowledgment, initialOutreachCampaignState, outreachCampaignReducer, parseCampaignStatus,type OutreachCampaignStatus} from './outreach-campaign-state';

const endpoint = '/api/work/outreach-campaign';
export function OutreachCampaignAcknowledgment({onStatus}:{onStatus?:(status:OutreachCampaignStatus|null)=>void} = {}) {
  const [state, dispatch] = useReducer(outreachCampaignReducer, initialOutreachCampaignState);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  async function load() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    dispatch({type: 'loading'});onStatus?.(null);
    try {
      const response = await fetch(endpoint, {cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Could not load campaign status.');
      if (!controller.signal.aborted) {const status=parseCampaignStatus(data);dispatch({type: 'loaded', status});onStatus?.(status);}
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
    dispatch({type: 'saving'});onStatus?.(null);
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
  return <details id="outreach-campaign-details" className="workspace-campaign-settings">
    <summary><span>Campaign setup</span><small>{state.error?'Status unavailable':busy?'Checking…':recorded?status?.released?'Configured':'Awaiting release':'Review needed'}</small></summary>
    <section className="campaign-settings-content space-y-3 text-sm" aria-labelledby="outreach-campaign-heading" aria-busy={busy}>
    <h3 id="outreach-campaign-heading" className="font-semibold">SMS-to-inbound campaign</h3>
    {status?.smsChannelEnabled && !status.liveWorkReady && <p>SMS channel enabled. Campaign release and your Run control still apply; AI calls remain held.</p>}
    {busy && <p role="status">{state.phase === 'saving' ? 'Saving your acknowledgment…' : 'Checking saved campaign status…'}</p>}
    {state.phase === 'ready' && status && <p role="status">{recorded
      ? !status.released ? 'Awaiting campaign release.' : status.liveWorkReady ? 'Setup checks ready · per-contact checks still apply.' : status.smsChannelEnabled ? 'SMS enabled · per-contact checks still apply. AI call invitations are held.' : 'Setup pending · outreach paused.'
      : current ? 'Select your campaign to continue.' : status.acknowledgment ? 'Updated acknowledgment needed · outreach paused.' : 'Campaign acknowledgment needed · outreach paused.'}</p>}
    <details className="space-y-3">
      <summary className="cursor-pointer font-medium">{recorded?'Campaign details':'Review campaign responsibilities'}</summary>
      <p>Ask about interest in a cash offer by permitted SMS. After a positive reply, invite the recipient to call your AI assistant.</p>
      {status && <>
        <p id="outreach-campaign-policy">{status.policy.text}</p>
        <p className="text-muted-foreground">Version {status.policy.version}</p>
        {state.phase === 'ready' && current && status.acknowledgment && <p>Acknowledgment saved on {new Date(status.acknowledgment.acceptedAt).toLocaleString()}.</p>}
        {!recorded && <>
          <label className="flex items-start gap-2" htmlFor="outreach-campaign-accept">
            <input id="outreach-campaign-accept" type="checkbox" className="mt-1" checked={state.checked} disabled={state.phase !== 'ready'} aria-describedby="outreach-campaign-policy outreach-campaign-safety" onChange={event => dispatch({type: 'checked', checked: event.target.checked})}/>
            <span>I have read and acknowledge the campaign responsibilities above.</span>
          </label>
          <button type="button" className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={!canSaveCampaign(state)} onClick={() => void save()}>Save SMS-to-inbound campaign</button>
        </>}
      </>}
      <p id="outreach-campaign-safety" className="text-muted-foreground">Saving records your acknowledgment only. It does not start outreach, resume your bot, charge your account, or establish a recipient’s consent. Ready setup does not mean your bot is running. Contact operating checks do not independently verify recipient consent.</p>
    </details>
    {state.error && <p role="alert">{state.error}</p>}
    <button type="button" className="underline" disabled={busy} onClick={() => void load()}>Refresh campaign status</button>
  </section></details>;
}
