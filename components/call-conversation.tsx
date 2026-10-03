'use client';
import {useEffect, useRef, useState} from 'react';
import {safeLocalTime} from './workspace-view';
import {CallRecording} from './call-recording';

type TranscriptPage = {id: string; before: number | null; transcript: {role: string; message: string}[]; next: number | null};

export function CallConversation({id, party, summary, completedAt}: {id: string; party: string; summary?: string; completedAt?: string}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TranscriptPage | null>(null);
  const [error, setError] = useState<{id: string; before: number | null; message: string} | null>(null);
  const [page, setPage] = useState<{id: string; before: number | null}>({id, before: null});
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const before = page.id === id ? page.before : null;
  const current = data?.id === id && data.before === before ? data : null;
  const currentError = error?.id === id && error.before === before ? error.message : '';

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    running.current = true;
    setData(null);
    setError(null);
    void fetch(`/api/work/conversation?id=${encodeURIComponent(id)}${before !== null ? `&before=${before}` : ''}`, {
      signal: controller.signal, cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw Error();
      const result = await response.json();
      if (!controller.signal.aborted) setData({id, before, transcript: result.transcript, next: result.next});
    }).catch(() => {
      if (!controller.signal.aborted) setError({id, before, message: 'Could not load this call.'});
    }).finally(() => {
      if (!controller.signal.aborted) running.current = false;
    });
    return () => {controller.abort(); running.current = false;};
  }, [id, open, before, attempt]);

  return <details onToggle={event => {
    if (event.target !== event.currentTarget) return;
    setOpen(event.currentTarget.open);
    if (!event.currentTarget.open) {setData(null); setError(null);}
  }}>
    <summary>{party === 'seller' ? 'Seller' : party === 'buyer' ? 'Buyer' : 'Contact'} call <small>{completedAt ? safeLocalTime(completedAt) : 'Time not recorded'} · Completed</small></summary>
    <p>{summary || 'Completed call record.'}</p>
    <small>This is a saved transcript. Taking over pauses new work; it does not join or transfer a phone call.</small>
    {open && <>
      {!current && (currentError ? <>
        <p role="alert">{currentError}</p>
        <button type="button" onClick={() => {
          if (running.current) return;
          running.current = true;
          setError(null);
          setAttempt(value => value + 1);
        }}>Retry conversation</button>
      </> : <p role="status">Loading conversation…</p>)}
      <div className="message-history conversation-messages">{current?.transcript.map((turn, index) => <p key={index} className={`message-bubble ${turn.role === 'agent' ? 'message-outgoing' : 'message-incoming'}`}>
        <small>{turn.role === 'agent' ? 'Your bot' : turn.role === 'user' ? (party === 'seller' ? 'Seller' : 'Buyer') : 'Call note'}</small>{turn.message}
      </p>)}</div>
      <div className="history-pages">
        {current?.next !== null && current?.next !== undefined && <button type="button" onClick={() => setPage({id, before: current.next})}>Earlier in call</button>}
        {before !== null && <button type="button" onClick={() => setPage({id, before: null})}>End of call</button>}
      </div>
      <CallRecording key={id} conversationId={id}/>
    </>}
  </details>;
}
