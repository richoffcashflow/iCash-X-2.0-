import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {timerResponseSchema} from '../lib/webinar-timers.ts';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let origin = true, signedIn = true, preview = false, superseded = false;
const calls = [];
class WebinarError extends Error { constructor(status, message) { super(message); this.status = status; } }
const mocks = {
  z, timerResponseSchema, webinarHeaders: {'Cache-Control': 'private, no-store'},
  webinarOrigin: () => { if (!origin) throw new WebinarError(403, 'Origin'); },
  webinarBody: req => req.json(), webinarLimit: async () => {},
  webinarError: error => Response.json({error: error.message}, {status: error.status || 503}),
  webinarSession: async sessionId => {
    if (!signedIn) throw new WebinarError(401, 'Visitor');
    if (sessionId !== id(2)) throw new WebinarError(404, 'Session');
    return {v: {id: id(1)}, s: {id: sessionId, is_preview: preview, superseded_at: superseded ? '2026-10-07T01:00:00Z' : null}};
  },
  db: async (path, method, body) => { calls.push({path, method, body}); return {deadlines: {pitch: '2026-10-07T01:10:00+00:00'}, serverNow: Date.now(), privateData: 'must not leave'}; },
};
globalThis.__timerRoute = mocks;
const source = ts.transpileModule(readFileSync(new URL('../app/api/webinar/timers/route.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm, '');
const {POST} = await import('data:text/javascript;base64,' + Buffer.from('const {' + Object.keys(mocks).join(',') + '}=globalThis.__timerRoute;\n' + source).toString('base64'));
const post = (extra = {}) => POST(new Request('https://example.test/api/webinar/timers', {method: 'POST', body: JSON.stringify({sessionId: id(2), seconds: 30, ...extra})}));
origin = false; assert.equal((await post()).status, 403); origin = true;
signedIn = false; assert.equal((await post()).status, 401); signedIn = true;
assert.equal((await post({sessionId: id(3)})).status, 404);
assert.equal((await post({visitorId: id(3)})).status, 400);
assert.equal((await post({seconds: -1})).status, 400);
assert.equal((await post({endsAt: '2099-01-01T00:00:00Z'})).status, 400, 'Browser cannot choose or extend its deadline');
preview = true; assert.deepEqual((await (await post()).json()).deadlines, {}); preview = false;
superseded = true; assert.deepEqual((await (await post()).json()).deadlines, {}); superseded = false;
assert.equal(calls.length, 0);
const response = await post(), data = await response.json();
assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
assert.deepEqual(Object.keys(data).sort(), ['deadlines', 'serverNow']);
assert.deepEqual(calls[0], {path: 'rpc/icash_webinar_timers', method: 'POST', body: {p_visitor: id(1), p_session: id(2), p_seconds: 30}});
console.log('Webinar timers API passed: ownership, origin, immutable server deadlines, preview isolation and safe responses.');
