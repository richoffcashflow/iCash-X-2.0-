import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../app/owner-reception/outbound-readiness.tsx',import.meta.url),'utf8');
let code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText;code=code.replace(/^import .* from .*;$/gm,'');
const {formatOutboundAudit,loadOutboundAudit}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const sentinel='PRIVATE_DATA_MUST_NOT_RENDER';
const data={status:'checked',runtimeConfigChecksPass:false,toolDefinitionsVerified:false,templateEnabled:false,checks:{agentIdentityMatches:true,configHashMatches:false,private:sentinel},tools:[{role:'callback',checks:{scopedCallAuthorization:false},private:sentinel},{role:sentinel,checks:{}}],maxDurationSeconds:600,maxOutputTokens:-1,observedConfigHash:'a'.repeat(64),checkedAt:'2026-10-02T22:30:00.000Z',private:sentinel};
const lines=formatOutboundAudit(data);assert(lines.some(x=>x==='Production template: Disabled'));assert(lines.some(x=>x.includes('tokens: unlimited')));assert(lines.some(x=>x.includes('Needs review')));assert(lines.some(x=>x.includes('Not verified')));assert(!lines.join('').includes(sentinel));assert.deepEqual(formatOutboundAudit({status:'failed',error:sentinel}),[]);
assert(!formatOutboundAudit({...data,observedConfigHash:sentinel,checkedAt:sentinel}).join('').includes(sentinel));
const calls=[];const out=await loadOutboundAudit(async(url,options)=>{calls.push({url,options});return Response.json(data);});assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/owner-outbound-readiness');assert.deepEqual(calls[0].options,{method:'GET',cache:'no-store',credentials:'same-origin'});assert.deepEqual(out.lines,lines);
for(const status of [401,403,409,503]){const result=await loadOutboundAudit(async()=>new Response(sentinel,{status}));assert.equal(result.lines.length,0);assert(!JSON.stringify(result).includes(sentinel));}
await assert.rejects(loadOutboundAudit(async()=>{throw Error(sentinel);}));
assert(source.includes('if(running.current)return'));assert(source.includes('setLines([])'));assert(source.includes('finally{running.current=false;setBusy(false);}'));assert(source.includes('disabled={busy}'));assert(!source.includes('useEffect'));assert(!source.includes('dangerouslySetInnerHTML'));assert(!source.includes("method:'POST'"));
const page=readFileSync(new URL('../app/owner-reception/page.tsx',import.meta.url),'utf8');assert(page.includes('<ReceptionSetup/><ReceptionForwarding/><OutboundReadiness/>'));
const backend=readFileSync(new URL('../app/api/owner-outbound-readiness/route.ts',import.meta.url),'utf8');assert(backend.includes('currentUser(false)'));assert(backend.includes('user.id!==ownerInboundTarget.ownerUserId'));
console.log('Outbound diagnostic UI: fixed authenticated GET only, owner auth preserved, safe allowlist, unknowns/failures, no auto request, repeat-click guard and existing controls retained');

const handler=source.slice(source.indexOf(' async function check()'),source.indexOf(' return <section'));
let complete;const pending=new Promise(resolve=>{complete=resolve});let executions=0;const messages=[],states=[],outputs=[],running={current:false};
const action=new Function('loadOutboundAudit','running','setBusy','setLines','setMessage','return '+handler.trim())(async()=>{executions++;await pending;return {lines:['verified'],message:'done'};},running,v=>states.push(v),v=>outputs.push(v),v=>messages.push(v));
const first=action();await action();assert.equal(executions,1);assert.equal(running.current,true);complete();await first;assert.equal(running.current,false);assert.deepEqual(states,[true,false]);assert.deepEqual(outputs,[[],['verified']]);
const failed=new Function('loadOutboundAudit','running','setBusy','setLines','setMessage','return '+handler.trim())(async()=>{throw Error(sentinel);},running,v=>states.push(v),v=>outputs.push(v),v=>messages.push(v));await failed();assert.deepEqual(outputs.at(-1),[]);assert(!messages.at(-1).includes(sentinel));assert.equal(running.current,false);
console.log('Outbound UI actual handler: concurrent click suppressed, stale results cleared, errors sanitized, button state restored');
