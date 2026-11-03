import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {validOpportunityProgress} from '../lib/opportunity-progress.ts';
const load=(path,deps)=>{const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const m={exports:{}};new Function('require','module','exports',code)(name=>{assert(name in deps,'Missing '+name);return deps[name];},m,m.exports);return m.exports;};
let signedIn=true,fail=null,malformed=false,missing=null,budget={budgetId:1,startedAt:'2026-11-03T16:12:00Z',status:'ready',queued:0,screened:0,eligible:0,contacted:0,responded:0},calls=[];
const db=async(path,method,body,signal)=>{
 calls.push({path,method,body,signal});assert.equal(method,'POST');assert.equal(body.p_account,'bound-account');
 if(fail===path)throw Error('private database failure');
 if(path==='rpc/icash_prospecting_progress')return budget;
 assert.equal(path,'rpc/icash_opportunity_progress_report','Progress GET uses read-only RPCs only');
 const report={days:body.p_days,timezone:body.p_timezone,startAt:'2026-10-28T00:00:00Z',endAt:'2026-11-03T19:00:00Z',queued:2,screened:96,eligible:60,contacted:30,responded:malformed?-1:7};if(missing)delete report[missing];return report;
};
const reader=load('lib/opportunity-progress-read.ts',{'@/lib/stripe-test':{db},'./opportunity-progress':{validOpportunityProgress}});
const route=load('app/api/work/progress/route.ts',{'next/server':{NextResponse:{json:Response.json}},'@/lib/work-account':{workAccount:async({signal})=>{if(!signedIn)throw Error('SIGN_IN_REQUIRED');assert(signal instanceof AbortSignal);return {accountId:'bound-account'};}},'@/lib/opportunity-progress-read':reader});
const request=query=>new Request('https://fixture.invalid/api/work/progress'+query);
const check=async(query='?days=7&timezone=America%2FChicago')=>route.GET(request(query));
let response=await check(),data=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(data.progress.screened,96);assert.equal(data.progress.contacted,30);assert.equal(data.progress.responded,7);assert.equal(data.progress.budgetId,1);
for(const b of [{...budget,budgetId:2,startedAt:'2026-11-03T18:00:00Z'},null]){budget=b;response=await check();data=await response.json();assert.equal(data.progress.screened,96,'Funding and absent budget never erase real activity');assert.equal(data.progress.responded,7);}
for(const query of ['?days=0','?days=8','?days=7&days=30','?timezone=Invalid','?accountId=other','?timezone=UTC&timezone=UTC']){calls=[];assert.equal((await check(query)).status,400);assert.equal(calls.length,0);}
for(const path of ['rpc/icash_opportunity_progress_report','rpc/icash_prospecting_progress']){fail=path;response=await check();assert.equal(response.status,503);assert(!JSON.stringify(await response.json()).includes('private database'));}fail=null;
malformed=true;assert.equal((await check()).status,503,'Malformed evidence is unavailable, never zero');malformed=false;
for(const key of ['screened','eligible','contacted','responded','queued','days','timezone','startAt','endAt']){missing=key;budget={status:'ready',screened:0,eligible:0,contacted:0,responded:0,queued:0};assert.equal((await check()).status,503,'Missing '+key+' must not inherit a funding-scoped zero');}missing=null;
for(const days of [1,7,30]){calls=[];assert.equal((await check('?days='+days+'&timezone=America%2FLos_Angeles')).status,200);assert.deepEqual(calls[1].body,{p_account:'bound-account',p_days:days,p_timezone:'America/Los_Angeles'});assert(calls.every(c=>c.signal instanceof AbortSignal));}
signedIn=false;calls=[];assert.equal((await check()).status,503);assert.equal(calls.length,0,'Authentication failure never reads account metrics');
console.log('PASS opportunity progress API: same period, funding-independent counts, no-budget history, scoped read-only RPCs, input/response validation, private errors and deadlines.');
