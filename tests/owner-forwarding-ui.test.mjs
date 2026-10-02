import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url),slots=[],cleanups=[];let cursor=0,tree,calls=[],reply,pending;
const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(effect){const i=cursor++;if(!(i in slots)){slots[i]=true;cleanups.push(effect());}}};
const code=ts.transpileModule(readFileSync('app/owner-inbound-acceptance/forwarding-status.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};new Function('require','module','exports',code)(name=>name==='react'?hooks:require(name),module,module.exports);
function render(){cursor=0;return tree=module.exports.default();}
const elements=r=>!r||typeof r!=='object'?[]:Array.isArray(r)?r.flatMap(elements):[r,...elements(r.props?.children)];
const text=r=>typeof r==='string'?r:Array.isArray(r)?r.map(text).join(' '):r&&typeof r==='object'?text(r.props?.children):'';
const button=()=>elements(tree).find(n=>n.type==='button');
const ready={sourcePhone:'+14243948384',expectedDestination:'+17816093521',enabled:true,destination:'+17816093521',providerStatus:'active',estimatedCompletion:null,routeConfigured:true,callVerification:'not_tested',forwardingCostVerified:false,checkedAt:new Date().toISOString()};
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{calls.push({url,options});if(pending)await pending;if(reply instanceof Error)throw reply;return Response.json(reply?.body??ready,{status:reply?.status??200});};
try{
 render();assert.equal(calls.length,0,'No automatic provider read on mount');assert.match(text(tree),/has not been checked/);assert.equal(button().props.disabled,false);
 let release;pending=new Promise(resolve=>release=resolve);const oldButton=button(),first=oldButton.props.onClick();oldButton.props.onClick();render();assert.equal(calls.length,1);assert.equal(button().props.disabled,true);assert.match(text(tree),/Checking forwarding/);assert.doesNotMatch(text(tree),/Active forwarding matches/);release();await first;pending=null;render();assert.match(text(tree),/Enabled/);assert.match(text(tree),/Active on the line/);assert.match(text(tree),/matches the expected/);assert.match(text(tree),/does not verify an end-to-end call or forwarding charges/);
 for(const body of [{...ready,providerStatus:'queued',estimatedCompletion:Date.now()+60000,routeConfigured:false},{...ready,enabled:false,destination:null,routeConfigured:false}]){reply={body};await button().props.onClick();render();assert.doesNotMatch(text(tree),/Active forwarding matches/);assert.match(text(tree),body.enabled?/Queued; change is pending/:/Disabled/);}
 for(const [status,body] of [[401,{status:'sign_in_required',secret:'never render raw detail'}],[503,{status:'provider_auth_failed',secret:'never render raw detail'}],[500,{status:'never render raw detail'}],[200,{...ready,destination:'never render raw detail'}]]){reply={status,body};await button().props.onClick();render();assert.doesNotMatch(text(tree),/never render raw detail|Active forwarding matches/);assert.equal(button().props.disabled,false);}
 reply=Error('never render raw detail');await button().props.onClick();render();assert.match(text(tree),/unavailable/);assert.doesNotMatch(text(tree),/never render raw detail/);
 reply={body:ready};await button().props.onClick();render();assert.match(text(tree),/Active forwarding matches/);
 assert(calls.every(c=>c.url==='/api/owner-inbound-acceptance/forwarding'&&c.options.method==='GET'&&c.options.cache==='no-store'&&c.options.credentials==='same-origin'&&c.options.body===undefined));
 assert.equal(elements(tree).filter(n=>n.type==='button').length,1,'No enable, disable or call action');
 let finishUnmounted;pending=new Promise(resolve=>finishUnmounted=resolve);const unmounted=button().props.onClick();render();const prior=slots.slice(0,3);cleanups.forEach(cleanup=>cleanup?.());assert.equal(calls.at(-1).options.signal.aborted,true,'Unmount aborts the in-flight read');finishUnmounted();await unmounted;assert.deepEqual(slots.slice(0,3),prior,'Late response does not update unmounted state');
}finally{globalThis.fetch=original;}
console.log('Forwarding status UI: explicit GET only, duplicate/loading guard, active/queued/disabled, safe errors, stale result clearing and recovery');
