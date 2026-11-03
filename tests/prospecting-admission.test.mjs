import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ProspectingBudgetError,voiceReservationFailure} from '../lib/voice-budget-failure.ts';
import {validOpportunityProgress} from '../lib/opportunity-progress.ts';
import {automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation} from '../lib/live-work-admission.ts';
process.env.ICASH_LIVE_WORK_READY='true';
const rejection={code:'P0001',message:'Prospecting budget reached',details:JSON.stringify({quoteCents:977})};
for(const path of ['rpc/icash_reserve_operation','rpc/icash_reserve_and_claim_property_discovery','rpc/icash_reserve_and_claim_filtered_discovery','rpc/icash_reserve_paced_voice','rpc/icash_reserve_flexible_voice','rpc/icash_claim_text','rpc/icash_claim_customer_text']){
 const result=await voiceReservationFailure(path,400,Response.json(rejection));assert(result instanceof ProspectingBudgetError);assert.equal(result.quoteCents,977);
}
for(const [status,body] of [[503,rejection],[400,{...rejection,code:'XX000'}],[400,{...rejection,message:'Provider outcome unknown'}],[400,{...rejection,details:'bad'}],[400,{...rejection,details:'{"quoteCents":0}'}]])assert(!(await voiceReservationFailure('rpc/icash_reserve_and_claim_filtered_discovery',status,Response.json(body)) instanceof ProspectingBudgetError));
for(const [path,status,body] of [['rpc/other',400,rejection],['rpc/icash_reserve_operation',503,rejection],['rpc/icash_reserve_operation',400,{...rejection,code:'XX000'}],['rpc/icash_reserve_operation',400,{...rejection,details:'bad'}],['rpc/icash_reserve_operation',400,{...rejection,details:'{"quoteCents":0}'}]])assert(!(await voiceReservationFailure(path,status,Response.json(body)) instanceof ProspectingBudgetError));
let failure=new ProspectingBudgetError(977),safe=true,authorized=true;const calls=[];
const mocks={ProspectingBudgetError,automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation,
 NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},
 workAccount:async()=>{if(!authorized)throw Error('Sign in');return {accountId:'trusted-account'};},
 discoverForAccount:async()=>{throw failure;},
 db:async(path,method,body)=>{calls.push({path,method,body});
  if(path==='rpc/icash_consume_automation')return {id:'ticket',accountId:'trusted-account',kind:'discovery'};
  if(path==='rpc/icash_hold_prospecting_ticket')return safe;
  if(path==='rpc/icash_prospecting_progress')return {status:'ready',screened:0,eligible:0,contacted:0,responded:0};
  if(path==='rpc/icash_opportunity_progress_report')return {days:body.p_days,timezone:body.p_timezone,startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-01T12:00:00Z',queued:0,screened:12,eligible:3,contacted:2,responded:1};
  return null;
 }
};
async function route(file){
 let source=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 globalThis.__prospecting=mocks;source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__prospecting;\n'+source;
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {POST}=await route('app/api/internal/automation/route.ts');
const request=()=>new Request('https://example.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+('00000000-0000-0000-0000-000000000000').repeat(2)}});
let result=await POST(request());assert.equal(result.status,200);assert.equal(result.body.status,'prospecting_budget_held');
assert.deepEqual(calls.find(c=>c.path==='rpc/icash_hold_prospecting_ticket').body,{p_id:'ticket',p_account:'trusted-account',p_quote:977});
assert(!calls.some(c=>c.path==='rpc/icash_finish_automation'),'Safe budget hold has its own atomic state change');
safe=false;calls.length=0;result=await POST(request());assert.equal(result.status,503);assert.equal(calls.at(-1).body.p_outcome,'held_for_reconciliation');
failure=Error('Unknown provider outcome');safe=true;calls.length=0;result=await POST(request());assert.equal(result.status,503);assert(!calls.some(c=>c.path==='rpc/icash_hold_prospecting_ticket'));
const readerCode=ts.transpileModule(readFileSync(new URL('../lib/opportunity-progress-read.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const reader={exports:{}};new Function('require','module','exports',readerCode)(name=>name==='@/lib/stripe-test'?{db:mocks.db}:{validOpportunityProgress},reader,reader.exports);Object.assign(mocks,reader.exports);
const {GET}=await route('app/api/work/progress/route.ts');
calls.length=0;result=await GET(new Request('https://example.invalid/api/work/progress?accountId=another-account'));assert.equal(result.status,400);assert.equal(calls.length,0,'An account override is rejected before reading metrics');
result=await GET(new Request('https://example.invalid/api/work/progress?days=7&timezone=UTC'));assert.equal(result.status,200);assert.equal(result.headers['Cache-Control'],'private, no-store');assert.equal(result.body.progress.screened,12);assert.equal(result.body.progress.responded,1);assert(calls.every(c=>c.body.p_account==='trusted-account'));assert(!calls.some(c=>c.path==='rpc/icash_refresh_opportunity_outcomes'),'Reporting never mutates the outcome cache');
authorized=false;calls.length=0;result=await GET();assert.equal(result.status,503);assert.equal(calls.length,0,'No progress or wallet metadata without authenticated account');
delete globalThis.__prospecting;
console.log('Prospecting admission: only exact atomic rejections are retryable; ambiguous provider outcomes stay held; progress is authenticated, tenant-bound and private. No providers.');
