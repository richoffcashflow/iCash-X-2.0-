// Offline scenarios only: no telephony, discovery or paid provider requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {workspaceLeadPresence} from '../lib/workspace-lead-presence.ts';
const empty={loaded:true,loading:false,error:false,count:0,hasMore:false,page:0,query:'',focusedId:''};
assert.equal(workspaceLeadPresence(empty),false);
for(const change of [{query:'no match'},{page:2},{focusedId:'one-property'},{loaded:false},{loading:true},{error:true}])assert.equal(workspaceLeadPresence({...empty,...change}),undefined,'Partial or stale views must not report an empty account');
assert.equal(workspaceLeadPresence({...empty,hasMore:true}),true);
assert.equal(workspaceLeadPresence({...empty,count:1,query:'address'}),true);
const require=createRequire(import.meta.url),mod={exports:{}};
let activity=null,effects=[];
const code=ts.transpileModule(readFileSync(new URL('../components/bot-run-bar.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',code)(name=>name==='react'?{useState:()=>[activity,value=>{activity=typeof value==='function'?value(activity):value;}],useEffect(fn){effects.push(fn);}}:name==='@/lib/workspace-progress'?{creditAmount:()=>'$10'}:name==='@/components/icash-mark'?{IcashMark:()=>null}:require(name),mod,mod.exports);
const all=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(all):[root,...all(root.props?.children)];
const text=root=>typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';
const props={readOnly:true,running:true,stopped:false,paymentRequired:false,busy:false,stale:false,balanceCents:1000,principalKey:'fixture',hasLeads:false,onBudget(){},onResume(){},onPause(){}};
const render=(patch={})=>{const branch=mod.exports.BotRunBar({...props,...patch});return typeof branch.type==='function'?branch.type(branch.props):branch;};
const live=tree=>all(tree).find(n=>n.props?.className==='bot-live-status').props['data-live'];
assert.equal(live(render()),false,'No green status before confirmation');
activity={principalKey:'fixture',active:false,label:'Waiting for the next task',checkedAt:new Date().toISOString()};
assert.equal(live(render()),true,'Confirmed running bot remains live between tasks');
assert.match(text(render()),/Looking for a deal/);
assert.doesNotMatch(text(render({hasLeads:undefined})),/Looking for a deal/,'Unknown lead inventory does not claim empty');
assert.doesNotMatch(text(render({hasLeads:true})),/Looking for a deal/);
activity={...activity,active:true,label:'Contacting an owner'};
assert.match(text(render()),/Contacting an owner/,'Actual work takes precedence over empty-state text');
for(const change of [{stale:true},{busy:true},{stopped:true},{running:false},{paymentRequired:true},{balanceCents:0},{principalKey:'another-account'}])assert.equal(live(render(change)),false,'Unavailable or another account must not show green');
activity={...activity,checkedAt:new Date(Date.now()-60000).toISOString()};
assert.equal(live(render()),false,'Expired activity is not live');
activity={...activity,checkedAt:new Date().toISOString(),active:false,label:'Paused'};
assert.equal(live(render()),false,'Server pause overrides cached account availability');
// Customer Run mode is independent of a temporary health/readiness failure.
activity=null;
const customer={readOnly:false,enabled:true};
assert.match(text(render(customer)),/Bot running/);
assert.match(text(render(customer)),/Run enabled/);
assert.match(text(render(customer)),/Searching for a deal/);
assert.doesNotMatch(text(render(customer)),/Checking status|Not live|Work delayed/);
for(const change of [{stale:true},{busy:true},{running:false}]){
 const tree=render({...customer,...change});
 assert.match(text(tree),/Bot running/);assert.match(text(tree),/Searching for a deal/);assert.equal(live(tree),true,'The indicator describes saved Run mode');
 assert.doesNotMatch(text(tree),/Checking status|Reconnecting|Not live|Work delayed/);
}
for(const health of [{blocked:true,label:'A service issue is blocking work on your account.'},{unavailable:true,label:'Work status is temporarily unavailable'},{label:'Confirming earlier work costs'}]){
 activity={principalKey:'fixture',active:false,checkedAt:new Date().toISOString(),...health};
 const tree=render({...customer,hasLeads:true});assert.match(text(tree),/Bot running/);assert.match(text(tree),/Searching for a deal/);
 assert.doesNotMatch(text(tree),/service issue|unavailable|Work delayed|earlier work costs/);
}
activity={principalKey:'fixture',active:false,label:'Paused',checkedAt:new Date().toISOString()};
assert.match(text(render(customer)),/Bot running/,'Saved account Run mode wins over an earlier activity read');
assert.match(text(render({...customer,enabled:false,stopped:true})),/Bot paused/);
assert.match(text(render({...customer,paymentRequired:true})),/Restore access/);
assert.match(text(render({...customer,balanceCents:0,hasCreditHistory:true})),/Out of credits/);
activity=null;assert.doesNotMatch(text(render({readOnly:false,enabled:undefined,running:false,stale:true})),/Bot running|Run enabled/,'No fabricated Run mode without a saved account setting');
for(const state of [{enabled:false,stopped:true},{paymentRequired:true},{balanceCents:0}])assert.doesNotMatch(text(render({...customer,...state})),/Searching for a deal/);
activity={principalKey:'fixture',active:true,label:'Contacting an owner',checkedAt:new Date().toISOString()};
assert.doesNotMatch(text(render(customer)),/Searching for a deal/,'Fresh work has its own label');
// Execute the polling lifecycle: a failed refresh must clear task animation,
// even when no other state update would re-evaluate the timestamp cutoff.
const originalFetch=globalThis.fetch,originalDocument=globalThis.document;
let cleanup;
try{
 globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
 globalThis.fetch=async()=>{throw Error('Synthetic refresh failure');};
 activity={principalKey:'fixture',active:true,label:'Contacting an owner',checkedAt:new Date().toISOString()};
 effects=[];assert.match(text(render(customer)),/Contacting an owner/);
 cleanup=effects.at(-1)();await new Promise(resolve=>setImmediate(resolve));
 const afterFailure=render(customer);
 assert.doesNotMatch(text(afterFailure),/Contacting an owner|Checking status|Work delayed/);
 assert(!afterFailure.props.className.includes('is-active'),'A failed poll clears the stale task animation');
 assert.match(text(afterFailure),/Searching for a deal/);assert.match(text(afterFailure),/Bot running/);assert.equal(live(afterFailure),true,'The saved Run mode remains unchanged');
 cleanup();cleanup=undefined;
 activity={principalKey:'fixture',active:true,label:'Contacting an owner',checkedAt:new Date().toISOString()};
 effects=[];render({...customer,stale:true});effects.at(-1)();assert.equal(activity,null,'A stale account read clears task evidence');
}finally{cleanup?.();globalThis.fetch=originalFetch;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
console.log('PASS status: saved customer Run/Pause independent of technical failures, no false task details, operator health visibility, account isolation and real controls.');
