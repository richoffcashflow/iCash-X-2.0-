import ts from 'typescript';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {receptionTarget,boundedBody} from '../lib/general-reception.ts';
let who='owner',reads=0,writes=0;
const route=await loadService('app/api/owner-reception/forwarding/route.ts',{NextResponse:{json:Response.json},receptionTarget,boundedBody,process:{env:{}},workAccount:async()=>{if(who==='out')throw Error('SIGN_IN_REQUIRED');return {accountId:who==='account'?'other':receptionTarget.accountId,userId:who==='user'?'other':receptionTarget.ownerUserId};},db:async()=>assert.fail('mocked helpers must not access DB'),reviewReceptionForwarding:async()=>{reads++;return {status:'review'};},applyReceptionForwarding:async(_,__,token)=>{writes++;assert.equal(token,'review');return {status:'pending'};}});
const url='https://app.test/api/owner-reception/forwarding';
const request=(method='GET',change={})=>new Request(change.url??url,{method,headers:{host:'app.test',...(method==='POST'?{origin:'https://app.test','content-type':'application/json'}:{}),...change.headers},...(method==='POST'?{body:change.body??JSON.stringify({confirm:true,reviewToken:'review'})}:{})});
for(const role of ['out','account','user']){who=role;for(const method of ['GET','POST'])assert.equal((await route[method](request(method))).status,role==='out'?401:403);}who='owner';
for(const method of ['GET','POST'])for(const change of [{url:url+'?to=foreign'},{headers:{host:'foreign'}},{headers:{origin:'https://foreign.test'}},{headers:{'sec-fetch-site':'cross-site'}}])assert((await route[method](request(method,change))).status>=400);
for(const body of ['{}','null','[]','bad','x'.repeat(5000),JSON.stringify({confirm:false,reviewToken:'review'}),JSON.stringify({confirm:true,reviewToken:'review',to:'+19995550199'})])assert.equal((await route.POST(request('POST',{body}))).status,400);
assert.equal((await route.POST(request('POST',{headers:{origin:''}}))).status,403);assert.equal((await route.POST(request('POST',{headers:{'content-type':'text/plain'}}))).status,415);assert.equal(reads,0);assert.equal(writes,0);
const read=await route.GET(request());assert.equal(read.status,200);assert.match(read.headers.get('cache-control'),/private, no-store/);assert.equal(reads,1);assert.equal((await route.POST(request('POST'))).status,200);assert.equal(writes,1);assert.equal(route.DELETE,undefined);
const ui=readFileSync('app/owner-reception/reception-forwarding.tsx','utf8');assert(ui.includes('if(running.current'));assert(ui.includes('Confirm fixed forwarding'));assert(ui.includes('Cancel'));assert(ui.includes('do not repeat'));assert(!ui.includes('localStorage'));assert(!ui.includes('process.env'));assert(!ui.includes('JSON.stringify(review)'));
console.log('Forwarding route: exact owner, same-origin, bounded fixed-target confirmation and no generic provider proxy');

const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(ui,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:'forwarding.tsx'}).outputText)(createRequire(import.meta.url),mod,mod.exports);const uiModule=mod.exports;assert.equal(uiModule.forwardingEta(null),'');assert.equal(uiModule.forwardingEta(9007199254740991),'Estimated completion unavailable.');assert.equal(uiModule.forwardingEta(NaN),'Estimated completion unavailable.');assert.match(uiModule.forwardingEta(0),/1970-01-01/);
