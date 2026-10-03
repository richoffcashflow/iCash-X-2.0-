'use client';

import {useEffect, useRef, useState} from 'react';

const recordingStates = {
  not_recorded: 'This call was not recorded.',
  consent_pending: 'Recording consent is pending. Audio is not available.',
  declined: 'Recording was declined. Audio is not available.',
  starting: 'Recording is starting. Audio is not available yet.',
  recording: 'Recording is in progress. Audio is not available yet.',
  stopping: 'Recording is stopping. Audio is not available yet.',
  processing: 'The recording is processing. Audio is not available yet.',
  available: 'Recording available.',
  absent: 'No audio was received for this recording.',
  expired: 'The audio retention period has ended. Audio is no longer available.',
  deletion_pending: 'Audio deletion is pending. Playback is unavailable.',
  deleted: 'The audio has been deleted.',
  failed: 'The recording failed. Audio is not available.',
} as const;

type RecordingStatus = keyof typeof recordingStates;
type CostBasis = 'observed' | 'estimated' | 'not_applicable' | 'pending';
type RecordingReceipt = {
  id: string | null;
  status: RecordingStatus;
  durationSeconds: number | null;
  audioExpiresAt: string | null;
  providerReceipt: null | {provider: 'Twilio'; recordingSid: string; startAt: string | null; endAt: string | null};
  costs: {
    status: 'pending' | 'estimated' | 'verified';
    holdCents: number;
    customerChargeCents: number | null;
    items: {label: string; basis: CostBasis; amountMicros: number | null}[];
  };
};
type ReceiptResult = RecordingReceipt | {status: 'not_recorded'};
type ReceiptState = {conversationId: string; phase: 'loading' | 'error' | 'ready'; receipt?: ReceiptResult};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableNumber = (value: unknown) => value === null || finite(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function readReceipt(value: unknown): ReceiptResult {
  if (!object(value) || typeof value.status !== 'string' || !Object.hasOwn(recordingStates, value.status)) throw Error('Invalid recording receipt');
  // Disabled/legacy calls may return only this status, without invented zero costs.
  if (value.status === 'not_recorded' && !('costs' in value)) return {status: 'not_recorded'};
  const costs = value.costs;
  const provider = value.providerReceipt;
  if (!(value.id === null || (typeof value.id === 'string' && uuid.test(value.id))) ||
    (value.status === 'available' && value.id === null) ||
    !nullableNumber(value.durationSeconds) || (finite(value.durationSeconds) && value.durationSeconds < 0) ||
    !nullableString(value.audioExpiresAt) ||
    !(provider === null || (object(provider) && provider.provider === 'Twilio' &&
      typeof provider.recordingSid === 'string' && /^RE[0-9a-f]{32}$/i.test(provider.recordingSid) &&
      nullableString(provider.startAt) && nullableString(provider.endAt))) ||
    !object(costs) || !['pending', 'estimated', 'verified'].includes(String(costs.status)) ||
    !finite(costs.holdCents) || costs.holdCents < 0 || !nullableNumber(costs.customerChargeCents) ||
    !Array.isArray(costs.items) || !costs.items.every(item => object(item) && typeof item.label === 'string' &&
      ['observed', 'estimated', 'not_applicable', 'pending'].includes(String(item.basis)) && nullableNumber(item.amountMicros))) {
    throw Error('Invalid recording receipt');
  }
  return value as RecordingReceipt;
}

function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not reported';
  return new Date(value).toLocaleString();
}

function dollars(amount: number, divisor: number) {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: divisor === 1_000_000 ? 6 : 2}).format(amount / divisor);
}

function ReceiptDetails({receipt}: {receipt: ReceiptResult}) {
  if (!('costs' in receipt)) return <p>{recordingStates.not_recorded} A saved transcript may still be available.</p>;
  const costGroups: {basis: CostBasis; title: string}[] = [
    {basis: 'observed', title: 'Raw provider cost observations'},
    {basis: 'estimated', title: 'Estimated provider costs'},
    {basis: 'pending', title: 'Provider costs still pending'},
    {basis: 'not_applicable', title: 'Provider costs not applicable'},
  ];
  return <>
    <p>{recordingStates[receipt.status]}</p>
    <dl>
      <dt>Recording duration</dt><dd>{receipt.durationSeconds === null ? 'Not reported' : `${receipt.durationSeconds} seconds`}</dd>
      <dt>Provider receipt</dt><dd>{receipt.providerReceipt ? `${receipt.providerReceipt.provider} · ${receipt.providerReceipt.recordingSid}` : 'Not available'}</dd>
      {receipt.providerReceipt && <>
        <dt>Recording started</dt><dd>{dateLabel(receipt.providerReceipt.startAt)}</dd>
        <dt>Recording ended</dt><dd>{dateLabel(receipt.providerReceipt.endAt)}</dd>
      </>}
    </dl>
    {receipt.status === 'available' && receipt.id && <audio
      key={receipt.id}
      controls
      preload="none"
      aria-label="Call recording"
      src={`/api/work/recording/audio?id=${encodeURIComponent(receipt.id)}`}
      style={{maxWidth: '100%'}}
    >Your browser does not support audio playback.</audio>}
    <p><small>Audio is retained for 30 days. Transcript retention is separate.{receipt.audioExpiresAt && ` Audio expires: ${dateLabel(receipt.audioExpiresAt)}.`}</small></p>
    <p><small>Anyone who can play audio in a browser can save a copy.</small></p>
    <h4>Call cost receipt</h4>
    <p>Provider cost status: {receipt.costs.status}.</p>
    {costGroups.map(group => {
      const items = receipt.costs.items.filter(item => item.basis === group.basis);
      return items.length > 0 && <div key={group.basis}>
        <strong>{group.title}</strong>
        <ul>{items.map((item, index) => <li key={`${item.label}-${index}`}>
          {item.label}: {item.amountMicros === null ? (item.basis === 'not_applicable' ? 'Not applicable' : 'Not yet reported') : dollars(item.amountMicros, 1_000_000)}
          {item.basis === 'estimated' ? ' (estimate)' : item.basis === 'observed' ? ' (provider observation)' : ''}
        </li>)}</ul>
      </div>;
    })}
    {!receipt.costs.items.length && <p>No provider cost observations have been reported.</p>}
    <p>Reserved maximum: {dollars(receipt.costs.holdCents, 100)}. This reservation is not a charge.</p>
    <p><strong>Settled customer charge: {receipt.costs.customerChargeCents === null ? 'Pending' : dollars(receipt.costs.customerChargeCents, 100)}</strong></p>
    <p><small>A recording documents conversation content. It does not verify provider costs; those require separate provider cost records.</small></p>
  </>;
}

/** Mount only inside an expanded completed-call transcript. Closing unmounts and aborts. */
export function CallRecording({conversationId}: {conversationId: string}) {
  const [state, setState] = useState<ReceiptState>({conversationId, phase: 'loading'});
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    running.current = true;
    setState({conversationId, phase: 'loading'});
    void fetch(`/api/work/recording?conversationId=${encodeURIComponent(conversationId)}`, {
      signal: controller.signal, cache: 'no-store', credentials: 'same-origin',
    }).then(async response => {
      if (response.status === 404) return {status: 'not_recorded'} as const;
      if (!response.ok) throw Error('Recording receipt unavailable');
      return readReceipt(await response.json());
    }).then(receipt => {
      if (!controller.signal.aborted) setState({conversationId, phase: 'ready', receipt});
    }).catch(() => {
      if (!controller.signal.aborted) setState({conversationId, phase: 'error'});
    }).finally(() => {
      if (!controller.signal.aborted) running.current = false;
    });
    return () => {controller.abort(); running.current = false;};
  }, [conversationId, attempt]);

  function retry() {
    if (running.current) return;
    running.current = true;
    setState({conversationId, phase: 'loading'});
    setAttempt(value => value + 1);
  }

  // Never render a previous conversation's audio, even before the new effect runs.
  const current = state.conversationId === conversationId ? state : {phase: 'loading' as const};
  return <section aria-label="Call recording and cost receipt">
    <h4>Recording receipt</h4>
    {current.phase === 'loading' && <p role="status">Loading recording receipt…</p>}
    {current.phase === 'error' && <>
      <p role="alert">Could not load the recording receipt.</p>
      <button type="button" onClick={retry}>Retry recording receipt</button>
    </>}
    {current.phase === 'ready' && 'receipt' in current && current.receipt && <>
      <ReceiptDetails receipt={current.receipt}/>
      {['consent_pending', 'starting', 'recording', 'stopping', 'processing'].includes(current.receipt.status) &&
        <button type="button" onClick={retry}>Refresh recording receipt</button>}
    </>}
  </section>;
}
