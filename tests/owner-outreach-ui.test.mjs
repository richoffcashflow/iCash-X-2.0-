import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {webinarRequest} from '../lib/webinar-client.ts';
import * as overview from '../lib/owner-overview.ts';
import * as outreach from '../lib/owner-outreach.ts';
import {ownerOutreachFixture as fixture} from './helpers/owner-outreach-fixture.mjs';
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
const nodes=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.props?.children)];
const text=root=>typeof root==='string'||typeof root==='number'?String(root):Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';
function harness(){
 let slots=[],cursor=0,dirty=true,pending=[],tree;
 const listeners=new Map();
 globalThis.document={visibilityState:'visible',addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
 globalThis.window={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],next=>{const v=typeof next==='function'?next(slots[i]):next;if(!Object.is(v,slots[i])){slots[i]=v;dirty=true;}}];},useEffect(fn,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,n)=>!Object.is(v,prior.deps[n]))){slots[i]={deps,cleanup:prior?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const code=ts.transpileModule(readFileSync(new URL('../app/admin/outreach.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}},deps={react:hooks,'@/lib/webinar-client':{webinarRequest:(path,init)=>webinarRequest(path,init,40)},'@/lib/owner-overview':overview,'@/lib/owner-outreach':outreach};
 new Function('require','module','exports',code)(name=>deps[name]??(name==='react/jsx-runtime'?require(name):{default:{}}),mod,mod.exports);
 return {async flush(){for(let i=0;i<20;i++){if(dirty){cursor=0;dirty=false;tree=mod.exports.OwnerOutreachView({days:30,includeOwner:false,refresh:0});}const effects=pending;pending=[];effects.forEach(fn=>fn());await tick();if(!dirty&&!pending.length)return;}throw Error('Render did not settle');},find(predicate){const node=nodes(tree).find(predicate);assert(node,'Expected UI control');return node;},text:()=>text(tree),focus:()=>listeners.get('focus')?.(),dispose(){slots.forEach(s=>s?.cleanup?.());}};
}

try{
 let mode='good',late,signal,calls=0;
 globalThis.fetch=async(path,init)=>{calls++;if(mode==='slow'){signal=init.signal;return new Promise(resolve=>{late=resolve;});}if(mode==='bad')return Response.json({report:{}});if(mode==='denied')return Response.json({error:'Owner required'},{status:403});return Response.json(fixture(path));};
 const ui=harness();
 try{
  await ui.flush();assert.match(ui.text(),/123 Example Street/);assert.match(ui.text(),/Seller responded/);assert.match(ui.text(),/0 with interested sellers/);assert.match(ui.text(),/2:30 PM/);
  mode='slow';ui.find(n=>n.type==='select').props.onChange({target:{value:'responded'}});await ui.flush();assert(!ui.text().includes('123 Example Street'));
  mode='good';ui.find(n=>n.type==='select').props.onChange({target:{value:'interested'}});await ui.flush();assert(signal.aborted);late(Response.json(fixture('/?days=30&status=responded','Stale property')));await ui.flush();assert(!ui.text().includes('Stale property'));assert.match(ui.text(),/No properties match/);
  ui.find(n=>n.type==='select').props.onChange({target:{value:'all'}});await ui.flush();
  mode='bad';ui.focus();await ui.flush();assert.match(ui.text(),/Outreach refresh failed/);assert.match(ui.text(),/123 Example Street/);assert.match(ui.text(),/Last successful update/);
  mode='good';ui.find(n=>n.type==='button'&&text(n)==='Retry outreach').props.onClick();await ui.flush();assert(!ui.text().includes('Outreach refresh failed'));
  mode='denied';ui.focus();await ui.flush();assert(!ui.text().includes('123 Example Street'));assert.match(ui.text(),/Sign in with the owner/);const before=calls;ui.focus();await ui.flush();assert.equal(calls,before);
 }finally{ui.dispose();}
 mode='slow';const stalled=harness();try{await stalled.flush();const before=calls;stalled.focus();stalled.focus();await new Promise(resolve=>setTimeout(resolve,50));await stalled.flush();assert.equal(calls,before);assert(signal.aborted);assert.match(stalled.text(),/too long/);assert(!stalled.text().includes('0 with interested sellers'));}finally{stalled.dispose();}
 console.log('PASS outreach UI: filter cancellation, late response isolation, real zero interest, private data clearing, labelled stale view, retry and bounded nonoverlapping reads.');
}finally{globalThis.fetch=originalFetch;}
