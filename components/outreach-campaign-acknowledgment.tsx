'use client';
import {useEffect, useReducer, useRef} from 'react';
import {canSaveCampaign, hasCurrentCampaignAcknowledgment, initialOutreachCampaignState, outreachCampaignReducer, parseCampaignStatus,type OutreachCampaignStatus} from './outreach-campaign-state';

const endpoint = '/api/work/outreach-campaign';
export function OutreachCampaignAcknowledgment({onStatus,statusOnly=false}:{onStatus?:(status:OutreachCampaignStatus|null)=>void;statusOnly?:boolean} = {}) {
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
        body: JSON.stringify({accepted: true, version, mode: state.selectedMode}),
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
  const recorded = current && status?.configured && status.released;
  const busy = state.phase === 'loading' || state.phase === 'saving';
  const choiceChanged = state.selectedMode !== status?.mode;
  if(statusOnly)return null;
  return <details id="outreach-campaign-details" className="workspace-campaign-settings">
    <summary><span>Outreach channels</span><small>{state.error?'Status unavailable':busy?'Checking…':recorded?'Configured':'Choose channels'}</small></summary>
    <section className="campaign-settings-content space-y-3 text-sm" aria-labelledby="outreach-campaign-heading" aria-busy={busy}>
    <h3 id="outreach-campaign-heading" className="font-semibold">Choose your outreach channels</h3>
    {status?.principal ? <p>Sending business: {status.principal}</p> : <p>Add your legal name or company in your account before saving channels.</p>}
    {busy && <p role="status">{state.phase === 'saving' ? 'Saving your channel choice…' : 'Checking saved campaign status…'}</p>}
    {state.phase === 'ready' && status && <p role="status">{recorded
      ? status.mode === 'outbound_voice_sms' ? 'Outbound AI calls and SMS selected. Contact, provider, timing and budget checks still apply.' : 'SMS with inbound-call invitations selected. Outbound AI calls are off.'
      : 'Review and save your channel choice. No operator release is needed for this selection.'}</p>}
    <fieldset disabled={state.phase !== 'ready'} className="space-y-2">
      <legend className="font-medium">Outreach mode</legend>
      <label className="flex items-start gap-2"><input type="radio" name="outreach-mode" value="outbound_voice_sms" checked={state.selectedMode === 'outbound_voice_sms'} onChange={() => dispatch({type:'mode', mode:'outbound_voice_sms'})}/><span>Outbound AI calls + SMS<br/><small>Your bot may initiate eligible AI calls and SMS. Calls start only during daytime hours. This choice does not enable inbound-call invitations.</small></span></label>
      <label className="flex items-start gap-2"><input type="radio" name="outreach-mode" value="sms_inbound" checked={state.selectedMode === 'sms_inbound'} onChange={() => dispatch({type:'mode', mode:'sms_inbound'})}/><span>SMS + inbound-call invitations<br/><small>After eligible SMS and a positive reply, invite the recipient to call your AI assistant. Outbound AI calls stay off.</small></span></label>
    </fieldset>
    {status && <>
      <p id="outreach-campaign-policy">{status.policy.text}</p>
      <p className="text-muted-foreground">Version {status.policy.version}</p>
      {state.phase === 'ready' && current && status.acknowledgment && <p>Responsibilities acknowledged on {new Date(status.acknowledgment.acceptedAt).toLocaleString('en-US',{hour12:true})}.</p>}
      {(!recorded || choiceChanged) && <>
        <label className="flex items-start gap-2" htmlFor="outreach-campaign-accept">
          <input id="outreach-campaign-accept" type="checkbox" className="mt-1" checked={state.checked} disabled={state.phase !== 'ready' || !state.selectedMode || !status.principal} aria-describedby="outreach-campaign-policy outreach-campaign-safety" onChange={event => dispatch({type: 'checked', checked: event.target.checked})}/>
          <span>I choose these channels for my account and acknowledge the responsibilities above.</span>
        </label>
        <button type="button" className="rounded-lg border px-3 py-2 disabled:opacity-50" disabled={!canSaveCampaign(state)} onClick={() => void save()}>Save outreach channels</button>
      </>}
    </>}
    <p id="outreach-campaign-safety" className="text-muted-foreground">Saving does not start outreach, resume your bot, charge your account, or establish a recipient’s consent. Ready setup does not mean your bot is running. Use Start separately when your account is ready.</p>
    {state.error && <p role="alert">{state.error}</p>}
    <button type="button" className="underline" disabled={busy} onClick={() => void load()}>Refresh campaign status</button>
  </section></details>;
}
