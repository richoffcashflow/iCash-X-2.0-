import {z} from 'zod';
export {timerDisplay, type TimerDeadlines} from '../packages/webinar-engine/src/timers.ts';

export const webinarTimerSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  label: z.string().trim().min(1).max(100),
  at: z.number().int().min(0).max(14400),
  mode: z.enum(['duration', 'deadline']),
  durationSeconds: z.number().int().min(1).max(604800),
  endsAt: z.string().datetime().nullable(),
  placement: z.enum(['video', 'offer']),
  onExpire: z.enum(['hide', 'message']),
  expiredMessage: z.string().trim().min(1).max(150),
}).strict().superRefine((timer, context) => {
  if (timer.mode === 'deadline' && !timer.endsAt) context.addIssue({code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'Choose the date and time this timer ends.'});
});
export type WebinarTimer = z.infer<typeof webinarTimerSchema>;
export const timerResponseSchema = z.object({
  deadlines: z.record(z.string().datetime({offset: true})),
  serverNow: z.number().finite(),
});
export function newWebinarTimer(id: string, at: number): WebinarTimer {
  return {id, label: 'Time remaining', at, mode: 'duration', durationSeconds: 600, endsAt: null, placement: 'offer', onExpire: 'hide', expiredMessage: 'The countdown has ended.'};
}
