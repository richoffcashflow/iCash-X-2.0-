'use client';
import {useEffect, useRef, useState} from 'react';
import {safeLocalTime} from './workspace-view';
import {CallRecording} from './call-recording';

type TranscriptPage = {id: string; before: number | null; transcript: {role: string; message: string}[]; next: number | null};

export function CallConversation({id, source='outbound', party, summary, completedAt, durationSeconds, nextAction, interested, optedOut, humanRequested}: {id: string; source?: 'outbound'|'reception'; party: string; summary?: string; completedAt?: string;durationSeconds?:number;nextAction?:string;interested?:boolean;optedOut?:boolean;humanRequested?:boolean}) {
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
    void fetch(`/api/work/conversation?id=${encodeURIComponent(id)}&source=${source}${before !== null ? `&before=${before}` : ''}`, {
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
  }, [id, source, open, before, attempt]);

  return <article className="call-summary-card"><header><strong>{party === 'seller' ? 'Seller' : party === 'buyer' ? 'Buyer' : 'Contact'} call{source === 'reception' ? ' · Incoming' : ''}</strong><span>{optedOut?'Do not contact':humanRequested?'Needs you':interested?'Interested':'Completed'}</span></header><small>{completedAt ? safeLocalTime(completedAt) : 'Time not recorded'}{typeof durationSeconds==='number'&&Number.isFinite(durationSeconds)&&durationSeconds>=0?` · ${Math.floor(durationSeconds/60)}m ${Math.floor(durationSeconds%60)}s`:''}</small><h5>Call summary</h5><p className="call-summary-copy">{summary?.trim() || 'No summary is available for this call yet.'}</p>{nextAction&&<div className="call-next-step"><strong>Next step</strong><p>{nextAction}</p></div>}<CallRecording key={`${source}:${id}`} conversationId={id} source={source}/><details onToggle={event => {
    if (event.target !== event.currentTarget) return;
    setOpen(event.currentTarget.open);
    if (!event.currentTarget.open) {setData(null); setError(null);}
  }}>
    <summary>Read call transcript</summary>
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
    </>}
  </details></article>;
}
