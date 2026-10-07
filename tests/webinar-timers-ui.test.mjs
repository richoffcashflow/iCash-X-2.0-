import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {newWebinar, formatWatchTime, webinarPitchAt} from '../lib/webinar-policy.ts';
import {newWebinarTimer, timerDisplay, timerResponseSchema} from '../lib/webinar-timers.ts';

const jsx = (type, props) => ({type, props});
const all = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(all)];
async function component(file, deps) {
  const key = 'timerUI' + Math.random().toString(36).slice(2);
  globalThis[key] = {_jsx: jsx, _jsxs: jsx, _Fragment: 'fragment', ...deps};
  const source = ts.transpileModule(readFileSync(new URL('../components/' + file, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText.replace(/^import .* from .*;$/gm, '');
  return import('data:text/javascript;base64,' + Buffer.from('const {' + Object.keys(globalThis[key]).join(',') + '}=globalThis.' + key + ';\n' + source).toString('base64'));
}
const {WebinarTimersEditor} = await component('webinar-timers-editor.tsx', {Clock: 'clock', Plus: 'plus', Trash2: 'trash', WebinarTimeInput: 'time-input', DateTimeInput: 'date-time-input', formatWatchTime, webinarPitchAt, newWebinarTimer});
let webinar = newWebinar('00000000-0000-4000-8000-000000000123');
const render = () => WebinarTimersEditor({webinar, onChange: patch => webinar = {...webinar, ...patch}});
let tree = render();
all(tree).find(node => node.type === 'button' && !node.props['aria-label']).props.onClick();
assert.equal(webinar.timers.length, 1);
tree = render();
const duration = all(tree).find(node => node.type === 'time-input' && node.props.label === 'Timer 1 duration');
duration.props.onChange(3661); assert.equal(webinar.timers[0].durationSeconds, 3661);
all(tree).find(node => node.type === 'input' && node.props.placeholder === 'Time remaining').props.onChange({target: {value: 'Next step in'}});
assert.equal(webinar.timers[0].label, 'Next step in');
tree = render();
all(tree).find(node => node.type === 'select' && node.props.value === 'duration').props.onChange({target: {value: 'deadline'}});
tree = render();
const date = all(tree).find(node => node.type === 'date-time-input');
date.props.onChange({target: {value: '2026-11-01T10:30'}});
assert.equal(Date.parse(webinar.timers[0].endsAt), new Date('2026-11-01T10:30').getTime());
date.props.onChange({target: {value: ''}}); assert.equal(webinar.timers[0].endsAt, null);
all(tree).find(node => node.type === 'select' && node.props.value === 'hide').props.onChange({target: {value: 'message'}});
tree = render(); assert.ok(all(tree).some(node => node.type === 'input' && node.props.value === 'The countdown has ended.'));
all(tree).find(node => node.type === 'button' && node.props['aria-label'] === 'Remove timer 1').props.onClick();
assert.equal(webinar.timers.length, 0);

let index = 0, cells = [], effects = [], pending = [], fail = true, calls = 0, clock = 1000000;
const listeners = new Map(), intervals = new Map();
const originalNow = Date.now, originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
const originalDocument = globalThis.document, originalWindow = globalThis.window;
Date.now = () => clock;
globalThis.document = {hidden: false, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key)};
globalThis.window = {addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key)};
globalThis.setInterval = fn => {const id = Math.random(); intervals.set(id, fn); return id;};
globalThis.clearInterval = id => intervals.delete(id);
try {
  const same = (a, b) => a && b && a.length === b.length && a.every((value, n) => Object.is(value, b[n]));
  const saved = new Date(clock + 600000).toISOString();
  const {useWebinarTimers, WebinarTimers} = await component('webinar-timers.tsx', {
    Clock: 'clock', formatWatchTime, timerDisplay, timerResponseSchema,
    useState(initial) {const n = index++; if (!(n in cells)) cells[n] = initial; return [cells[n], value => cells[n] = value];},
    useRef(initial) {const n = index++; return cells[n] ??= {current: initial};},
    useEffect(fn, deps) {const n = index++; if (!same(effects[n]?.deps, deps)) pending.push(() => {effects[n]?.cleanup?.(); effects[n] = {deps, cleanup: fn()};});},
    webinarRequest: async (_path, request) => {calls++; assert.equal(JSON.parse(request.body).seconds, 30); if (fail) throw Error('offline'); return {deadlines: {pitch: saved}, serverNow: clock};},
  });
  const timer = newWebinarTimer('pitch', 30);
  const props = {sessionId: 'one', timers: [timer], seconds: 0, preview: false, now: clock};
  const hook = patch => {index = 0; const result = useWebinarTimers({...props, ...patch}); while (pending.length) pending.shift()(); return result;};
  const flush = async () => {for (let i = 0; i < 10; i++) await Promise.resolve();};
  hook(); assert.equal(calls, 0);
  hook({seconds: 30}); await flush(); assert.equal(calls, 1);
  assert.deepEqual(hook({seconds: 30}).deadlines, {});
  fail = false; listeners.get('online')(); await flush();
  let result = hook({seconds: 30}); assert.equal(result.deadlines.pitch, saved);
  assert.equal(intervals.size, 0, 'Successful starts stop background retry polling');
  clock += 120000; result = hook({seconds: 30});
  assert.equal(timerDisplay(timer, 30, result.now, result.deadlines).remaining, 480, 'Wall time advances while playback is paused');
  let output = WebinarTimers({timers: [timer], placement: 'offer', seconds: 30, ...result});
  assert.equal(all(output).find(node => node.props?.role === 'timer').props.children, '8:00');
  assert.equal(all(WebinarTimers({timers: [timer], placement: 'video', seconds: 30, ...result})).length, 1);
  const before = calls;
  result = hook({preview: true, seconds: 30, now: clock}); await flush(); assert.equal(calls, before, 'Preview never writes a deadline');
  assert.equal(timerDisplay(timer, 30, result.now, result.deadlines).remaining, 600);
  for (const effect of effects) effect?.cleanup?.();
  assert.equal(intervals.size, 0);
} finally {
  Date.now = originalNow; globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear;
  globalThis.document = originalDocument; globalThis.window = originalWindow;
}
console.log('Timer controls and client flow passed: add/edit/remove, duration, local date, expiry action, first cue, failure recovery, saved deadlines, paused playback, placement, preview isolation and cleanup.');
