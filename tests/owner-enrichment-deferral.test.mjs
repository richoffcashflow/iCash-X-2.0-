import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {OwnerPreviewRateLimitError,OwnerExportCapacityBusyError} from '../lib/owner-enrichment-deferral.ts';
import {enrichActiveOwners} from '../lib/owner-active-export.ts';
import {OwnerExportPreflightPendingError} from '../lib/owner-export-preflight.ts';
import {ProspectingBudgetError} from '../lib/voice-budget-failure.ts';
import * as admission from '../lib/live-work-admission.ts';

// Actual automation route, isolated local DB/service doubles. No transport.
process.env.ICASH_LIVE_WORK_READY='true';
const token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.repeat(2);
const account='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const screening='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const base={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',accountId:account,screeningId:screening,kind:'contacts'};
let failure,ticket,consumed,deferralResult,deferralThrows,calls,durable,afterDeferral,logs;
function reset(){failure=new OwnerPreviewRateLimitError(account,screening);ticket={...base};consumed=false;deferralResult=true;deferralThrows=false;calls=[];durable={token,state:'consumed',outcome:null};afterDeferral=null;logs=[];}
const mocks={...admission,OwnerPreviewRateLimitError,OwnerExportCapacityBusyError,OwnerExportPreflightPendingError,ProspectingBudgetError,
 console:{info:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},
 NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},
 enrichForAccount:async()=>{throw failure;},discoverForAccount:async()=>{throw failure;},
 db:async(path,method,body)=>{
  calls.push({path,method,body});
  if(path==='rpc/icash_consume_automation'){if(consumed)return null;consumed=true;return ticket;}
  if(['rpc/icash_defer_owner_enrichment','rpc/icash_defer_owner_preflight'].includes(path)){afterDeferral?.();if(deferralThrows)throw Error('Unknown database outcome');return deferralResult;}
  if(path==='rpc/icash_finish_owner_enrichment'){
   assert.equal(method,'POST');assert.equal(body.p_id,base.id);assert.equal(body.p_account,account);assert.equal(body.p_screening,ticket.screeningId);
   if(body.p_token===durable.token&&durable.state==='consumed'){durable={...durable,state:body.p_success?'complete':'held',outcome:body.p_outcome};return true;}return false;
  }
  if(path==='rpc/icash_hold_prospecting_ticket')return false;
  if(path==='rpc/icash_finish_automation')return null;
  throw Error('Unexpected database action '+path);
 },
};
globalThis.__ownerDeferral=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/internal/automation/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__ownerDeferral;\n'+source;
const {POST}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const request=(value=token)=>new Request('https://example.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+value}});
reset();let response=await POST(request());assert.equal(response.status,200);assert.equal(response.body.status,'owner_preview_rate_limited');assert.equal(response.headers['Cache-Control'],'private, no-store');
assert.deepEqual(calls.find(c=>c.path==='rpc/icash_defer_owner_enrichment').body,{p_id:base.id,p_account:account,p_screening:screening,p_token:token,p_operation:`owners:${account}:${screening}`});
assert(!calls.some(c=>c.path==='rpc/icash_finish_automation'),'The durable deferral owns the state transition');
assert.equal(calls.length,2,'No settlement, provider or alert calls are part of a limiter deferral');
reset();failure=new OwnerExportPreflightPendingError(account,screening);response=await POST(request());assert.equal(response.status,200);assert.equal(response.body.status,'owner_export_preflight_pending');assert.equal(calls[1].path,'rpc/icash_defer_owner_preflight','Free list indexing waits require independent durable proof');

// The actual export service proves the local slot rejection before any provider
// transport; the actual route retains the original scoped deferral and outcome.
reset();let providerCalls=0,serviceReads=[];
await assert.rejects(enrichActiveOwners(async(path)=>{serviceReads.push(path);assert.equal(path,'rpc/icash_owner_active_export_capacity');return 'export_busy';},account,{screeningId:screening,snapshot:{}},
 {contact_rate_id:'fixture',contact_credit_cap:25,property_credit_micros:10000,data_rights_until:'2099-01-01',research_version:2},250000,async()=>{providerCalls++;throw Error('No provider transport allowed');}),error=>{failure=error;return error instanceof OwnerExportCapacityBusyError;});
Object.assign(failure,{privateEmail:'private@example.invalid',providerBody:{credential:'never-log'}});
response=await POST(request());assert.equal(response.status,200);assert.deepEqual(response.body,{status:'owner_preview_rate_limited'});
assert.deepEqual(serviceReads,['rpc/icash_owner_active_export_capacity']);assert.equal(providerCalls,0);
assert.equal(calls.length,2);assert.equal(calls[1].path,'rpc/icash_defer_owner_enrichment');
assert.deepEqual(logs,[['automation_waiting',{kind:'contacts',reason:'OWNER_EXPORT_CAPACITY_BUSY'}]],'Only the fixed operator reason is exposed');
assert.equal((await POST(request())).status,401,'No repeated capability or provider attempt');

for(const ErrorType of [OwnerPreviewRateLimitError,OwnerExportCapacityBusyError])for(const value of [false,null,undefined,'true',{},[]]){
 reset();failure=new ErrorType(account,screening);deferralResult=value;response=await POST(request());assert.equal(response.status,503);assert.equal(response.body.status,'held_for_reconciliation');assert.equal(durable.outcome,'held_for_reconciliation');assert(!calls.some(c=>c.path==='rpc/icash_finish_automation'),'Deferral fallback never finishes by ticket ID alone');
}
reset();deferralThrows=true;response=await POST(request());assert.equal(response.status,503);assert.equal(calls.filter(c=>c.path==='rpc/icash_defer_owner_enrichment').length,1,'Never retry an uncertain atomic deferral');
for(const result of [false,undefined,'unknown']){
 reset();failure=new OwnerExportCapacityBusyError(account,screening);deferralResult=result;deferralThrows=result==='unknown';
 // The first transaction committed but its response was lost. The scheduler
 // already reissued and another worker consumed a new token on the same row.
 const freshToken='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'.repeat(2);
 afterDeferral=()=>{durable={token:freshToken,state:'consumed',outcome:null};};
 response=await POST(request());assert.equal(response.status,503);
 assert.deepEqual(durable,{token:freshToken,state:'consumed',outcome:null},'Stale failure cannot finish a newer consumed capability');
 assert(!calls.some(c=>c.path==='rpc/icash_finish_automation'));
}

for(const error of [Error('OWNER_PREVIEW_RATE_LIMITED'),Error('OWNER_EXPORT_CAPACITY_BUSY'),Error('PROVIDER_RATE_LIMIT'),Error('OWNER_LOOKUP_FAILED_NO_RETRY'),Error('OWNER_PREVIEW_FAILED_NO_RETRY'),Error('CONTACT_RECEIPT_REQUIRES_RECONCILIATION'),{name:'OwnerPreviewRateLimitError',accountId:account,screeningId:screening,operationKey:`owners:${account}:${screening}`},{name:'OwnerExportCapacityBusyError',message:'OWNER_EXPORT_CAPACITY_BUSY',accountId:account,screeningId:screening,operationKey:`owners:${account}:${screening}`}]){
 reset();failure=error;response=await POST(request());assert.equal(response.status,503);assert(!calls.some(c=>c.path==='rpc/icash_defer_owner_enrichment'),'Text or lookalike objects never grant a retry');
}
for(const mutate of [()=>{failure=new OwnerPreviewRateLimitError('other-account',screening);},()=>{failure=new OwnerPreviewRateLimitError(account,'other-screening');},()=>{failure=new OwnerExportCapacityBusyError('other-account',screening);},()=>{failure=new OwnerExportCapacityBusyError(account,'other-screening');},()=>{failure.operationKey='owners:other';},()=>{ticket.kind='discovery';},()=>{ticket.screeningId=null;}]){
 reset();mutate();response=await POST(request());assert(!calls.some(c=>c.path==='rpc/icash_defer_owner_enrichment'),'Only the exact consumed contact scope can be deferred');
}
reset();const results=await Promise.all([POST(request()),POST(request()),POST(request())]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401,401]);assert.equal(calls.filter(c=>c.path==='rpc/icash_defer_owner_enrichment').length,1,'Only one worker consumes the one-use capability');
reset();response=await POST(request('invalid'));assert.equal(response.status,401);assert.equal(calls.length,0);
delete globalThis.__ownerDeferral;
console.log('Owner preview deferral: exact typed scope, one-use capability, definite atomic result, ambiguous/paid/receipt failures held; no provider calls.');
