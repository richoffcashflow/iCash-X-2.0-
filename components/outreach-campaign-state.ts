/** Presentation state only. The server owns acknowledgment and campaign eligibility. */
export type OutreachCampaignStatus = {
  policy: {version: string; text: string; mode: 'sms_inbound'};
  acknowledgment: {acceptedAt: string; version: string} | null;
  configured: boolean;
  released: boolean;
  liveWorkReady: boolean;
  smsChannelEnabled?: boolean;
};
export type OutreachCampaignState = {
  status: OutreachCampaignStatus | null;
  checked: boolean;
  phase: 'loading' | 'ready' | 'saving' | 'error';
  error: string;
};
export const initialOutreachCampaignState: OutreachCampaignState = {status: null, checked: false, phase: 'loading', error: ''};
export type OutreachCampaignEvent =
  | {type: 'loading'} | {type: 'loaded'; status: OutreachCampaignStatus}
  | {type: 'checked'; checked: boolean} | {type: 'saving'} | {type: 'error'; error: string};
export function hasCurrentCampaignAcknowledgment(status: OutreachCampaignStatus | null) {
  return !!status?.acknowledgment && status.acknowledgment.version === status.policy.version;
}
export function canSaveCampaign(state: OutreachCampaignState) {
  return state.phase === 'ready' && state.checked && !!state.status &&
    !(state.status.configured && hasCurrentCampaignAcknowledgment(state.status));
}
export function outreachCampaignReducer(state: OutreachCampaignState, event: OutreachCampaignEvent): OutreachCampaignState {
  switch (event.type) {
    case 'loading': return {...state, checked: false, phase: 'loading', error: ''};
    case 'loaded': return {status: event.status, checked: false, phase: 'ready', error: ''};
    case 'checked': return state.phase === 'ready' ? {...state, checked: event.checked} : state;
    case 'saving': return canSaveCampaign(state) ? {...state, checked: false, phase: 'saving', error: ''} : state;
    case 'error': return {...state, checked: false, phase: 'error', error: event.error};
  }
}
export function parseCampaignStatus(value: unknown): OutreachCampaignStatus {
  const data = value as OutreachCampaignStatus | null;
  if (!data || data.policy?.mode !== 'sms_inbound' || typeof data.policy.version !== 'string' || !data.policy.version ||
      typeof data.policy.text !== 'string' || !data.policy.text || typeof data.configured !== 'boolean' ||
      typeof data.released !== 'boolean' || typeof data.liveWorkReady !== 'boolean' || (data.smsChannelEnabled !== undefined && typeof data.smsChannelEnabled !== 'boolean') || (data.acknowledgment !== null &&
      (!data.acknowledgment || typeof data.acknowledgment.version !== 'string' ||
       typeof data.acknowledgment.acceptedAt !== 'string' || !Number.isFinite(Date.parse(data.acknowledgment.acceptedAt))))) {
    throw Error('Could not verify campaign status. Refresh before continuing.');
  }
  return data;
}
