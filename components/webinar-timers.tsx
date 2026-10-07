'use client';
import {useEffect, useRef, useState} from 'react';
import {Clock} from 'lucide-react';
import {webinarRequest} from '@/lib/webinar-client';
import {formatWatchTime} from '@/lib/webinar-policy';
import {timerDisplay, timerResponseSchema, type TimerDeadlines, type WebinarTimer} from '@/lib/webinar-timers';

export function useWebinarTimers({sessionId, timers, seconds, preview, now}: {sessionId: string; timers: WebinarTimer[]; seconds: number; preview: boolean; now: number}) {
  const [state, setState] = useState<{sessionId: string; deadlines: TimerDeadlines; offset: number} | null>(null);
  const position = useRef(seconds);
  position.current = seconds;
  const due = timers.filter(timer => timer.mode === 'duration' && timer.at <= seconds).map(timer => timer.id).sort().join(',');
  useEffect(() => {
    if (preview || !due) return;
    const controller = new AbortController();
    let disposed = false, inFlight = false;
    async function sync() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const result = timerResponseSchema.parse(await webinarRequest('/api/webinar/timers', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({sessionId, seconds: Math.floor(position.current)}), signal: controller.signal}, 10000));
        if (!disposed) { setState({sessionId, deadlines: result.deadlines, offset: result.serverNow - Date.now()}); clearInterval(retry); }
      } catch { /* A missing timer must never interrupt the video or checkout. */ }
      finally { inFlight = false; }
    }
    const retry = setInterval(() => void sync(), 30000);
    void sync();
    const visible = () => { if (!document.hidden) void sync(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => { disposed = true; controller.abort(); clearInterval(retry); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible); };
  }, [sessionId, due, preview]);
  const deadlines: TimerDeadlines = preview
    ? Object.fromEntries(timers.filter(timer => timer.mode === 'duration').map(timer => [timer.id, new Date(now + (timer.at + timer.durationSeconds - seconds) * 1000).toISOString()]))
    : state?.sessionId === sessionId ? state.deadlines : {};
  return {deadlines, now: !preview && state?.sessionId === sessionId ? Date.now() + state.offset : now};
}

export function WebinarTimers({timers, placement, seconds, now, deadlines}: {timers: WebinarTimer[]; placement: WebinarTimer['placement']; seconds: number; now: number; deadlines: TimerDeadlines}) {
  return <div className="wb-timers">{timers.filter(timer => timer.placement === placement).map(timer => {
    const display = timerDisplay(timer, seconds, now, deadlines);
    return display ? <div key={timer.id} className={`wb-timer${display.expired ? ' wb-timer-ended' : ''}`}>
      <Clock size={18} aria-hidden="true"/><span>{display.label}</span>
      {!display.expired && <strong role="timer" aria-label={`${display.label}: ${formatWatchTime(display.remaining)}`}>{formatWatchTime(display.remaining)}</strong>}
    </div> : null;
  })}</div>;
}
