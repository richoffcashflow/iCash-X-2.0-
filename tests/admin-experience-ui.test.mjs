import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {webinarRequest} from '../lib/webinar-client.ts';
import {overviewTime} from '../lib/owner-overview.ts';
import {workspaceExperienceSummarySchema} from '../lib/workspace-experience.ts';
import {reliabilityAlertStatusSchema} from '../lib/reliability-alerts.ts';
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch,originalDocument=globalThis.document,originalWindow=globalThis.window;
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
const nodes=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.props?.children)];
const text=root=>typeof root==='string'||typeof root==='number'?String(root):Array.isArray(root)?root.map(text).join(''):root&&typeof root==='object'?text(root.props?.children):'';
const fixture=()=>({experience:{days:7,lastObservedAt:'2026-10-14T18:30:00Z',counts:[{event:'panel_open',stage:'closing',count:123,accounts:3},{event:'panel_error',stage:'closing',count:5,accounts:2},{event:'panel_retry',stage:'closing',count:4,accounts:2}]},alerts:{configuration:'ready',checkedAt:'2026-10-14T18:31:00Z',active:{id:'78728740-8280-4fb3-a843-3247ae938fe1',openedAt:'2026-10-14T18:00:00Z',issueCount:2,reasons:['worker']},notifications:{pending:1,accepted:2,needsReview:1},lastNotificationAt:'2026-10-14T18:31:00Z'}});
function harness(){
 let slots=[],cursor=0,dirty=true,pending=[],tree;
 const listeners=new Map();
 globalThis.document={visibilityState:'visible',addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
 globalThis.window={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},useEffect(fn,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((value,n)=>!Object.is(value,prior.deps[n]))){slots[i]={deps,cleanup:prior?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const code=ts.transpileModule(readFileSync(new URL('../app/admin/experience-health.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}},deps={react:hooks,'@/lib/webinar-client':{webinarRequest:(path,init)=>webinarRequest(path,init,40)},'@/lib/owner-overview':{overviewTime},'@/lib/workspace-experience':{workspaceExperienceSummarySchema},'@/lib/reliability-alerts':{reliabilityAlertStatusSchema}};
 new Function('require','module','exports',code)(name=>deps[name]??(name==='react/jsx-runtime'?require(name):{default:{}}),mod,mod.exports);
 return {async flush(){for(let i=0;i<20;i++){if(dirty){cursor=0;dirty=false;tree=mod.exports.ExperienceHealth();}const effects=pending;pending=[];effects.forEach(fn=>fn());await tick();if(!dirty&&!pending.length)return;}throw Error('Render did not settle');},find(predicate){const node=nodes(tree).find(predicate);assert(node,'Expected UI control');return node;},text:()=>text(tree),focus:()=>listeners.get('focus')?.(),visible:()=>listeners.get('visibilitychange')?.(),dispose(){slots.forEach(slot=>slot?.cleanup?.());}};
}
let count=0;
async function scenario(name,fn){await fn();console.log(`PASS ${++count}/5 ${name}`);}
try{
 await scenario('Aggregate experience and incident state use honest labels and 12-hour time',async()=>{
  globalThis.fetch=async(path,init)=>{assert.equal(path,'/api/admin/experience');assert.equal(init.cache,'no-store');return Response.json(fixture());};
  const ui=harness();try{await ui.flush();assert.match(ui.text(),/123 panel opens/);assert.match(ui.text(),/5 panel errors/);assert.match(ui.text(),/4 retries/);assert.match(ui.text(),/Closing: 5 errors across 2 accounts/);assert.match(ui.text(),/not completed deals or a churn rate/);assert.match(ui.text(),/accepted by the email provider/);assert.match(ui.text(),/does not confirm delivery/);assert.match(ui.text(),/1:31 PM/);assert(!ui.text().includes('78728740'));}finally{ui.dispose();}
 });
 await scenario('Failed refresh keeps labelled saved counts and retry recovers',async()=>{
  let fail=false;globalThis.fetch=async()=>fail?Response.json({error:'Private provider error'},{status:503}):Response.json(fixture());
  const ui=harness();try{await ui.flush();fail=true;ui.focus();await ui.flush();assert.match(ui.text(),/Showing the last saved checks/);assert.match(ui.text(),/123 panel opens/);assert(!ui.text().includes('Private provider'));fail=false;ui.find(n=>n.type==='button'&&text(n)==='Try again').props.onClick();await ui.flush();assert(!ui.text().includes('Refresh failed'));}finally{ui.dispose();}
 });
 await scenario('Lost owner access erases all saved counts and stops polling',async()=>{
  for(const status of [401,403]){let denied=false,calls=0;globalThis.fetch=async()=>{calls++;return denied?Response.json({error:'Denied'},{status}):Response.json(fixture());};
   const ui=harness();try{await ui.flush();denied=true;ui.focus();await ui.flush();assert.match(ui.text(),/Sign in with the owner account/);assert(!ui.text().includes('123'));assert(!ui.text().includes('Background worker'));const prior=calls;ui.focus();ui.visible();await ui.flush();assert.equal(calls,prior);}finally{ui.dispose();}}
 });
 await scenario('Malformed data cannot turn into reassuring zero totals or leak extra fields',async()=>{
  globalThis.fetch=async()=>Response.json({...fixture(),alerts:{...fixture().alerts,email:'private@example.invalid'}});const ui=harness();try{await ui.flush();assert.match(ui.text(),/Experience checks could not load/);assert(!ui.text().includes('0 panel opens'));assert(!ui.text().includes('private@example.invalid'));}finally{ui.dispose();}
 });
 await scenario('Stalled requests are bounded, visibility does not overlap them, and unmount aborts',async()=>{
  let calls=0,signal;globalThis.fetch=async(_path,init)=>{calls++;signal=init.signal;return new Promise(()=>{});};
  const ui=harness();try{await ui.flush();ui.focus();ui.visible();await new Promise(resolve=>setTimeout(resolve,50));await ui.flush();assert.equal(calls,1);assert(signal.aborted);assert.match(ui.text(),/Experience checks could not load/);assert.equal(ui.find(n=>n.type==='button'&&text(n)==='Try again').props.disabled,false);}finally{ui.dispose();}
  const unmounted=harness();await unmounted.flush();assert(!signal.aborted);unmounted.dispose();assert(signal.aborted);
 });
}finally{globalThis.fetch=originalFetch;globalThis.document=originalDocument;globalThis.window=originalWindow;}
assert.equal(count,5);
