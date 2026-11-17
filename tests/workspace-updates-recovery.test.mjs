import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as updates from '../lib/customer-updates.ts';
import {webinarRequest} from '../lib/webinar-client.ts';

// Exercise the real components and bounded request helper. All responses are
// fictional; these tests never save preferences, send updates or contact a host.
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch,originalDocument=globalThis.document;
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(' '):node&&typeof node==='object'?text(node.props?.children):'';
const elements=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
const preferences={email:'fixture@example.test',phone:'+12025550101',emailEnabled:false,smsEnabled:false,timezone:'America/Chicago',seenAt:null,emailAvailable:true,smsAvailable:true,emailSuppressed:false};
const item={id:'reply:fixture',kind:'seller_reply',screeningId:'fixture-property',createdAt:'2026-11-16T12:00:00Z',title:'A seller replied',detail:'A saved fixture message.',address:null};
const snapshot=(overrides={})=>({items:[item],preferences,...overrides});
function harness(component='WorkspaceUpdates',timeoutMs=500){
 let props=component==='WorkspaceUpdates'?{onPreferences(){},onBudget(){}}:{phone:'+12025550101'};
 let slots=[],cursor=0,dirty=true,effects=[],tree,disposed=false,lateUpdates=0,notify=()=>{};
 const events=new Map();globalThis.document={hidden:false,addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)};
 const hooks={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{if(disposed){lateUpdates++;return;}const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
  useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){slots[i]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}
 };
 const source=readFileSync(new URL('../components/workspace-updates.tsx',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const deps={react:hooks,'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/customer-updates':updates,'@/lib/webinar-client':{webinarRequest:(path,init)=>webinarRequest(path,init,timeoutMs)},'@/lib/workspace-events-client':{subscribeWorkspaceChanges:fn=>{notify=fn;return()=>{notify=()=>{};};}},'lucide-react':{Bell:'Bell',Mail:'Mail',MessageCircle:'MessageCircle',X:'X'}};
 const mod={exports:{}};new Function('require','module','exports',code)(name=>{assert(name in deps,'Unmocked import '+name);return deps[name];},mod,mod.exports);
 return {
  async flush(ms=0){const end=Date.now()+ms;do{if(dirty){cursor=0;dirty=false;tree=mod.exports[component](props);}const pending=effects;effects=[];pending.forEach(fn=>fn());await tick();}while(dirty||effects.length||Date.now()<end);return tree;},
  update(next){props={...props,...next};dirty=true;},
  notify:()=>notify(),
  visibility(hidden){document.hidden=hidden;events.get('visibilitychange')?.();},
  find(predicate){const result=elements(tree).find(predicate);assert(result,'Expected control: '+text(tree));return result;},
  text:()=>text(tree),
  dispose(){disposed=true;slots.forEach(slot=>slot?.cleanup?.());},
  lateUpdates:()=>lateUpdates
 };
}
const button=(ui,label)=>ui.find(n=>n.type==='button'&&text(n)===label);
const input=(ui,label)=>ui.find(n=>n.type==='input'&&n.props['aria-label']===label);
let count=0;
async function scenario(name,fn){if(process.env.SCENARIO&&!name.includes(process.env.SCENARIO))return;await fn();console.log('PASS '+(++count)+': '+name);}
try{
 await scenario('stalled inbox headers expose refresh and recover without a write',async()=>{
  let calls=0,signal;globalThis.fetch=async(_path,init)=>{assert.equal(init.method??'GET','GET');signal=init.signal;return ++calls===1?new Promise(()=>{}):Response.json(snapshot());};
  const ui=harness('WorkspaceUpdates',15);try{await ui.flush(40);assert(signal.aborted);assert.doesNotMatch(ui.text(),/Loading your bot/);button(ui,'Refresh updates').props.onClick();await ui.flush();assert.match(ui.text(),/A seller replied/);assert.equal(calls,2);}finally{ui.dispose();}
 });
 await scenario('malformed inbox snapshots retain saved history and offer refresh',async()=>{
  let calls=0;const malformed=[{items:null},{items:[null]},{items:[{...item,title:{invalid:true}}]},{preferences:{...preferences,seenAt:{invalid:true}}}];
  globalThis.fetch=async()=>Response.json(++calls===1?snapshot():snapshot(malformed[calls-2]));
  const ui=harness();try{await ui.flush();for(const invalid of malformed){void invalid;ui.notify();await ui.flush();assert.match(ui.text(),/A seller replied/);button(ui,'Refresh updates');}assert.equal(calls,5);}finally{ui.dispose();}
 });
 await scenario('an event during a response body coalesces one fresh read',async()=>{
  let calls=0,release;globalThis.fetch=async()=>++calls===1?{ok:true,json:()=>new Promise(resolve=>{release=resolve;})}:Response.json(snapshot({items:[{...item,title:'The latest seller reply'}]}));
  const ui=harness();try{await ui.flush();ui.notify();ui.notify();assert.equal(calls,1);release(snapshot());await ui.flush();assert.equal(calls,2);assert.match(ui.text(),/The latest seller reply/);}finally{ui.dispose();}
 });
 await scenario('hidden tabs defer a queued read until visible',async()=>{
  let calls=0,release;globalThis.fetch=async()=>++calls===1?{ok:true,json:()=>new Promise(resolve=>{release=resolve;})}:Response.json(snapshot());
  const ui=harness();try{await ui.flush();ui.notify();ui.visibility(true);release(snapshot());await ui.flush();assert.equal(calls,1);ui.visibility(false);await ui.flush();assert.equal(calls,2);}finally{ui.dispose();}
 });
 await scenario('a late timed-out inbox body cannot replace recovered history',async()=>{
  let calls=0,release;globalThis.fetch=async()=>++calls===1?{ok:true,json:()=>new Promise(resolve=>{release=resolve;})}:Response.json(snapshot({items:[{...item,title:'Current saved reply'}]}));
  const ui=harness('WorkspaceUpdates',15);try{await ui.flush(40);button(ui,'Refresh updates').props.onClick();await ui.flush();release(snapshot({items:[{...item,title:'Late stale reply'}]}));await ui.flush();assert.match(ui.text(),/Current saved reply/);assert.doesNotMatch(ui.text(),/Late stale reply/);assert.equal(calls,2);}finally{ui.dispose();}
 });
 await scenario('stalled preferences body exposes refresh and recovers',async()=>{
  let calls=0,signal;globalThis.fetch=async(_path,init)=>{assert.equal(init.method??'GET','GET');signal=init.signal;return ++calls===1?{ok:true,json:()=>new Promise(()=>{})}:Response.json(snapshot());};
  const ui=harness('BotUpdatePreferences',15);try{await ui.flush(40);assert(signal.aborted);assert.doesNotMatch(ui.text(),/Loading your preferences/);button(ui,'Refresh preferences').props.onClick();await ui.flush();assert.equal(input(ui,'Email activity updates').props.checked,false);assert.equal(calls,2);}finally{ui.dispose();}
 });
 await scenario('malformed preferences do not create enabled controls or a success claim',async()=>{
  for(const invalid of [null,{...preferences,emailEnabled:'yes'},{...preferences,timezone:{invalid:true}},{...preferences,email:{invalid:true}}]){
   globalThis.fetch=async()=>Response.json(snapshot({preferences:invalid}));const ui=harness('BotUpdatePreferences');try{await ui.flush();button(ui,'Refresh preferences');assert.doesNotMatch(ui.text(),/Save update preferences|Saved\./);}finally{ui.dispose();}
  }
 });
 await scenario('a preference refresh retains edited choices and never grants consent',async()=>{
  let calls=0,release;globalThis.fetch=async(_path,init)=>{assert.equal(init.method??'GET','GET');return ++calls===1?Response.json(snapshot()):new Promise(resolve=>{release=resolve;});};
  const ui=harness('BotUpdatePreferences');try{
   await ui.flush();input(ui,'Email activity updates').props.onChange({target:{checked:true}});await ui.flush();
   const consent=()=>ui.find(n=>n.type==='input'&&n.props.type==='checkbox'&&!n.props['aria-label']);
   consent().props.onChange({target:{checked:true}});await ui.flush();assert.equal(button(ui,'Save update preferences').props.disabled,false);
   ui.update({phone:'+12025550102'});await ui.flush();
   release(Response.json(snapshot({preferences:{...preferences,email:'changed@example.test',emailSuppressed:true}})));await ui.flush();
   assert.equal(input(ui,'Email activity updates').props.checked,true);assert.equal(consent().props.checked,false,'Consent for earlier destination evidence cannot carry across refresh');
   assert.equal(button(ui,'Save update preferences').props.disabled,true);assert.match(ui.text(),/changed@example.test/);assert.equal(calls,2);
  }finally{ui.dispose();}
 });
 await scenario('unmounted reads abort and ignore late results in both panels',async()=>{
  for(const component of ['WorkspaceUpdates','BotUpdatePreferences']){let release,signal;globalThis.fetch=async(_path,init)=>{signal=init.signal;return new Promise(resolve=>{release=resolve;});};const ui=harness(component);await ui.flush();ui.dispose();assert(signal.aborted);release(Response.json(snapshot()));await tick();await tick();assert.equal(ui.lateUpdates(),0);}
 });
}finally{globalThis.fetch=originalFetch;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
if(!process.env.SCENARIO)assert.equal(count,9);
console.log('Update-panel recovery scenarios passed without external requests or preference writes.');
