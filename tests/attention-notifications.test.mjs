import assert from 'node:assert/strict';
import {attentionEmail, attentionEmailConfiguration, attentionConsentVersion} from '../lib/attention-notifications.ts';
import {dispatchAttentionNotification} from '../lib/attention-notifications-service.ts';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {ICASH_ATTENTION_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'fixture', ICASH_ATTENTION_WEBHOOK_SECRET: 'whsec_fixture', ICASH_ATTENTION_FROM_EMAIL: 'alerts@example.com', ICASH_APP_ORIGIN: 'https://www.example.com'};
const job = {id: uuid(1), kind: 'signature', screeningId: uuid(2), recipient: 'owner@example.com', unsubscribeToken: uuid(3) + uuid(4), pendingCount: 7};
assert.equal(attentionConsentVersion, '2026-09-30-attention-email-1');
assert(attentionEmailConfiguration(env));
for (const bad of [{ICASH_ATTENTION_EMAIL_ENABLED: 'false'}, {ICASH_ATTENTION_EMAIL_ENABLED: undefined}, {ICASH_ATTENTION_FROM_EMAIL: 'Name <x@example.com>'}, {ICASH_ATTENTION_FROM_EMAIL: 'x@example.com\r\nBcc:a@example.com'}, {ICASH_APP_ORIGIN: 'http://example.com'}, {ICASH_APP_ORIGIN: 'https://user:secret@example.com'}, {ICASH_APP_ORIGIN: 'https://example.com/redirect?to=other'}, {ICASH_ATTENTION_WEBHOOK_SECRET: undefined}]) assert.equal(attentionEmailConfiguration({...env, ...bad}), null);
const email = attentionEmail({...job, transcript: 'DO NOT DISCLOSE', address: 'PRIVATE ADDRESS', terms: 'SECRET TERMS'}, env.ICASH_APP_ORIGIN, env.ICASH_ATTENTION_FROM_EMAIL);
assert.deepEqual(email.to, ['owner@example.com']);
assert(email.text.includes(`screeningId=${job.screeningId}`));
assert(email.text.includes('7 saved tasks'));
assert(email.text.includes('sign-in required'));
assert(!JSON.stringify(email).match(/DO NOT DISCLOSE|PRIVATE ADDRESS|SECRET TERMS/));
assert.equal(email.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
assert.deepEqual(email.tags, [{name: 'icash_attention_id', value: job.id}]);
for (const bad of [{id: 'not-a-uuid'}, {screeningId: 'other&account=forged'}, {kind: '__proto__'}, {recipient: 'victim@example.com\nBcc:other@example.com'}, {unsubscribeToken: 'bad'}, {pendingCount: NaN}]) assert.throws(() => attentionEmail({...job, ...bad}, env.ICASH_APP_ORIGIN, env.ICASH_ATTENTION_FROM_EMAIL));

function fixtures(mode = 'success') {
  const calls = [], sends = []; let claimed = false;
  const db = async (path, method, body, signal) => {
    calls.push({path, method, body}); assert(signal instanceof AbortSignal); assert.equal(body.p_account, uuid(9));
    if (path.endsWith('claim_attention_email')) {
      if (mode === 'database_failure') throw Error('private database details');
      if (mode === 'empty' || claimed) return null; claimed = true; return job.id;
    }
    if (path.endsWith('authorize_attention_email')) {
      if (['stale', 'optout', 'owner_changed', 'suppressed'].includes(mode)) return null;
      return mode === 'wrong_claim' ? {...job, id: uuid(88)} : job;
    }
    if (path.endsWith('finish_attention_email')) {
      if (mode === 'receipt_write_failure') throw Error('database down after send');
      return null;
    }
    throw Error('Unexpected DB request');
  };
  const transport = async (url, options) => {
    sends.push({url, options}); assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.headers['Idempotency-Key'], 'attention-' + job.id);
    assert.equal(options.redirect, 'error'); assert(options.signal instanceof AbortSignal);
    if (mode === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
    if (mode === 'provider_failure') return new Response('{}', {status: 503});
    if (mode === 'bad_receipt') return new Response('{}', {status: 200});
    return Response.json({id: uuid(77)});
  };
  return {db, transport, calls, sends};
}
let f = fixtures();
assert.equal((await dispatchAttentionNotification(uuid(9), {...f, env: {}})).status, 'attention_disabled'); assert.equal(f.calls.length, 0);
assert.equal((await dispatchAttentionNotification('forged', {...f, env})).status, 'attention_held'); assert.equal(f.calls.length, 0);
assert.equal((await dispatchAttentionNotification(uuid(9), {...f, env})).status, 'attention_accepted'); assert.equal(f.sends.length, 1);
assert.equal((await dispatchAttentionNotification(uuid(9), {...f, env})).status, 'attention_idle'); assert.equal(f.sends.length, 1, 'Duplicate event never dispatches again');
for (const mode of ['stale', 'optout', 'owner_changed', 'suppressed', 'empty', 'wrong_claim', 'database_failure']) {
  f = fixtures(mode); await dispatchAttentionNotification(uuid(9), {...f, env}); assert.equal(f.sends.length, 0, mode + ' prevents provider request');
}
for (const mode of ['timeout', 'provider_failure', 'bad_receipt', 'receipt_write_failure']) {
  f = fixtures(mode); assert.equal((await dispatchAttentionNotification(uuid(9), {...f, env})).status, 'attention_needs_review');
  await dispatchAttentionNotification(uuid(9), {...f, env}); assert.equal(f.sends.length, 1, mode + ' is not automatically retried');
}
f = fixtures(); const controller = new AbortController(); controller.abort();
assert.equal((await dispatchAttentionNotification(uuid(9), {...f, env, signal: controller.signal})).status, 'attention_needs_review'); assert.equal(f.calls.length, 0); assert.equal(f.sends.length, 0);
console.log('Attention notifications: default-off config, private copy, verified claim, opt-out/stale guards, bounded failure and duplicate handling passed. No external calls.');
