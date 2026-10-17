import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import ts from 'typescript';

const require=createRequire(import.meta.url);
const source=ts.transpileModule(readFileSync(new URL('../components/stripe-embedded-checkout.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
test('iframe focus is detected once without relying on an outer-window blur event',()=>{
 const saved=new Map(['window','document','setTimeout','clearTimeout','setInterval','clearInterval'].map(key=>[key,globalThis[key]]));
 const refs=[],effects=[],intervals=new Map(),timers=new Map(),outer=new EventTarget(),document=new EventTarget();let sequence=0,interactions=0;
 const ownFrame={tagName:'IFRAME'},otherFrame={tagName:'IFRAME'};
 document.activeElement={tagName:'BODY'};document.hidden=false;
 try{
  Object.assign(globalThis,{window:outer,document,setInterval:fn=>{intervals.set(++sequence,fn);return sequence;},clearInterval:id=>intervals.delete(id),setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id)});
  const hooks={useRef:value=>{const ref={current:value};refs.push(ref);return ref;},useState:value=>[value,()=>{}],useEffect:fn=>effects.push(fn)};
  const module={exports:{}};
  new Function('require','module','exports',source)(name=>name==='react'?hooks:name==='next/script'?{__esModule:true,default:'Script'}:require(name),module,module.exports);
  module.exports.StripeEmbeddedCheckout({clientSecret:'fixture',publishableKey:'pk_test_fixture',onComplete:()=>{},onInteract:()=>interactions++});
  refs[0].current={contains:node=>node===ownFrame};
  const cleanup=effects[0](),tick=()=>[...intervals.values()].forEach(fn=>fn());
  tick();assert.equal(interactions,0,'Mounting the payment form alone is not cart engagement');
  document.activeElement=otherFrame;tick();assert.equal(interactions,0,'Unrelated iframes cannot trigger this checkout');
  document.activeElement=ownFrame;document.hidden=true;tick();assert.equal(interactions,0);
  document.hidden=false;tick();assert.equal(interactions,1,'Iframe focus works even when no window blur event fires');
  assert.equal(intervals.size,0,'Polling stops after the first interaction');
  outer.dispatchEvent(new Event('blur'));[...timers.values()].forEach(fn=>fn());assert.equal(interactions,1);
  cleanup();assert.equal(intervals.size,0);assert.equal(timers.size,0);
  outer.dispatchEvent(new Event('blur'));document.dispatchEvent(new Event('focusin'));assert.equal(timers.size,0,'Unmount removes both event listeners');
 }finally{for(const [key,value] of saved){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
