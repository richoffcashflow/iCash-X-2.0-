import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {webinarRequest} from '../lib/webinar-client.ts';
import * as reporting from '../lib/webinar-reporting.ts';
import * as funnel from '../lib/conversion-funnel.ts';
import * as policy from '../lib/webinar-policy.ts';
import * as icons from 'lucide-react';
import {ConversionFunnel} from './helpers/conversion-funnel.mjs';
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
const nodes=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.props?.children)];
const text=root=>typeof root==='string'||typeof root==='number'?String(root):Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';
const webinars=[{...policy.newWebinar('00000000-0000-4000-8000-000000000001'),title:'Main webinar'}];
const steps=counts=>funnel.webinarFunnelStages.map((s,i)=>({key:s.key,count:counts[i]}));
const fixture=url=>{
 const q=new URL(url,'https://example.invalid').searchParams;
 return {period:q.get('period'),timezone:q.get('timezone'),startDate:'2026-10-10',endDate:'2026-10-10',startsAt:'2026-10-10T05:00:00Z',endsAt:'2026-10-11T05:00:00Z',generatedAt:'2026-10-10T12:30:00Z',summary:{...reporting.emptyFunnel,viewers:5,cohortBuyers:1},webinars:[],recordings:[],days:[],conversionFunnel:{summary:steps([5,3,2,2,1]),webinars:[{webinarId:webinars[0].id,steps:steps([3,2,1,1,1])}]}};
};
function harness(){
 let slots=[],cursor=0,dirty=true,pending=[],tree;
 const listeners=new Map();
 globalThis.document={hidden:false,addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],next=>{const v=typeof next==='function'?next(slots[i]):next;if(!Object.is(v,slots[i])){slots[i]=v;dirty=true;}}];},useEffect(fn,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,n)=>!Object.is(v,prior.deps[n]))){slots[i]={deps,cleanup:prior?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const code=ts.transpileModule(readFileSync(new URL('../components/webinar-daily-dashboard.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const mod={exports:{}},deps={react:hooks,'lucide-react':icons,'@/lib/webinar-client':{webinarRequest},'@/lib/webinar-reporting':reporting,'@/lib/conversion-funnel':funnel,'@/components/conversion-funnel':{ConversionFunnel},'@/lib/webinar-policy':policy,'@/lib/webinar-site':{webinarSite:{brandName:'iCash X'}},'@/lib/webinar-links':{webinarLink:()=>'/fixture-webinar'}};
 new Function('require','module','exports',code)(name=>deps[name]??require(name),mod,mod.exports);
 return {async flush(){for(let i=0;i<20;i++){if(dirty){cursor=0;dirty=false;tree=mod.exports.WebinarDailyDashboard({webinars});}const effects=pending;pending=[];effects.forEach(fn=>fn());await tick();if(!dirty&&!pending.length)return;}throw Error('Render did not settle');},find(predicate){const node=nodes(tree).find(predicate);assert(node,'Expected UI control');return node;},funnel(){return this.find(n=>n.type===ConversionFunnel).props;},text:()=>text(tree),visible:()=>listeners.get('visibilitychange')?.(),dispose(){slots.forEach(s=>s?.cleanup?.());}};
}
let count=0;
async function scenario(name,fn){await fn();console.log(`PASS ${++count}/4 ${name}`);}
try{
 await scenario('Period changes abort older reads and the webinar selector scopes only the funnel without another request',async()=>{
  let late,signal,calls=0;globalThis.fetch=async(path,init)=>{calls++;if(path.includes('period=7d&')){signal=init.signal;return new Promise(resolve=>{late=resolve;});}return Response.json(fixture(path));};
  const ui=harness();try{await ui.flush();assert.equal(ui.funnel().steps[0].count,5);const before=calls;nodes(ui.funnel().controls).find(n=>n.type==='select').props.onChange({target:{value:webinars[0].id}});await ui.flush();assert.equal(ui.funnel().steps[0].count,3);assert.equal(calls,before);ui.find(n=>n.type==='button'&&text(n)==='Last 7 days').props.onClick();await ui.flush();assert.equal(ui.funnel().steps,undefined);ui.find(n=>n.type==='button'&&text(n)==='Today').props.onClick();await ui.flush();assert(signal.aborted);late(Response.json(fixture('/?period=7d&timezone=America/Chicago')));await ui.flush();assert.equal(ui.funnel().steps[0].count,3);}finally{ui.dispose();}
 });
 await scenario('A failed refresh keeps labelled prior counts and retry recovers',async()=>{
  let failed=false;globalThis.fetch=async path=>failed?Response.json({error:'Temporary outage'},{status:503}):Response.json(fixture(path));
  const ui=harness();try{await ui.flush();failed=true;ui.find(n=>n.props?.['aria-label']==='Refresh results').props.onClick();await ui.flush();assert.match(ui.text(),/Last successful update/);assert.equal(ui.funnel().steps[0].count,5);failed=false;ui.find(n=>n.type==='button'&&text(n)==='Try again').props.onClick();await ui.flush();assert(!ui.text().includes('Refresh failed'));}finally{ui.dispose();}
 });
 await scenario('Lost authorization clears the funnel and stops background requests',async()=>{
  let denied=false,calls=0;globalThis.fetch=async path=>{calls++;return denied?Response.json({error:'Owner required'},{status:403}):Response.json(fixture(path));};
  const ui=harness();try{await ui.flush();denied=true;ui.visible();await ui.flush();assert.equal(ui.funnel().steps,undefined);assert.equal(ui.funnel().unavailable,true);assert(!ui.text().includes('Last successful update'));const before=calls;ui.visible();await ui.flush();assert.equal(calls,before);}finally{ui.dispose();}
 });
 await scenario('An impossible funnel is rejected without displaying fabricated zeros',async()=>{
  globalThis.fetch=async path=>{const r=fixture(path);r.conversionFunnel.summary[1].count=6;return Response.json(r);};
  const ui=harness();try{await ui.flush();assert.match(ui.text(),/incomplete data/);assert.equal(ui.funnel().steps,undefined);assert.equal(ui.funnel().unavailable,true);assert(!ui.text().includes('$0.00'));}finally{ui.dispose();}
 });
}finally{globalThis.fetch=originalFetch;}
assert.equal(count,4);
