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
export type RecordingSource = 'outbound' | 'reception';
export type RecordingReceipt = {id: string | null; status: RecordingStatus; durationSeconds: number | null; audioExpiresAt: string | null};
export type ReceiptResult = RecordingReceipt | {status: 'not_recorded'};
type ReceiptState = {scope: string; phase: 'loading' | 'error' | 'ready'; receipt?: ReceiptResult};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readReceipt(value: unknown): ReceiptResult {
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

function ReceiptDetails({receipt, source='outbound', playbackAttempt=0, onPlaybackError}: {receipt: ReceiptResult; source?: RecordingSource; playbackAttempt?: number; onPlaybackError?: () => void}) {
  return <>
    {receipt.status !== 'available' && <p>{recordingStates[receipt.status]}</p>}
    {receipt.status === 'available' && 'id' in receipt && receipt.id && <>
      <audio key={`${receipt.id}:${playbackAttempt}`} controls preload="none" aria-label="Call recording" onError={onPlaybackError}
        src={`/api/work/${source === 'reception' ? 'reception-recording' : 'recording'}/audio?id=${encodeURIComponent(receipt.id)}`} style={{width:'100%'}}>
        Your browser does not support audio playback.
      </audio>
      {receipt.audioExpiresAt && <small>Available until {dateLabel(receipt.audioExpiresAt)}.</small>}
    </>}
  </>;
}

/** Audio stays visible independently of the optional transcript. */
export function CallRecording({conversationId, recordingId, source='outbound', receipt, onRefresh}: {
  conversationId?: string; recordingId?: string; source?: RecordingSource;
  receipt?: ReceiptResult; onRefresh?: () => void;
}) {
  const scope = `${source}:${recordingId ?? conversationId ?? ''}`;
  const [state, setState] = useState<ReceiptState>({scope, phase: 'loading'});
  const [attempt, setAttempt] = useState(0);
  const [playbackError, setPlaybackError] = useState('');
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (receipt !== undefined) return;
    const controller = new AbortController();
    running.current = true;
    setState({scope, phase: 'loading'});
    const query = source === 'reception' ? `reception-recording?id=${encodeURIComponent(recordingId ?? conversationId ?? '')}` :
      `recording?${recordingId ? 'id' : 'conversationId'}=${encodeURIComponent(recordingId ?? conversationId ?? '')}`;
    void fetch(`/api/work/${query}`, {
      signal: controller.signal, cache: 'no-store', credentials: 'same-origin',
    }).then(async response => {
      if (response.status === 404) return {status: 'not_recorded'} as const;
      if (!response.ok) throw Error('Recording receipt unavailable');
      return readReceipt(await response.json());
    }).then(result => {
      if (!controller.signal.aborted) setState({scope, phase: 'ready', receipt: result});
    }).catch(() => {
      if (!controller.signal.aborted) setState({scope, phase: 'error'});
    }).finally(() => {
      if (!controller.signal.aborted) running.current = false;
    });
    return () => {controller.abort(); running.current = false;};
  }, [conversationId, recordingId, source, scope, attempt, receipt]);

  function retry() {
    if (receipt !== undefined) {onRefresh?.(); return;}
    if (running.current) return;
    running.current = true;
    setState({scope, phase: 'loading'});
    setAttempt(value => value + 1);
  }

  // A changed property or source must never display the previous call's audio.
  const current = receipt !== undefined ? {phase: 'ready' as const, receipt} : state.scope === scope ? state : {phase: 'loading' as const};
  return <section className="conversation-call-player" aria-label="Call recording">
    <h4>Listen to call recording</h4>
    {current.phase === 'loading' && <p role="status">Loading recording…</p>}
    {current.phase === 'error' && <>
      <p role="alert">Could not load this recording.</p>
      <button type="button" onClick={retry}>Retry recording</button>
    </>}
    {current.phase === 'ready' && 'receipt' in current && current.receipt && <>
      <ReceiptDetails receipt={current.receipt} source={source} playbackAttempt={playbackAttempt} onPlaybackError={() => setPlaybackError(scope)}/>
      {current.receipt.status === 'available' && playbackError === scope && <>
        <p role="alert">Audio could not play. Try loading the recording again.</p>
        <button type="button" onClick={() => {setPlaybackError(''); setPlaybackAttempt(value => value + 1); retry();}}>Retry playback</button>
      </>}
      {['consent_pending', 'starting', 'recording', 'stopping', 'processing'].includes(current.receipt.status) &&
        <button type="button" onClick={retry}>Refresh recording</button>}
    </>}
  </section>;
}
