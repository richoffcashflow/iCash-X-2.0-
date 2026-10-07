import test from 'node:test';
import assert from 'node:assert/strict';
import {newWebinar, webinarSchema} from '../lib/webinar-policy.ts';
import {newWebinarTimer, timerDisplay, webinarTimerSchema, timerResponseSchema} from '../lib/webinar-timers.ts';
import {createNightRecording, patchRecording, selectRecording} from '../lib/webinar-recordings.ts';

const now = Date.parse('2026-10-07T01:00:00Z');
const timer = newWebinarTimer('pitch', 30);
test('countdowns wait for their cue and a saved server deadline', () => {
  const deadlines = {pitch: new Date(now + 600000).toISOString()};
  assert.equal(timerDisplay(timer, 29, now, deadlines), null);
  assert.equal(timerDisplay(timer, 30, now, {}), null);
  assert.equal(timerDisplay(timer, 30, now, {pitch: 'broken'}), null);
  assert.equal(timerDisplay(timer, 30, now, deadlines).remaining, 600);
  assert.equal(timerDisplay(timer, 30, now + 300000, deadlines).remaining, 300, 'Pausing playback does not pause the deadline');
  assert.equal(timerDisplay(timer, 30, now + 600000, deadlines), null);
  assert.deepEqual(timerDisplay({...timer, onExpire: 'message'}, 30, now + 900000, deadlines), {remaining: 0, expired: true, label: timer.expiredMessage});
});
test('fixed deadlines use absolute time and support hour-long countdowns', () => {
  const fixed = {...timer, mode: 'deadline', endsAt: new Date(now + 7261000).toISOString()};
  assert.equal(timerDisplay(fixed, 30, now, {}).remaining, 7261);
  assert.equal(timerDisplay(fixed, 31, now + 7261000, {}), null);
  assert.equal(webinarTimerSchema.safeParse({...fixed, endsAt: null}).success, false);
  assert.equal(webinarTimerSchema.safeParse({...timer, durationSeconds: 0}).success, false);
  assert.equal(timerResponseSchema.safeParse({deadlines: {pitch: '2026-10-07T01:10:00+00:00'}, serverNow: now}).success, true);
});
test('legacy webinars default to no timers and each recording has its own validated timeline', () => {
  const webinar = newWebinar('00000000-0000-4000-8000-000000000123');
  const {timers, ...legacy} = webinar;
  assert.deepEqual(webinarSchema.parse(legacy).timers, []);
  assert.equal(webinarSchema.safeParse({...webinar, timers: [timer, timer]}).success, false);
  assert.equal(webinarSchema.safeParse({...webinar, timers: [{...timer, at: webinar.durationSeconds + 1}]}).success, false);
  const day = {...webinar, videoUrl: 'https://example.test/day.mp4', timers: [timer]};
  const both = {...day, nightEnabled: true, nightVersion: {...createNightRecording(day), videoUrl: 'https://example.test/night.mp4'}};
  const edited = patchRecording(both, 'night', {timers: [{...timer, at: 60, label: 'Night timer'}]});
  assert.equal(edited.timers[0].at, 30);
  assert.equal(selectRecording(edited, 'UTC', new Date('2026-10-07T01:00:00Z')).timers[0].at, 60);
  assert.equal(webinarSchema.safeParse({...both, nightVersion: {...both.nightVersion, timers: [{...timer, at: 9999}]}}).success, false);
});
