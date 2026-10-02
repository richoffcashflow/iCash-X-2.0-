import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {receptionTarget} from '../lib/general-reception.ts';
let who='owner',reads=0;
const route=await loadService('app/api/owner-reception/carrier/route.ts',{
 NextResponse:{json:Response.json},receptionTarget,process:{env:{}},
 workAccount:async()=>{if(who==='out')throw Error('SIGN_IN_REQUIRED');return {accountId:who==='account'?'other':receptionTarget.accountId,userId:who==='user'?'other':receptionTarget.ownerUserId};},
 db:async()=>assert.fail('mocked diagnostic must not mutate database'),
 readReceptionCarrierDiagnostic:async()=>{reads++;return {status:'no_calls',complete:true,calls:[]};},
});
const url='https://app.test/api/owner-reception/carrier';
const request=(change={})=>new Request(change.url??url,{headers:{host:'app.test',...change.headers}});
for(const role of ['out','account','user']){who=role;assert.equal((await route.GET(request())).status,role==='out'?401:403);}who='owner';assert.equal(reads,0);
for(const change of [{url:url+'?path=foreign'},{headers:{host:'foreign'}},{headers:{origin:'https://foreign.test'}},{headers:{'sec-fetch-site':'cross-site'}}])assert((await route.GET(request(change))).status>=400);assert.equal(reads,0);
const r=await route.GET(request());assert.equal(r.status,200);assert.equal((await r.json()).status,'no_calls');assert.equal(reads,1);assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(route.POST,undefined);
const ui=readFileSync('app/owner-reception/reception-setup.tsx','utf8');assert(ui.includes('Check recent carrier calls'));assert(ui.includes('No call or retry was placed'));assert(!ui.includes('data.from'));assert(!ui.includes('data.to'));console.log('Carrier diagnostic exact-owner GET guard, no-store and read-only UI passed');
