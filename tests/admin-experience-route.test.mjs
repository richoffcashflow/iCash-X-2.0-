import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {workspaceExperienceSummarySchema} from '../lib/workspace-experience.ts';
import {reliabilityAlertStatusSchema} from '../lib/reliability-alerts.ts';

const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
const experience={days:7,lastObservedAt:'2026-10-14T18:30:00Z',counts:[{event:'panel_error',stage:'closing',count:2,accounts:1}]};
const alerts={configuration:'ready',checkedAt:'2026-10-14T18:31:00Z',active:null,notifications:{pending:0,accepted:1,needsReview:0},lastNotificationAt:'2026-10-14T18:31:00Z'};
let user={id:owner},queries=[],authFailure=false,rpcFailure=false,report=experience,alertReport=alerts;
const mocks={workspaceExperienceSummarySchema,reliabilityAlertStatusSchema,ownerInboundTarget:{ownerUserId:owner},currentUser:async verify=>{assert.equal(verify,true);if(authFailure)throw Error('Private authentication detail');return user;},db:async(path,method,body,signal)=>{queries.push({path,method,body,signal});if(rpcFailure)throw Error('Private provider credential');return path==='rpc/icash_workspace_experience_summary'?report:alertReport;}};
globalThis.__adminExperience=mocks;
const code=ts.transpileModule(readFileSync(new URL('../app/api/admin/experience/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(mocks).join(',')}}=globalThis.__adminExperience;\n${code}`).toString('base64'));
const get=()=>GET(new Request('https://example.invalid/api/admin/experience?actor=another-user&account=another-account'));
const checkPrivate=response=>{assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');};
try{
 user=null;let response=await get();assert.equal(response.status,401);checkPrivate(response);
 user={id:'another-user',user_metadata:{isBillingOwner:true,ownerUserId:owner}};response=await get();assert.equal(response.status,403);checkPrivate(response);assert.equal(queries.length,0);
 authFailure=true;response=await get();assert.equal(response.status,503);assert(!JSON.stringify(await response.json()).includes('Private'));assert.equal(queries.length,0);authFailure=false;
 user={id:owner};response=await get();assert.equal(response.status,200);checkPrivate(response);assert.deepEqual(await response.json(),{experience,alerts});
 assert.equal(queries.length,2);assert.deepEqual(queries.map(q=>q.path),['rpc/icash_workspace_experience_summary','rpc/icash_reliability_alert_status_v2']);
 for(const query of queries){assert.equal(query.method,'POST');assert.deepEqual(query.body,{p_actor:owner});assert(query.signal instanceof AbortSignal);}
 const unavailable={error:'Workspace monitoring could not load. Try again in a moment.'};
 for(const bad of [null,{}, {...experience,counts:[{event:'panel_error',stage:'closing',count:-1,accounts:1}]},{...experience,email:'private@example.invalid'},{...experience,counts:[{event:'panel_error',stage:'closing',count:1,accounts:1,message:'Private property'}]}]){
  report=bad;response=await get();assert.equal(response.status,503);checkPrivate(response);assert.deepEqual(await response.json(),unavailable);
 }
 report=experience;
 for(const bad of [null,{}, {...alerts,configuration:'delivered'},{...alerts,recipient:'private@example.invalid'},{...alerts,notifications:{pending:0,accepted:1,needsReview:-1}}]){
  alertReport=bad;response=await get();assert.equal(response.status,503);assert.deepEqual(await response.json(),unavailable);
 }
 alertReport=alerts;rpcFailure=true;response=await get();assert.equal(response.status,503);assert.deepEqual(await response.json(),unavailable);
}finally{delete globalThis.__adminExperience;}
console.log('PASS owner experience API: verified owner only, bound RPC actor, private caching, strict aggregate schemas, and safe failures.');
