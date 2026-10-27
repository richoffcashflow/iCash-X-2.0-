'use client';

import {useEffect, useState} from 'react';
import {CallConversation} from './call-conversation';
import {readReceipt, type RecordingReceipt, type RecordingSource} from './call-recording';
import {createPollCadence} from '@/lib/poll-cadence';

type Conversation = {
  id: string; source?: RecordingSource; party: string; summary?: string; completed_at?: string;
  durationSeconds?: number; nextAction?: string; interested?: boolean; optedOut?: boolean; humanRequested?: boolean; voicemail?: boolean;
};
type Recording = RecordingReceipt & {
  id: string; source: RecordingSource; party: string; createdAt: string; conversationId: string | null; voicemail?: boolean;
};
type History = {recordings: Recording[]; next: number | null};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readHistory(value: unknown): History {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid call history');
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.recordings) || result.recordings.length > 20 ||
    !(result.next === null || Number.isSafeInteger(result.next) && Number(result.next) > 0)) throw Error('Invalid call history');
  const recordings = result.recordings.map(value => {
    const receipt = readReceipt(value), row = value as Record<string, unknown>;
    if (!('id' in receipt) || !receipt.id || !['outbound', 'reception'].includes(String(row.source)) ||
      typeof row.party !== 'string' || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) ||
      !(row.conversationId === null || typeof row.conversationId === 'string' && uuid.test(row.conversationId))) throw Error('Invalid call history');
    if(row.voicemail!==undefined&&typeof row.voicemail!=='boolean')throw Error('Invalid call history');
    return {...receipt, voicemail:row.voicemail===true, id: receipt.id, source: row.source as RecordingSource, party: row.party,
      createdAt: row.createdAt, conversationId: row.conversationId as string | null};
  });
  if (new Set(recordings.map(row => `${row.source}:${row.id}`)).size !== recordings.length) throw Error('Invalid call history');
  return {recordings, next: result.next as number | null};
}

/** Read-only recording history; a finished transcript is never required for playback. */
export function PropertyCallHistory({screeningId, conversations, apiBase='/api/work'}: {screeningId: string; conversations: Conversation[]; apiBase?:string}) {
  const [pageState, setPage] = useState({screeningId, page: 0});
  const page = pageState.screeningId === screeningId ? pageState.page : 0;
  const scope = `${apiBase}:${screeningId}:${page}`;
  const [data, setData] = useState<(History & {scope: string}) | null>(null);
  const [error, setError] = useState('');
  const [showVoicemail,setShowVoicemail]=useState(false);
  const [refresh, setRefresh] = useState(0);
  const current = data?.scope === scope ? data : null;

  useEffect(() => {
    const controller = new AbortController(), cadence = createPollCadence();
    let inFlight = false, timer: ReturnType<typeof setTimeout> | undefined, delay = 5000;
    setError('');
    async function load() {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`${apiBase}/call-history?screeningId=${encodeURIComponent(screeningId)}&page=${page}`, {
          signal: controller.signal, cache: 'no-store', credentials: 'same-origin',
        });
        if (!response.ok) throw Error('Call history unavailable');
        const result = readHistory(await response.json());
        if (!controller.signal.aborted) {
          const processing = result.recordings.some(row => ['consent_pending', 'starting', 'recording', 'stopping', 'processing'].includes(row.status));
          delay = cadence.observe(result, processing);
          setData({...result, scope}); setError('');
        }
      } catch {
        delay = cadence.failed();
        if (!controller.signal.aborted) setError(scope);
      } finally {inFlight = false;}
    }
    const poll = async () => {await load(); if (!controller.signal.aborted) timer = setTimeout(poll, delay);};
    const visible = () => {if (!document.hidden && !inFlight) {clearTimeout(timer); delay = 5000; void poll();}};
    void poll(); document.addEventListener('visibilitychange', visible);
    return () => {controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible);};
  }, [apiBase, screeningId, page, scope, refresh]);

  function reload() {setRefresh(value => value + 1);}
  const recordings = current?.recordings ?? [];
  const represented = new Set(recordings.flatMap(row => row.conversationId ? [`${row.source}:${row.conversationId}`] : []));
  const history = [
    ...recordings.map(recording => ({key: `recording:${recording.source}:${recording.id}`, at: recording.createdAt, recording,
      conversation: conversations.find(call => (call.source ?? 'outbound') === recording.source && call.id === recording.conversationId)})),
    ...(page === 0 ? conversations.filter(call => !represented.has(`${call.source ?? 'outbound'}:${call.id}`)).map(conversation => ({
      key: `conversation:${conversation.source ?? 'outbound'}:${conversation.id}`, at: conversation.completed_at ?? '', conversation, recording: undefined,
    })) : []),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || a.key.localeCompare(b.key));

  const visibleHistory=history.filter(item=>!item.recording?.voicemail&&!item.conversation?.voicemail);
  const voicemailHistory=history.filter(item=>item.recording?.voicemail||item.conversation?.voicemail);
  const shownHistory=showVoicemail?history:visibleHistory;
  return <section aria-label="Call recordings">
    <div className="workspace-section-heading"><h4 className="call-history-title">Call recordings</h4><button type="button" className="workspace-quiet" onClick={reload}>Refresh recordings</button></div>
    {error === scope && <p role="status">Call recordings could not refresh. <button type="button" className="workspace-quiet" onClick={reload}>Retry call recordings</button></p>}
    {!current && error !== scope && <p role="status">Loading call recordings…</p>}
    {current && !shownHistory.length && <div className="conversation-empty"><strong>{voicemailHistory.length?'Only voicemail in this view':'No call recordings yet'}</strong><p>{voicemailHistory.length?'Use Show voicemail below to view saved recordings.':'Recorded calls will appear here when audio is ready.'}</p></div>}
    {shownHistory.map(({key, recording, conversation}) => <CallConversation key={key} apiBase={apiBase}
      id={conversation?.id ?? recording!.conversationId ?? recording!.id} source={recording?.source ?? conversation?.source ?? 'outbound'}
      party={conversation?.party ?? recording!.party} summary={conversation?.summary}
      completedAt={conversation?.completed_at ?? recording?.createdAt} durationSeconds={conversation?.durationSeconds ?? recording?.durationSeconds ?? undefined}
      nextAction={conversation?.nextAction} interested={conversation?.interested} optedOut={conversation?.optedOut} humanRequested={conversation?.humanRequested}
      transcriptAvailable={!!conversation || !!recording?.conversationId}
      recordingId={recording?.id} recordingReceipt={recording} onRefreshRecording={reload}/>)}
    {voicemailHistory.length>0&&<label className="text-reply-filter voicemail-history"><input type="checkbox" checked={showVoicemail} onChange={e=>setShowVoicemail(e.target.checked)}/>Show {voicemailHistory.length} voicemail {voicemailHistory.length===1?'recording':'recordings'}</label>}
    {(page > 0 || current?.next !== null && current?.next !== undefined) && <nav className="history-pages" aria-label="Call recording pages">
      {page > 0 && <button type="button" onClick={() => setPage({screeningId, page: 0})}>Latest recordings</button>}
      {current?.next !== null && current?.next !== undefined && <button type="button" onClick={() => setPage({screeningId, page: current.next!})}>Older recordings</button>}
    </nav>}
  </section>;
}
