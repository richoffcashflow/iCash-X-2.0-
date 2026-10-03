/** Presentation state only. The server owns channel choices and eligibility. */
export type OutreachMode = 'outbound_voice_sms' | 'sms_inbound';
export type OutreachCampaignStatus = {
  policy: {version: string; text: string; mode: 'outreach_channels'};
  mode: OutreachMode | null;
  principal: string | null;
  acknowledgment: {acceptedAt: string; version: string} | null;
  configured: boolean;
  released: boolean;
  liveWorkReady: boolean;
  smsChannelEnabled?: boolean;
};
export type OutreachCampaignState = {
  status: OutreachCampaignStatus | null;
  selectedMode: OutreachMode | null;
  checked: boolean;
  phase: 'loading' | 'ready' | 'saving' | 'error';
  error: string;
};
export const initialOutreachCampaignState: OutreachCampaignState = {status: null, selectedMode: null, checked: false, phase: 'loading', error: ''};
export type OutreachCampaignEvent =
  | {type: 'loading'} | {type: 'loaded'; status: OutreachCampaignStatus}
  | {type: 'mode'; mode: OutreachMode} | {type: 'checked'; checked: boolean} | {type: 'saving'} | {type: 'error'; error: string};
export function hasCurrentCampaignAcknowledgment(status: OutreachCampaignStatus | null) {
  return !!status?.acknowledgment && status.acknowledgment.version === status.policy.version;
}
export function canSaveCampaign(state: OutreachCampaignState) {
  return state.phase === 'ready' && state.checked && !!state.selectedMode && !!state.status?.principal &&
    !(state.status.released && state.status.configured && hasCurrentCampaignAcknowledgment(state.status) && state.selectedMode === state.status.mode);
}
export function outreachCampaignReducer(state: OutreachCampaignState, event: OutreachCampaignEvent): OutreachCampaignState {
  switch (event.type) {
    case 'loading': return {...state, checked: false, phase: 'loading', error: ''};
    case 'loaded': return {status: event.status, selectedMode: event.status.mode, checked: false, phase: 'ready', error: ''};
    case 'mode': return state.phase === 'ready' ? {...state, selectedMode: event.mode, checked: false} : state;
    case 'checked': return state.phase === 'ready' ? {...state, checked: event.checked} : state;
    case 'saving': return canSaveCampaign(state) ? {...state, checked: false, phase: 'saving', error: ''} : state;
    case 'error': return {...state, checked: false, phase: 'error', error: event.error};
  }
}
export function parseCampaignStatus(value: unknown): OutreachCampaignStatus {
  const data = value as OutreachCampaignStatus | null;
  if (!data || data.policy?.mode !== 'outreach_channels' || typeof data.policy.version !== 'string' || !data.policy.version ||
      typeof data.policy.text !== 'string' || !data.policy.text || typeof data.configured !== 'boolean' ||
      ![null, 'outbound_voice_sms', 'sms_inbound'].includes(data.mode) || (data.principal !== null && typeof data.principal !== 'string') ||
      typeof data.released !== 'boolean' || typeof data.liveWorkReady !== 'boolean' || (data.smsChannelEnabled !== undefined && typeof data.smsChannelEnabled !== 'boolean') || (data.acknowledgment !== null &&
      (!data.acknowledgment || typeof data.acknowledgment.version !== 'string' ||
       typeof data.acknowledgment.acceptedAt !== 'string' || !Number.isFinite(Date.parse(data.acknowledgment.acceptedAt))))) {
    throw Error('Could not verify campaign status. Refresh before continuing.');
  }
  return data;
}
