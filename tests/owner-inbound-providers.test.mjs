import assert from 'node:assert/strict';
import { createOwnerInboundProviders } from '../lib/owner-inbound-providers.ts';

// Every request in this file is synthetic. No credentials are read and no
// provider endpoint is contacted. Secrets below are deliberately fake fixtures.
const config = {
  agentId: 'agent_fixture', branchId: 'agtbrch_fixture', phoneNumberId: 'phnum_fixture',
  twilioAccountSid: 'AC' + 'a'.repeat(32), elevenLabsRegion: 'us', twilioRegion: 'us1',
};
const env = { ELEVENLABS_API_KEY: 'TEST_ONLY_NOT_A_CREDENTIAL', TWILIO_ACCOUNT_SID: config.twilioAccountSid, TWILIO_AUTH_TOKEN: 'TEST_ONLY_NOT_A_CREDENTIAL' };
const callSid = 'CA' + 'b'.repeat(32), conversationId = 'conv_fixture';
const twilioReceipt = {
  sid: callSid, account_sid: config.twilioAccountSid, from: '+12145550123', to: '+12145550199',
  forwarded_from: '+12145550198', direction: 'inbound', status: 'completed', duration: '31',
  price: '-0.010000', price_unit: 'USD',
};
const conversationReceipt = {
  conversation_id: conversationId, agent_id: config.agentId, branch_id: config.branchId,
  version_id: 'agtvrsn_fixture', status: 'done', has_audio: false,
  metadata: { cost_fiat: 0.29, cost: 999999, phone_call: { type: 'twilio', call_sid: callSid, direction: 'inbound' } },
};
let count = 0;
const check = (condition, message) => { count++; assert(condition, message); };
const equal = (actual, expected, message) => { count++; assert.deepEqual(actual, expected, message); };
const throws = (action, pattern) => { count++; assert.throws(action, pattern); };
const rejects = async (action, pattern) => { count++; await assert.rejects(action, pattern); };
function fixture(overrides = {}, body) {
  const calls = [];
  const providers = createOwnerInboundProviders({ ...config, ...overrides }, {
    env,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return Response.json(body ?? (url.includes('/Calls/') ? twilioReceipt : url.includes('/conversations/') ? conversationReceipt : { receipt: 'fixture', private_field: 'server-only' }));
    },
  });
  return { providers, calls };
}
const { providers, calls } = fixture();
for (const request of [() => providers.agent(), () => providers.branch(), () => providers.phone(), () => providers.readPhone(config.phoneNumberId)]) {
  const value = await request();
  equal(value, { receipt: 'fixture', private_field: 'server-only' });
  check(Object.isFrozen(value));
}
const twilio = await providers.twilio(callSid), conversation = await providers.conversation(conversationId);
equal(twilio, twilioReceipt); equal(conversation, conversationReceipt);
equal(calls.map(call => call.url), [
  `https://api.us.elevenlabs.io/v1/convai/agents/${config.agentId}?branch_id=${config.branchId}`,
  `https://api.us.elevenlabs.io/v1/convai/agents/${config.agentId}/branches/${config.branchId}`,
  `https://api.us.elevenlabs.io/v1/convai/phone-numbers/${config.phoneNumberId}`,
  `https://api.us.elevenlabs.io/v1/convai/phone-numbers/${config.phoneNumberId}`,
  `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Calls/${callSid}.json`,
  `https://api.us.elevenlabs.io/v1/convai/conversations/${conversationId}`,
]);
for (const { url, options } of calls) {
  equal(options.method, 'GET'); equal(options.cache, 'no-store'); equal(options.redirect, 'error'); equal(options.credentials, 'omit');
  check(options.signal instanceof AbortSignal); check(!Object.hasOwn(options, 'body'));
  if (url.includes('elevenlabs.io')) { equal(options.headers['xi-api-key'], env.ELEVENLABS_API_KEY); check(!Object.hasOwn(options.headers, 'Authorization')); }
  else { equal(options.headers.Authorization, `Basic ${Buffer.from(`${config.twilioAccountSid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`); check(!Object.hasOwn(options.headers, 'xi-api-key')); }
}
check(Object.isFrozen(conversation.metadata)); check(Object.isFrozen(conversation.metadata.phone_call));
throws(() => { conversation.metadata.cost_fiat = 0; }, TypeError);
const known = providers.costs(twilio, conversation);
equal(known, {
  currency: 'USD', twilioCostMicros: 10000, elevenLabsCostMicros: 290000, totalCostMicros: 300000,
  twilioCostCents: 1, elevenLabsCostCents: 29, totalCostCents: 30,
  definitive: true, scope: 'twilio_connectivity_and_elevenlabs_conversation', reason: null,
});
for (const pair of [[twilioReceipt, conversationReceipt], [structuredClone(twilio), conversation], [twilio, structuredClone(conversation)], [conversation, twilio], [null, conversation]]) {
  equal(providers.costs(...pair).reason, 'unverified_receipts'); equal(providers.costs(...pair).definitive, false);
}
const foreign = fixture().providers;
equal(providers.costs(await foreign.twilio(callSid), await foreign.conversation(conversationId)).reason, 'unverified_receipts');

// Every regional origin is an explicit allowlist entry; no global fallback.
for (const [region, host] of Object.entries({ global: 'api.elevenlabs.io', us: 'api.us.elevenlabs.io', eu: 'api.eu.residency.elevenlabs.io', in: 'api.in.residency.elevenlabs.io', sg: 'api.sg.residency.elevenlabs.io' })) {
  const f = fixture({ elevenLabsRegion: region }); await f.providers.agent(); equal(new URL(f.calls[0].url).host, host); equal(f.calls.length, 1);
}
for (const [region, host] of Object.entries({ us1: 'api.twilio.com', ie1: 'api.dublin.ie1.twilio.com', au1: 'api.sydney.au1.twilio.com' })) {
  const f = fixture({ twilioRegion: region }); await f.providers.twilio(callSid); equal(new URL(f.calls[0].url).host, host); equal(f.calls.length, 1);
}
for (const key of ['elevenLabsRegion', 'twilioRegion']) {
  for (const value of [undefined, null, '', 'US', 'https://attacker.example', '__proto__', 'constructor', 'toString']) throws(() => fixture({ [key]: value }), /REGION_INVALID/);
}
for (const key of ['agentId', 'branchId', 'phoneNumberId', 'twilioAccountSid']) {
  for (const value of [undefined, '', '../../secret', 'a?x=y', 'a#fragment', 'a%2fsecret', 'a'.repeat(129)]) throws(() => fixture({ [key]: value }), /CONFIG_INVALID/);
}
for (const value of ['../secrets', `${callSid}?x=y`, '', null]) throws(() => providers.twilio(value), /CONFIG_INVALID/);
for (const value of ['../secrets', `${conversationId}?x=y`, '', null]) throws(() => providers.conversation(value), /CONFIG_INVALID/);
throws(() => providers.readPhone('phnum_other'), /TARGET_MISMATCH/);
equal(calls.length, 6);

// Missing/invalid injected credentials fail before fetch. No process.env fallback.
let unexpectedFetches = 0;
const never = async () => { unexpectedFetches++; throw Error('Unexpected request'); };
for (const supplied of [undefined, {}, { ELEVENLABS_API_KEY: '' }, { ELEVENLABS_API_KEY: 'bad\nheader' }]) {
  const p = createOwnerInboundProviders(config, { fetcher: never, env: supplied }); throws(() => p.agent(), /CREDENTIALS_UNAVAILABLE/);
}
for (const supplied of [{}, { ...env, TWILIO_ACCOUNT_SID: 'AC' + 'c'.repeat(32) }]) {
  const p = createOwnerInboundProviders(config, { fetcher: never, env: supplied }); throws(() => p.twilio(callSid), /ACCOUNT_MISMATCH/);
}
for (const value of [undefined, '', 'bad\rheader']) {
  const p = createOwnerInboundProviders(config, { fetcher: never, env: { ...env, TWILIO_AUTH_TOKEN: value } }); throws(() => p.twilio(callSid), /CREDENTIALS_UNAVAILABLE/);
}
equal(unexpectedFetches, 0);

// Snapshot configuration/credentials, so later object mutation cannot retarget.
const mutableConfig = { ...config }, mutableEnv = { ...env }, snapshotCalls = [];
const snapshot = createOwnerInboundProviders(mutableConfig, { env: mutableEnv, fetcher: async (url, options) => { snapshotCalls.push({ url, options }); return Response.json({}); } });
mutableConfig.elevenLabsRegion = 'eu'; mutableConfig.agentId = 'agent_other'; mutableEnv.ELEVENLABS_API_KEY = 'TEST_ONLY_ROTATED_PLACEHOLDER';
await snapshot.agent(); equal(snapshotCalls[0].url, calls[0].url); equal(snapshotCalls[0].options.headers['xi-api-key'], env.ELEVENLABS_API_KEY);

// Fail closed on every fetch/response failure. Exactly one attempt; no error text.
for (const response of [
  () => { throw Error('https://secret.example/credential'); },
  () => Response.json({ error: 'raw-sensitive-body' }, { status: 401 }),
  () => new Response(null, { status: 302, headers: { location: 'https://attacker.example' } }),
  () => new Response('broken-json', { headers: { 'content-type': 'application/json' } }),
  () => new Response('<html>provider outage</html>', { headers: { 'content-type': 'text/html' } }),
  () => Response.json([]), () => Response.json(null), () => Response.json('not-an-object'),
  () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } }),
  () => Response.json({ oversize: 'a'.repeat(1048576) }),
  () => { const r = Response.json({}); Object.defineProperty(r, 'redirected', { value: true }); return r; },
  () => { const r = Response.json({}); Object.defineProperty(r, 'url', { value: 'https://attacker.example' }); return r; },
]) {
  let tries = 0;
  const p = createOwnerInboundProviders(config, { env, fetcher: async () => { tries++; return response(); } });
  await rejects(() => p.conversation(conversationId), /^Error: OWNER_INBOUND_PROVIDER_(?:UNAVAILABLE|RECEIPT_INVALID)$/); equal(tries, 1);
}
// Diagnostics retain only numeric HTTP status or a fixed network marker.
for (const status of [401,403,404,429,500]) {
 const p=createOwnerInboundProviders(config,{env,fetcher:async()=>Response.json({error:'DO_NOT_EXPOSE_PRIVATE_BODY'},{status})});
 await rejects(()=>p.twilio(callSid),error=>error.message==='OWNER_INBOUND_PROVIDER_UNAVAILABLE'&&error.providerHttpStatus===status&&!JSON.stringify(error).includes('DO_NOT_EXPOSE_PRIVATE_BODY'));
}
const network=createOwnerInboundProviders(config,{env,fetcher:async()=>{throw Error('DO_NOT_EXPOSE_PRIVATE_NETWORK_ERROR');}});
await rejects(()=>network.twilio(callSid),error=>error.message==='OWNER_INBOUND_PROVIDER_UNAVAILABLE'&&error.providerFailure==='network'&&!JSON.stringify(error).includes('DO_NOT_EXPOSE_PRIVATE_NETWORK_ERROR'));
const controller = new AbortController(); controller.abort();
const aborted = createOwnerInboundProviders(config, { env, signal: controller.signal, fetcher: async (_url, { signal }) => { check(signal.aborted); signal.throwIfAborted(); } });
await rejects(() => aborted.agent(), /PROVIDER_UNAVAILABLE/);

async function price(twilioChanges = {}, conversationChanges = {}) {
  const p = createOwnerInboundProviders(config, { env, fetcher: async url => Response.json(url.includes('/Calls/')
    ? { ...twilioReceipt, ...twilioChanges }
    : { ...conversationReceipt, ...conversationChanges }) });
  return p.costs(await p.twilio(callSid), await p.conversation(conversationId));
}
for (const amount of ['-0.000001', '-0.0085', '-0.123456']) {
  const value = await price({ price: amount }); equal(value.definitive, true); equal(value.twilioCostCents, null);
}
equal((await price({ price: '-0.0085' })).twilioCostMicros, 8500);
equal((await price({}, { metadata: { cost_fiat: 0.123456 } })).elevenLabsCostMicros, 123456);
for (const value of [null, undefined, '', '0.10', '+0.10', '-0.0000001', '-1e-2', '- 0.01', '--0.1', '-00.01', '-9007199254.740992', 0.01]) {
  const result = await price({ price: value }); equal(result.twilioCostMicros, null); equal(result.definitive, false); equal(result.totalCostMicros, null);
}
for (const value of ['EUR', 'usd', undefined, null]) equal((await price({ price_unit: value })).definitive, false);
for (const value of [undefined, null, '0.29', -1, 0.0000001, 9007199254.740992]) {
  const result = await price({}, { metadata: { cost_fiat: value, cost: 29, charging: { call_charge: 1, llm_charge: 1 } } }); equal(result.elevenLabsCostMicros, null); equal(result.definitive, false);
}
equal((await price({}, { metadata: { cost: 29 } })).elevenLabsCostMicros, null);
equal((await price({ status: 'in-progress' })).definitive, false);
equal((await price({}, { status: 'processing' })).definitive, false);
equal((await price({}, { status: 'failed' })).definitive, false);
const free = await price({ price: '0' }, { metadata: { cost_fiat: 0 } }); equal(free.totalCostMicros, 0); equal(free.definitive, true);
const overflow = await price({ price: '-9007199254' }, { metadata: { cost_fiat: 9007199254 } }); equal(overflow.definitive, false); equal(overflow.totalCostMicros, null);

// Browser environments cannot create an adapter or use previously created one.
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
try {
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  throws(() => createOwnerInboundProviders(config, { env, fetcher: never }), /SERVER_ONLY/);
  throws(() => providers.agent(), /SERVER_ONLY/); throws(() => providers.costs(twilio, conversation), /SERVER_ONLY/);
} finally {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else delete globalThis.window;
}
console.log(`Owner inbound provider adapter: ${count} assertions passed; regional GET-only receipts, scoped credentials, no redirects/retries, immutable provenance, exact USD micros/unknown. Synthetic fetch only.`);
