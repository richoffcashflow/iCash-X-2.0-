import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {OwnerPreviewRateLimitError,OwnerExportCapacityBusyError} from '../lib/owner-enrichment-deferral.ts';
import {OwnerExportPreflightPendingError} from '../lib/owner-export-preflight.ts';
import {ProspectingBudgetError} from '../lib/voice-budget-failure.ts';

// Execute the actual route with local services and DB only. Diagnostics must
// never expose provider bodies, capabilities or account/source identifiers.
const token='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.repeat(2);
const ticketBase={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',accountId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',screeningId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',kind:'contacts'};
const privateData={accountId:ticketBase.accountId,screeningId:ticketBase.screeningId,token,email:'private@example.invalid',raw:{phone:'+15555550123'},requestUrl:'https://provider.invalid/private?key=secret'};
let ticket,failure,consumed,calls,logs,finishThrows;
function reset(error,kind='contacts'){ticket={...ticketBase,kind};failure=error;consumed=false;calls=[];logs=[];finishThrows=false;}
const mocks={OwnerPreviewRateLimitError,OwnerExportCapacityBusyError,OwnerExportPreflightPendingError,ProspectingBudgetError,
 automationWorkReady:()=>true,newLiveWorkKinds:new Set(),
 NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},
 enrichForAccount:async()=>{throw failure;},discoverForAccount:async()=>{throw failure;},
 console:{error:(...args)=>logs.push(args)},
 db:async(path,method,body)=>{
  calls.push({path,method,body});
  if(path==='rpc/icash_consume_automation'){if(consumed)return null;consumed=true;return ticket;}
  if(['rpc/icash_finish_owner_enrichment','rpc/icash_finish_automation'].includes(path)){if(finishThrows)throw Error('Unknown database acknowledgment');return true;}
  if(path.startsWith('icash_automation_tickets?'))return [{id:ticket.id,account_id:ticket.accountId,kind:ticket.kind,token,state:'held',outcome:'held_for_reconciliation'}];
  throw Error('Unexpected action: '+path);
 },
};
globalThis.__automationHoldDiagnostics=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/internal/automation/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__automationHoldDiagnostics;\n'+source;
const {POST}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const request=()=>new Request('https://example.invalid/api/internal/automation',{method:'POST',headers:{authorization:'Bearer '+token}});
async function assertHeld(reason,kind='contacts'){
 const response=await POST(request());
 assert.equal(response.status,503);assert.deepEqual(response.body,{status:'held_for_reconciliation'});
 assert.equal(response.headers['Cache-Control'],'private, no-store');
 assert.deepEqual(logs,[['automation_held',{kind,reason}]]);
 assert.equal(response.headers['X-iCash-Automation-Outcome'],!finishThrows&&kind==='contacts'&&reasons.includes(reason)?'job-held':undefined,'Only a known request failure with a confirmed durable hold releases the worker slot from failure backoff');
 assert.equal(calls.length,2,'Unknown/shared failures do not read back or acknowledge a job-local hold; no provider, billing or retry calls');
 const finish=calls[1];assert.equal(finish.method,'POST');
 if(kind==='contacts'){
  assert.equal(finish.path,'rpc/icash_finish_owner_enrichment');
  assert.deepEqual(finish.body,{p_id:ticketBase.id,p_account:ticketBase.accountId,p_screening:ticketBase.screeningId,p_token:token,p_success:false,p_outcome:'held_for_reconciliation'});
 }else{
  assert.equal(finish.path,'rpc/icash_finish_automation');
  assert.deepEqual(finish.body,{p_id:ticketBase.id,p_success:false,p_outcome:'held_for_reconciliation'});
 }
 const repeated=await POST(request());assert.equal(repeated.status,401);
 assert.equal(calls.filter(c=>c.path.startsWith('rpc/icash_finish_')).length,1,'A repeated capability never retries original work');
}
const reasons=['OWNER_PREVIEW_FAILED_NO_RETRY','OWNER_PREVIEW_SAVE_UNCONFIRMED','OWNER_LOOKUP_FAILED_NO_RETRY','OWNER_EXPORT_RECONCILIATION_REQUIRED','OWNER_EXPORT_RECEIPT_SAVE_UNCONFIRMED','OWNER_EXPORT_RESPONSE_UNAVAILABLE','OWNER_EXPORT_RESPONSE_TOO_LARGE','OWNER_EXPORT_DOWNLOAD_UNAVAILABLE','OWNER_EXPORT_CAPACITY_BUSY'];
for(const reason of reasons){
 reset(Object.assign(Error(reason,{cause:privateData}),privateData,{stage:'paid',httpStatus:500}));
 await assertHeld(reason);
 reset(Error(reason),'discovery');await assertHeld('unclassified','discovery');
}
for(const error of [
 Error('OWNER_EXPORT_UNKNOWN_PRIVATE_CODE'),
 Error('OWNER_EXPORT_CAPACITY_BUSY '+JSON.stringify(privateData)),
 Error('OWNER_PREVIEW_SAVE_UNCONFIRMED '+JSON.stringify(privateData)),
 Error('OWNER_PREVIEW_FAILED_NO_RETRY\n'+token),
 Error(JSON.stringify(privateData)),
 {message:'OWNER_PREVIEW_SAVE_UNCONFIRMED',...privateData},
 'OWNER_PREVIEW_SAVE_UNCONFIRMED',
 Error('OWNER_PREVIEW_RATE_LIMITED'),
]){reset(error);await assertHeld('unclassified');}
reset(Error('OWNER_EXPORT_RECEIPT_SAVE_UNCONFIRMED'));finishThrows=true;await assertHeld('OWNER_EXPORT_RECEIPT_SAVE_UNCONFIRMED');

// Existing discovery telemetry keeps its bounded stage/status contract.
reset(Object.assign(Error('DISCOVERY_PROVIDER_REQUEST_FAILED_NO_RETRY'),privateData,{stage:'paid',httpStatus:429}),'discovery');
await POST(request());assert.deepEqual(logs,[['automation_held',{kind:'discovery',reason:'DISCOVERY_PROVIDER_REQUEST_FAILED_NO_RETRY',stage:'paid',httpStatus:429}]]);
delete globalThis.__automationHoldDiagnostics;
console.log('Automation hold diagnostics: exact contact codes, private-field rejection, unchanged durable holds and one-use completion; no provider requests.');
