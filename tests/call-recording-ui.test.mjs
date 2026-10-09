import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const recordingSource = readFileSync(new URL('../components/call-recording.tsx', import.meta.url), 'utf8');
const conversationSource = readFileSync(new URL('../components/call-conversation.tsx', import.meta.url), 'utf8');
function load(source, dependencies = {}) {
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}};
  new Function('require', 'module', 'exports', code)(name => dependencies[name] ?? require(name), module, module.exports);
  return module.exports;
}
const {ReceiptDetails, readReceipt, recordingStates} = load(recordingSource + '\nexport {ReceiptDetails, readReceipt, recordingStates};');
const conversationId = '11111111-1111-4111-8111-111111111111';
const otherConversationId = '22222222-2222-4222-8222-222222222222';
const recordingId = '33333333-3333-4333-8333-333333333333';
const otherRecordingId = '44444444-4444-4444-8444-444444444444';
const providerSid = 'RE' + 'a'.repeat(32);
const fixture = {
  id: recordingId, status: 'available', durationSeconds: 62,
  audioExpiresAt: '2026-11-02T04:00:00.000Z',
  providerReceipt: {provider: 'Twilio', recordingSid: providerSid, startAt: '2026-10-03T04:00:00.000Z', endAt: '2026-10-03T04:01:02.000Z'},
  costs: {status: 'estimated', holdCents: 977, customerChargeCents: 147, items: [
    {label: 'Telephony', basis: 'observed', amountMicros: 134000},
    {label: 'Recording storage', basis: 'estimated', amountMicros: 123},
    {label: 'Voice agent', basis: 'pending', amountMicros: null},
    {label: 'Unused service', basis: 'not_applicable', amountMicros: null},
  ]},
};
const renderReceipt = receipt => renderToStaticMarkup(ReceiptDetails({receipt}));
let html = renderReceipt(readReceipt(fixture));
assert.match(html, /<audio[^>]*controls=""[^>]*preload="none"[^>]*aria-label="Call recording"/);
assert.match(html, new RegExp('src="/api/work/recording/audio\\?id=' + recordingId + '"'));
assert.doesNotMatch(html, /autoplay|https:\/\/|download prevention|cannot (?:download|save)/i);
assert.match(html, /Available until/);
assert.doesNotMatch(html, /Twilio|RE[a-f0-9]{32}|Reserved|cost|charge|\$[0-9]/);
for (const status of Object.keys(recordingStates)) {
  html = renderReceipt(readReceipt({...fixture, status}));
  assert.equal(html.includes('<audio'), status === 'available', `audio is gated by ${status}`);
  if(status!=='available')assert(html.includes(recordingStates[status]));
}
html = renderReceipt(readReceipt({status: 'not_recorded'}));
assert.match(html, /This call was not recorded/);
assert.doesNotMatch(html, /<audio|Could not|\$0.00|Settled customer charge/);
html = renderReceipt(readReceipt({...fixture, durationSeconds: null, providerReceipt: null}));
assert.match(html, /<audio/);
html = renderReceipt(readReceipt({...fixture, audioUrl:'https://provider.example/private-secret'}));
assert.doesNotMatch(html, /provider\.example|private-secret/);
html = renderToStaticMarkup(ReceiptDetails({receipt:readReceipt({...fixture,audioAvailable:true}),source:'reception'}));
assert.match(html,/reception-recording\/audio/);
html = renderReceipt(readReceipt({...fixture,audioAvailable:false}));assert.doesNotMatch(html, /<audio/);
for(const invalid of [null,{}, {...fixture,status:'toString'},{...fixture,id:providerSid},{...fixture,id:null},{...fixture,durationSeconds:-1},{...fixture,audioExpiresAt:'not-a-date'}])assert.throws(()=>readReceipt(invalid),/Invalid recording/);

// Small hook runner matching repository conventions; promises and effect cleanups are real.
const elements = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(elements) : [root, ...elements(root.props?.children)];
const text = root => typeof root === 'string' ? root : typeof root === 'number' ? String(root) : Array.isArray(root) ? root.map(text).join(' ') : root && typeof root === 'object' ? text(root.props?.children) : '';
function harness(source, name, initialProps, dependencies = {}) {
  let slots = [], cursor = 0, dirty = true, effects = [], tree, props = initialProps, mounted = true, writesAfterUnmount = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => {
        if (!mounted) {writesAfterUnmount++; return;}
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) {slots[index] = value; dirty = true;}
      }];
    },
    useRef(initial) {const index = cursor++; if (!(index in slots)) slots[index] = {current: initial}; return slots[index];},
    useEffect(run, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, depIndex) => !Object.is(value, previous.deps[depIndex]))) {
        slots[index] = {deps, cleanup: previous?.cleanup};
        effects.push(() => {slots[index].cleanup?.(); slots[index].cleanup = run();});
      }
    },
  };
  const component = load(source, {...dependencies, react: hooks})[name];
  function render() {cursor = 0; dirty = false; tree = component(props); return tree;}
  async function flush() {
    for (let index = 0; index < 20; index++) {
      if (dirty) render();
      const pending = effects; effects = []; pending.forEach(run => run());
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!dirty && !effects.length) return tree;
    }
    throw Error('Render did not settle');
  }
  return {
    render, flush,
    props(next) {props = next; dirty = true; return render();},
    get tree() {return tree;},
    get writesAfterUnmount() {return writesAfterUnmount;},
    markup() {return renderToStaticMarkup(tree);},
    button(label) {const found = elements(tree).find(node => node.type === 'button' && text(node) === label); assert(found, `button: ${label}`); return found;},
    unmount() {mounted = false; slots.forEach(slot => slot?.cleanup?.());},
  };
}
function queuedFetch() {
  const calls = [];
  globalThis.fetch = (url, options = {}) => new Promise((resolve, reject) => calls.push({url, options, resolve, reject}));
  return calls;
}
let calls = queuedFetch();
let view = harness(recordingSource, 'CallRecording', {conversationId});
view.render();
assert.equal(calls.length, 0, 'receipt starts with no render-time request');
await view.flush();
assert.equal(calls.length, 1);
assert.equal(calls[0].url, `/api/work/recording?conversationId=${conversationId}`);
assert.equal(calls[0].options.cache, 'no-store');
assert.equal(calls[0].options.credentials, 'same-origin');
assert.equal(calls[0].options.signal.aborted, false);
assert.match(view.markup(), /role="status">Loading recording/);
view.render(); await view.flush(); assert.equal(calls.length, 1, 'rerenders do not refetch');
calls[0].resolve(new Response(null, {status: 404})); await view.flush();
assert.match(view.markup(), /This call was not recorded/);
assert.doesNotMatch(view.markup(), /role="alert"|<audio|Could not load/);
assert.equal(calls.length, 1, 'settling data does not start another request');
view.unmount(); assert.equal(calls[0].options.signal.aborted, true);

calls = queuedFetch(); view = harness(recordingSource, 'CallRecording', {conversationId});
await view.flush(); calls[0].resolve(Response.json({error: 'PRIVATE_PROVIDER_SECRET'}, {status: 503})); await view.flush();
assert.match(view.markup(), /role="alert">Could not load this recording/);
assert.doesNotMatch(view.markup(), /PRIVATE_PROVIDER_SECRET|Loading recording/);
const retry = view.button('Retry recording'); retry.props.onClick(); retry.props.onClick();
view.render(); assert.match(view.markup(), /Loading recording/); assert.doesNotMatch(view.markup(), /role="alert"/);
await view.flush(); assert.equal(calls.length, 2, 'double retry starts only one request');
calls[1].resolve(Response.json(fixture)); await view.flush();
assert.match(view.markup(), /<audio/);
assert.equal(calls.length, 2);
view.props({conversationId: otherConversationId});
assert.doesNotMatch(view.markup(), /<audio|33333333/, 'new ID hides old audio before effects');
await view.flush(); assert.equal(calls[1].options.signal.aborted, true);
assert.equal(calls[2].url, `/api/work/recording?conversationId=${otherConversationId}`);
calls[2].resolve(Response.json({...fixture, id: otherRecordingId})); await view.flush();
assert.match(view.markup(), new RegExp(otherRecordingId)); assert.doesNotMatch(view.markup(), new RegExp(recordingId));
view.unmount();

calls = queuedFetch(); view = harness(recordingSource, 'CallRecording', {conversationId});
await view.flush(); view.props({conversationId: otherConversationId}); await view.flush();
assert.equal(calls[0].options.signal.aborted, true);
calls[1].resolve(Response.json({status: 'not_recorded'})); await view.flush();
calls[0].resolve(Response.json(fixture)); await view.flush();
assert.match(view.markup(), /This call was not recorded/); assert.doesNotMatch(view.markup(), /<audio/);
view.unmount();

calls = queuedFetch(); view = harness(recordingSource, 'CallRecording', {conversationId});
await view.flush(); view.unmount(); assert.equal(calls[0].options.signal.aborted, true);
calls[0].resolve(Response.json(fixture)); await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(view.writesAfterUnmount, 0, 'closed transcript cannot publish late receipt');
view = harness(recordingSource, 'CallRecording', {conversationId}); await view.flush();
assert.equal(calls.length, 2, 'reopening resets an aborted request');
assert.equal(calls[1].options.signal.aborted, false);
calls[1].resolve(Response.json({...fixture, status: 'processing'})); await view.flush();
const refresh = view.button('Refresh recording'); refresh.props.onClick(); refresh.props.onClick(); await view.flush();
assert.equal(calls.length, 3); assert.match(view.markup(), /Loading recording/);
calls[2].resolve(Response.json({...fixture, id: providerSid})); await view.flush();
assert.match(view.markup(), /Could not load this recording/); assert.doesNotMatch(view.markup(), /<audio/);
view.unmount();

// Transcript integration stays lazy, retains pagination, and passes application ID unchanged.
const recordingStub = () => null;
const dependencies = {'./call-recording': {CallRecording: recordingStub}, './workspace-view': {safeLocalTime: () => 'Fixture time'}};
calls = queuedFetch();
view = harness(conversationSource, 'CallConversation', {id: conversationId, party: 'seller'}, dependencies);
await view.flush(); assert.equal(calls.length, 0);
assert(elements(view.tree).some(node => node.type === recordingStub), 'player visible before opening transcript');
function toggle(open) {const details = elements(view.tree).find(node => node.type === 'details'); const target = {open}; details.props.onToggle({target, currentTarget: target});}
toggle(true); await view.flush(); assert.equal(calls.length, 1);
assert.equal(calls[0].url, `/api/work/conversation?id=${conversationId}&source=outbound`);
let receiptNode = elements(view.tree).find(node => node.type === recordingStub);
assert.equal(receiptNode.props.conversationId, conversationId); assert.equal(receiptNode.key, `outbound:${conversationId}`);
calls[0].resolve(Response.json({transcript: [{role: 'agent', message: 'Current transcript'}], next: 60})); await view.flush();
assert.match(text(view.tree), /Current transcript/); assert.equal(calls.length, 1);
view.button('Earlier in call').props.onClick(); await view.flush();
assert.equal(calls[1].url, `/api/work/conversation?id=${conversationId}&source=outbound&before=60`);
calls[1].resolve(Response.json({transcript: [{role: 'user', message: 'Earlier transcript'}], next: null})); await view.flush();
assert.match(text(view.tree), /Earlier transcript/);
view.props({id: otherConversationId, party: 'buyer'});
assert.doesNotMatch(text(view.tree), /Earlier transcript/, 'new conversation never displays stale transcript');
await view.flush(); assert.equal(calls[2].url, `/api/work/conversation?id=${otherConversationId}&source=outbound`, 'pagination resets for a new call');
receiptNode = elements(view.tree).find(node => node.type === recordingStub);
assert.equal(receiptNode.key, `outbound:${otherConversationId}`);
calls[2].resolve(new Response(null, {status: 500})); await view.flush();
assert.match(text(view.tree), /Could not load this call/);
const transcriptRetry = view.button('Retry conversation'); transcriptRetry.props.onClick(); transcriptRetry.props.onClick(); await view.flush();
assert.equal(calls.length, 4); assert.match(text(view.tree), /Loading conversation/); assert.doesNotMatch(text(view.tree), /Could not load/);
toggle(false); await view.flush(); assert.equal(calls[3].options.signal.aborted, true);
assert(elements(view.tree).some(node => node.type === recordingStub), 'closing transcript keeps recording available');
calls[3].resolve(Response.json({transcript: [{role: 'agent', message: 'Late response'}], next: null})); await view.flush();
toggle(true); await view.flush(); assert.equal(calls.length, 5);
assert.doesNotMatch(text(view.tree), /Late response|Could not load/);
calls[4].resolve(Response.json({transcript: [], next: null})); await view.flush();
assert.equal(calls.length, 5); assert.doesNotMatch(text(view.tree), /Loading conversation/);
view.unmount();

assert.doesNotMatch(recordingSource, /localStorage|sessionStorage|dangerouslySetInnerHTML|recordingUrl|controlsList|autoPlay/);
calls=queuedFetch();view=harness(recordingSource,'CallRecording',{conversationId,source:'reception'});
await view.flush();assert.equal(calls[0].url,`/api/work/reception-recording?id=${conversationId}`);
calls[0].resolve(Response.json({...fixture,audioAvailable:true}));await view.flush();assert.match(view.markup(),/reception-recording\/audio/);
view.props({conversationId,source:'outbound'});assert.doesNotMatch(view.markup(),/<audio/,'source switches hide stale audio');await view.flush();view.unmount();
console.log('Call player/transcript: authenticated playback, lazy audio, sanitized states, inbound/outbound routes, contact-switch races, retries and transcript pagination passed.');
