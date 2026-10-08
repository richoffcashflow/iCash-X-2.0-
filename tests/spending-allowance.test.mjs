import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {z} from 'zod';
import * as allowance from '../lib/spending-allowance.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

const before={day:'2026-10-08',limitCents:200,spentCents:99,reservedCents:0,remainingCents:101,availableCents:301,extraCents:0,resetsAt:'2026-10-09T05:00:00Z'};
const after={...before,limitCents:400,remainingCents:301,extraCents:200};
const request={day:before.day,extraTotalCents:200};
const originalFetch=globalThis.fetch;
// A lost POST response must be reconciled without submitting the increase twice.
let requests=[];
globalThis.fetch=async(url,options)=>{requests.push(options.method);if(options.method==='POST')throw Error('synthetic timeout');return Response.json(after);};
assert.deepEqual(await allowance.saveSpendingAllowance(request),after);
assert.deepEqual(requests,['POST','GET']);
for(const response of [before,null,{...after,day:'2026-10-09'},{...after,remainingCents:'301'}]){
 globalThis.fetch=async()=>Response.json(response);
 await assert.rejects(allowance.saveSpendingAllowance(request),/not confirmed/);
}
globalThis.fetch=async(url,options)=>options.method==='POST'?Response.json({error:'Your session expired. Sign in again.'},{status:401}):Response.json(before);
await assert.rejects(allowance.saveSpendingAllowance(request),/session expired/);
globalThis.fetch=originalFetch;

// Route failures preserve authentication/validation semantics and tenant scope.
let accountError='',database=after,writes=[];
const route=await loadService('app/api/work/allowance/route.ts',{
 NextResponse:{json:(body,init)=>Response.json(body,init)},z,
 validSpendingAllowance:allowance.validSpendingAllowance,allowanceIncreaseConfirmed:allowance.allowanceIncreaseConfirmed,
 workAccount:async()=>{if(accountError)throw Error(accountError);return {accountId:'account-fixture',userId:'owner-fixture'};},
 allowedOrigin:req=>req.headers.get('origin')==='https://www.geticashx.com',limitRequest:async()=>{},
 db:async(path,method,body)=>{writes.push({path,method,body});return database;},console:{warn(){}},
});
const post=(body=request,origin='https://www.geticashx.com')=>new Request('https://www.geticashx.com/api/work/allowance',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
let response=await route.POST(post());assert.equal(response.status,200);assert.deepEqual(await response.json(),after);
assert.deepEqual(writes[0].body,{p_user:'owner-fixture',p_account:'account-fixture',p_day:before.day,p_extra_total:200});
assert.equal((await route.POST(post(request,'https://foreign.invalid'))).status,403);
assert.equal((await route.POST(post({...request,accountId:'foreign-account'}))).status,400);
for(const [error,status] of [['SIGN_IN_REQUIRED',401],['SUBSCRIPTION_REQUIRED',403],['ACCOUNT_REQUIRED',409]]){
 accountError=error;const count=writes.length;assert.equal((await route.POST(post())).status,status);assert.equal(writes.length,count);
}
accountError='';database=before;assert.equal((await route.POST(post())).status,503);

// Render with the existing lightweight hook harness: errors survive polling,
// old GETs cannot replace a successful save, and rapid submits issue one POST.
const require=createRequire(import.meta.url),code=ts.transpileModule(readFileSync('components/spending-allowance.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const all=root=>!root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(all):[root,...all(root.props?.children)];
const text=root=>typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';
let slots=[],cursor=0,dirty=true,pending=[],tree,tick,read=async()=>before,saveFails=true,saves=0;
const hooks={
 useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
 useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
 useCallback(fn,deps){const i=cursor++;if(!(i in slots))slots[i]={fn,deps};return slots[i].fn;},
 useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((v,n)=>!Object.is(v,previous.deps[n]))){slots[i]={deps};pending.push(fn);}},
};
const mod={exports:{}};
new Function('require','module','exports','setInterval','clearInterval','document',code)(name=>{
 if(name==='react')return hooks;
 if(name==='./spending-allowance.module.css')return {default:new Proxy({},{get:(_,key)=>String(key)})};
 if(name==='@/components/funding-dialog')return {FundingDialog:'FundingDialog'};
 if(name==='@/lib/membership-policy')return {priceLabel:cents=>'$'+(cents/100).toFixed(2)};
 if(name==='@/lib/spending-allowance')return {fetchSpendingAllowance:()=>read(),saveSpendingAllowance:async body=>{saves++;assert.deepEqual(body,request);if(saveFails)throw Error('Your session expired. Sign in again.');return after;}};
 return require(name);
},mod,mod.exports,fn=>{tick=fn;return 1;},()=>{},{hidden:false});
async function flush(){for(let i=0;i<15;i++){if(dirty){cursor=0;dirty=false;tree=mod.exports.SpendingAllowance();}const effects=pending;pending=[];effects.forEach(fn=>fn());await new Promise(resolve=>setTimeout(resolve,1));if(!dirty&&!pending.length)return;}throw Error('Render did not settle');}
const button=label=>{const found=all(tree).find(n=>n.type==='button'&&text(n).trim()===label);assert(found,'Missing '+label);return found;};
const submit=()=>all(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
await flush();assert.match(text(tree),/\$1\.01 remaining/);
button('Allow more spending today').props.onClick();await flush();
submit();submit();await flush();assert.equal(saves,1);assert.match(text(tree),/session expired/);
tick();await flush();assert.match(text(tree),/session expired/,'A successful poll must not erase a failed save');
assert(all(tree).some(n=>n.type==='FundingDialog'),'Failure leaves confirmation dialog open');
let resolveOld;read=()=>new Promise(resolve=>{resolveOld=resolve;});tick();
saveFails=false;submit();await flush();assert.match(text(tree),/Allowance saved/);assert.match(text(tree),/\$3\.01/);
resolveOld(before);await flush();assert.match(text(tree),/\$3\.01 remaining/,'Older GET must not replace confirmed increase');
assert(!all(tree).some(n=>n.type==='FundingDialog'));assert.equal(saves,2);
console.log('PASS allowance: persistent failure message, exact saved response, lost-response recovery, stale refresh race, duplicate submit, authenticated account scope.');
