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
type RecordingSource = 'outbound' | 'reception';
type RecordingReceipt = {id: string | null; status: RecordingStatus; durationSeconds: number | null; audioExpiresAt: string | null};
type ReceiptResult = RecordingReceipt | {status: 'not_recorded'};
type ReceiptState = {conversationId: string; source: RecordingSource; phase: 'loading' | 'error' | 'ready'; receipt?: ReceiptResult};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readReceipt(value: unknown): ReceiptResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid recording receipt');
  const r = value as Record<string, unknown>;
  if (r.status === 'not_recorded') return {status: 'not_recorded'};
  const status = ['reserved', 'setup_pending'].includes(String(r.status)) ? 'processing' : r.status;
  if (typeof status !== 'string' || !Object.hasOwn(recordingStates, status) ||
    !(r.id === null || typeof r.id === 'string' && uuid.test(r.id)) ||
    status === 'available' && r.id === null ||
    !(r.durationSeconds === null || typeof r.durationSeconds === 'number' && Number.isFinite(r.durationSeconds) && r.durationSeconds >= 0) ||
    !(r.audioExpiresAt === null || typeof r.audioExpiresAt === 'string' && Number.isFinite(Date.parse(r.audioExpiresAt)))) throw Error('Invalid recording receipt');
  return {id:r.id as string|null, status:status === 'available' && r.audioAvailable === false ? 'expired' : status as RecordingStatus,
    durationSeconds:r.durationSeconds as number|null, audioExpiresAt:r.audioExpiresAt as string|null};
}

function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not reported';
  return new Date(value).toLocaleString('en-US',{hour12:true});
}

function ReceiptDetails({receipt, source='outbound'}: {receipt: ReceiptResult; source?: RecordingSource}) {
  return <>
    {receipt.status !== 'available' && <p>{recordingStates[receipt.status]}</p>}
    {receipt.status === 'available' && 'id' in receipt && receipt.id && <>
      <audio key={receipt.id} controls preload="none" aria-label="Call recording"
        src={`/api/work/${source === 'reception' ? 'reception-recording' : 'recording'}/audio?id=${encodeURIComponent(receipt.id)}`} style={{width:'100%'}}>
        Your browser does not support audio playback.
      </audio>
      {receipt.audioExpiresAt && <small>Available until {dateLabel(receipt.audioExpiresAt)}.</small>}
    </>}
  </>;
}

/** Show the player with the call; audio downloads only when the user presses play. */
export function CallRecording({conversationId, source='outbound'}: {conversationId: string; source?: RecordingSource}) {
  const [state, setState] = useState<ReceiptState>({conversationId, source, phase: 'loading'});
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    running.current = true;
    setState({conversationId, source, phase: 'loading'});
    void fetch(`/api/work/${source === 'reception' ? 'reception-recording?id=' : 'recording?conversationId='}${encodeURIComponent(conversationId)}`, {
      signal: controller.signal, cache: 'no-store', credentials: 'same-origin',
    }).then(async response => {
      if (response.status === 404) return {status: 'not_recorded'} as const;
      if (!response.ok) throw Error('Recording receipt unavailable');
      return readReceipt(await response.json());
    }).then(receipt => {
      if (!controller.signal.aborted) setState({conversationId, source, phase: 'ready', receipt});
    }).catch(() => {
      if (!controller.signal.aborted) setState({conversationId, source, phase: 'error'});
    }).finally(() => {
      if (!controller.signal.aborted) running.current = false;
    });
    return () => {controller.abort(); running.current = false;};
  }, [conversationId, source, attempt]);

  function retry() {
    if (running.current) return;
    running.current = true;
    setState({conversationId, source, phase: 'loading'});
    setAttempt(value => value + 1);
  }

  // Never render a previous conversation's audio, even before the new effect runs.
  const current = state.conversationId === conversationId && state.source === source ? state : {phase: 'loading' as const};
  return <section className="conversation-call-player" aria-label="Call recording">
    <h4>Call recording</h4>
    {current.phase === 'loading' && <p role="status">Loading recording…</p>}
    {current.phase === 'error' && <>
      <p role="alert">Could not load this recording.</p>
      <button type="button" onClick={retry}>Retry recording</button>
    </>}
    {current.phase === 'ready' && 'receipt' in current && current.receipt && <>
      <ReceiptDetails receipt={current.receipt} source={source}/>
      {['consent_pending', 'starting', 'recording', 'stopping', 'processing'].includes(current.receipt.status) &&
        <button type="button" onClick={retry}>Refresh recording</button>}
    </>}
  </section>;
}
