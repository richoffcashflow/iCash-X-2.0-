/** Portable display rules. Hosts persist relative deadlines when a cue is reached. */
export type WebinarTimer = {
  id: string;
  label: string;
  at: number;
  mode: 'duration' | 'deadline';
  durationSeconds: number;
  endsAt: string | null;
  placement: 'video' | 'offer';
  onExpire: 'hide' | 'message';
  expiredMessage: string;
};

export type TimerDeadlines = Record<string, string>;

export function timerDisplay(timer: WebinarTimer, seconds: number, now: number, deadlines: TimerDeadlines) {
  if (!Number.isFinite(seconds) || !Number.isFinite(now) || seconds < timer.at) return null;
  const deadline = Date.parse((timer.mode === 'deadline' ? timer.endsAt : deadlines[timer.id]) ?? '');
  if (!Number.isFinite(deadline)) return null;
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (remaining === 0 && timer.onExpire === 'hide') return null;
  return {remaining, expired: remaining === 0, label: remaining === 0 ? timer.expiredMessage : timer.label};
}
