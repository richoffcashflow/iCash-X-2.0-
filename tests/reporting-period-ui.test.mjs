// Execute the real report component with deterministic transport; no live services.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as activity from '../lib/activity-report.ts';
import {validOpportunityProgress} from '../lib/opportunity-progress.ts';
const require=createRequire(import.meta.url),saved={fetch:globalThis.fetch,document:globalThis.document,setInterval,clearInterval};
const documentTarget=new EventTarget();documentTarget.hidden=false;globalThis.document=documentTarget;
const requests=[],timers=new Map();let timerId=0;
globalThis.fetch=(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve:data=>resolve({ok:true,json:async()=>data}),reject}));
globalThis.setInterval=fn=>{timers.set(++timerId,fn);return timerId;};globalThis.clearInterval=id=>timers.delete(id);
let cells=[],cursor=0,dirty=true,pending=[],tree;
const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
const hooks={useState(initial){const i=cursor++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return[cells[i],next=>{const value=typeof next==='function'?next(cells[i]):next;if(!Object.is(value,cells[i])){cells[i]=value;dirty=true;}}];},useEffect(fn,deps){const i=cursor++,old=cells[i];if(!same(old?.deps,deps)){cells[i]={deps,cleanup:old?.cleanup};pending.push(()=>{cells[i].cleanup?.();cells[i].cleanup=fn();});}}};
const mod={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../components/budget-summary.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='@/lib/activity-report'?activity:require(name),mod,mod.exports);
let props={days:1,timezone:'America/Chicago',onDaysChange(days){props={...props,days};dirty=true;}};
async function flush(){for(let i=0;i<12;i++){if(dirty){cursor=0;dirty=false;tree=mod.exports.BudgetSummary(props);}const batch=pending;pending=[];for(const fn of batch)fn();await Promise.resolve();}}
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(' '):n&&typeof n==='object'?text(n.props?.children):'';
const report=(days,leads=96)=>({days,timezone:'America/Chicago',startAt:'2026-11-01T06:00:00Z',endAt:'2026-11-03T18:00:00Z',leads,calls:59,texts:60,contracts:0});
const counts=()=>nodes(tree).filter(n=>n.type==='dd').map(text);
const refresh=()=>document.dispatchEvent(new Event('visibilitychange'));
try{
 await flush();assert.deepEqual(counts(),['—','—','—','—']);
 assert.match(requests[0].url,/days=1/);assert.match(requests[0].url,/timezone=America%2FChicago/);
 requests[0].resolve(report(1));await flush();assert.deepEqual(counts(),['96','59','60','0']);
 refresh();await flush();requests.at(-1).reject(Error('Failed read'));await flush();assert.deepEqual(counts(),['96','59','60','0'],'Failed same-period refresh retains confirmed counts');
 refresh();await flush();const previousRequest=requests.at(-1);
 nodes(tree).find(n=>n.type==='button'&&text(n)==='7 days').props.onClick();await flush();assert.equal(props.days,7);assert.deepEqual(counts(),['—','—','—','—']);assert.equal(previousRequest.options.signal.aborted,true);
 previousRequest.resolve(report(1,1000));await flush();assert.deepEqual(counts(),['—','—','—','—'],'Late previous-period counts cannot appear');
 requests.at(-1).resolve(report(7,101));await flush();assert.deepEqual(counts(),['101','59','60','0']);
 refresh();await flush();requests.at(-1).resolve({...report(7),timezone:'UTC'});await flush();assert.equal(counts()[0],'101','Wrong timezone is rejected');
 refresh();await flush();requests.at(-1).resolve({...report(7),leads:null});await flush();assert.equal(counts()[0],'101','Missing count never becomes zero');
 props={...props,apiBase:'/api/admin/accounts/view/second'};dirty=true;await flush();assert.deepEqual(counts(),['—','—','—','—'],'Different account clears prior data before effect completion');
 requests.at(-1).reject(Error('No access'));await flush();assert.deepEqual(counts(),['—','—','—','—']);
 const progress={days:7,timezone:'America/Chicago',startAt:'2026-11-01T06:00:00Z',endAt:'2026-11-03T18:00:00Z',queued:0,screened:96,eligible:42,contacted:59,responded:0,status:'ready'};
 assert(validOpportunityProgress(progress,7,'America/Chicago'));
 for(const value of [null,{}, {...progress,days:1},{...progress,contacted:1.5},{...progress,screened:Infinity},{...progress,endAt:'2025-01-01T00:00:00Z'},{...progress,status:'unverified'}])assert(!validOpportunityProgress(value,7,'America/Chicago'));
 console.log('PASS shared reporting period UI: controlled selection, exact timezone, preserved same-scope reads, late-response rejection, account isolation and validated progress. No provider work.');
}finally{cells.forEach(cell=>cell?.cleanup?.());Object.assign(globalThis,saved);}
