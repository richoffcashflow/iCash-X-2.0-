import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {createPollCadence} from '../lib/poll-cadence.ts';
const require=createRequire(import.meta.url);
function load(source,dependencies={}) {
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports',code)(name=>dependencies[name]??require(name),module,module.exports);return module.exports;
}
const recordingSource=readFileSync(new URL('../components/call-recording.tsx',import.meta.url),'utf8');
const historySource=readFileSync(new URL('../components/property-call-history.tsx',import.meta.url),'utf8');
const {readReceipt}=load(recordingSource),callStub=()=>null;
const dependencies={'./call-recording':{readReceipt},'./call-conversation':{CallConversation:callStub},'@/lib/poll-cadence':{createPollCadence}};
const {readHistory}=load(historySource+'\nexport {readHistory};',dependencies);
const screeningId='11111111-1111-4111-8111-111111111111',otherScreeningId='22222222-2222-4222-8222-222222222222';
const recordingId='33333333-3333-4333-8333-333333333333',otherRecordingId='44444444-4444-4444-8444-444444444444';
const conversationId='55555555-5555-4555-8555-555555555555';
const fixture={id:recordingId,status:'processing',createdAt:'2026-10-16T05:00:00.000Z',durationSeconds:null,audioExpiresAt:null,audioAvailable:false,source:'outbound',party:'seller',conversationId:null};
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
const originalDocument=globalThis.document,originalTimeout=globalThis.setTimeout,originalClearTimeout=globalThis.clearTimeout;
const timers=new Map(),listeners=new Map();let timerIndex=0;
globalThis.document={hidden:false,addEventListener:(type,callback)=>listeners.set(type,callback),removeEventListener:(type,callback)=>{if(listeners.get(type)===callback)listeners.delete(type);}};
globalThis.setTimeout=(callback,delay=0,...args)=>delay===0?originalTimeout(callback,delay,...args):(()=>{const id=++timerIndex;timers.set(id,{callback,delay});return id;})();
globalThis.clearTimeout=id=>timers.has(id)?timers.delete(id):originalClearTimeout(id);
const advancePoll=()=>{const [id,timer]=timers.entries().next().value??[];assert(timer,'poll timer exists');timers.delete(id);timer.callback();};
const callNodes=view=>elements(view.tree).filter(node=>node.type===callStub);
try {
 assert.equal(readHistory({recordings:[fixture],next:null}).recordings.length,1);
 for(const invalid of [null,{}, {recordings:[fixture,fixture],next:null},{recordings:[{...fixture,createdAt:'invalid'}],next:null},{recordings:[fixture],next:-1},{recordings:[{...fixture,conversationId:'provider-call-id'}],next:null}])assert.throws(()=>readHistory(invalid),/Invalid call history/);
 let calls=queuedFetch(),view=harness(historySource,'PropertyCallHistory',{screeningId,conversations:[]},dependencies);
 await view.flush();assert.equal(calls.length,1);assert.match(text(view.tree),/Loading call recordings/);
 assert.equal(calls[0].url,`/api/work/call-history?screeningId=${screeningId}&page=0`);
 assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');
 calls[0].resolve(Response.json({recordings:[fixture],next:null}));await view.flush();
 let row=callNodes(view)[0];assert.equal(row.props.recordingId,recordingId);assert.equal(row.props.transcriptAvailable,false);
 assert.equal(row.props.recordingReceipt.status,'processing');assert.doesNotMatch(text(view.tree),/No call recordings|Loading call recordings/);
 assert.equal(timers.size,1);advancePoll();await view.flush();assert.equal(calls.length,2);
 calls[1].resolve(Response.json({recordings:[{...fixture,status:'available',audioAvailable:true,durationSeconds:62,audioExpiresAt:'2027-01-01T00:00:00Z'}],next:null}));await view.flush();
 row=callNodes(view)[0];assert.equal(row.props.recordingReceipt.status,'available');assert.equal(row.key,`recording:outbound:${recordingId}`);
 assert.equal(row.props.transcriptAvailable,false,'audio becomes available without a completed transcript');
 advancePoll();await view.flush();calls[2].resolve(new Response(null,{status:503}));await view.flush();
 assert.match(text(view.tree),/Call recordings could not refresh/);assert.equal(callNodes(view)[0].props.recordingReceipt.status,'available','metadata failure keeps previously available audio');
 view.props({screeningId:otherScreeningId,conversations:[]});assert.equal(callNodes(view).length,0,'switching properties never shows previous audio');
 await view.flush();assert.equal(calls[2].options.signal.aborted,true);assert.match(calls[3].url,new RegExp(otherScreeningId));
 view.unmount();assert.equal(calls[3].options.signal.aborted,true);assert.equal(timers.size,0);assert.equal(listeners.size,0);
 calls[3].resolve(Response.json({recordings:[fixture],next:null}));await new Promise(resolve=>originalTimeout(resolve,0));assert.equal(view.writesAfterUnmount,0);

 // Existing inbound/history remains visible, while matched outbound recordings appear only once.
 calls=queuedFetch();view=harness(historySource,'PropertyCallHistory',{screeningId,conversations:[{id:conversationId,source:'outbound',party:'seller',completed_at:'2026-10-16T05:02:00Z'},{id:otherRecordingId,source:'reception',party:'buyer',completed_at:'2026-10-16T05:01:00Z'}]},dependencies);
 await view.flush();assert.equal(callNodes(view).length,2,'existing history is available during recording lookup');
 calls[0].resolve(Response.json({recordings:[{...fixture,status:'available',audioAvailable:true,conversationId}],next:1}));await view.flush();
 assert.equal(callNodes(view).length,2);assert.equal(callNodes(view).filter(node=>node.props.source==='reception').length,1);
 assert.equal(callNodes(view).find(node=>node.props.source==='outbound').props.recordingId,recordingId);
 view.button('Older recordings').props.onClick();await view.flush();assert.equal(callNodes(view).length,0,'older page does not repeat first-page fallback');assert.match(calls[1].url,/page=1$/);
 calls[1].resolve(Response.json({recordings:[{...fixture,id:otherRecordingId}],next:null}));await view.flush();assert.equal(callNodes(view).length,1);
 view.button('Latest recordings').props.onClick();await view.flush();assert.match(calls[2].url,/page=0$/);
 calls[2].resolve(Response.json({recordings:[],next:null}));await view.flush();assert.equal(callNodes(view).length,2,'legacy calls survive missing recording receipts');
 view.unmount();assert.equal(timers.size,0);

 calls=queuedFetch();view=harness(historySource,'PropertyCallHistory',{screeningId,conversations:[]},dependencies);await view.flush();
 calls[0].resolve(Response.json({recordings:[{...fixture,voicemail:true}],next:1}));await view.flush();
 assert.equal(callNodes(view).length,0,'Confirmed voicemail is hidden by default');assert.match(text(view.tree),/Only voicemail in this view/);
 elements(view.tree).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await view.flush();
 assert.equal(callNodes(view).length,1,'Historical audio remains available on request');assert.doesNotMatch(text(view.tree),/Only voicemail in this view/);assert(view.button('Older recordings'));view.unmount();

 calls=queuedFetch();view=harness(historySource,'PropertyCallHistory',{screeningId,conversations:[]},dependencies);await view.flush();
 calls[0].resolve(Response.json({recordings:[],next:null}));await view.flush();assert.match(text(view.tree),/No call recordings yet/);
 document.hidden=true;advancePoll();await view.flush();assert.equal(calls.length,1,'hidden tabs do not poll');document.hidden=false;
 listeners.get('visibilitychange')();await view.flush();assert.equal(calls.length,2,'visible tabs refresh promptly');
 view.unmount();assert.equal(timers.size,0);assert.equal(listeners.size,0);
} finally {globalThis.document=originalDocument;globalThis.setTimeout=originalTimeout;globalThis.clearTimeout=originalClearTimeout;}
console.log('Property recording history: transcript-independent audio, late processing refresh, stable player IDs, pagination, legacy inbound fallback, scoped races and polling cleanup passed.');
