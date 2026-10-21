import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {platformLearningReportSchema} from '../lib/shared-learning.ts';
import {workspaceEventStream} from '../lib/workspace-event-stream.ts';
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',account='00000000-0000-4000-8000-000000000001';
let user=null,reads=0;
const report={version:'shared-v1',checkedAt:new Date().toISOString(),minimumAccounts:3,contributionCap:200,maxLearnedShare:0.6,dueAccounts:0,failedAccounts:0,lastRefresh:null,cohortsTruncated:false,recoveryEnabled:0,filterEnabled:false,cohorts:[]};
async function load(file,mocks){globalThis.__learningRoute=mocks;const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(mocks).join(',')+'}=globalThis.__learningRoute;\n'+code).toString('base64'));}
const {GET}=await load('app/api/admin/learning/route.ts',{dashboardCurrentUser:async()=>user,ownerInboundTarget:{ownerUserId:owner},platformLearningReportSchema,db:async(path,method,body)=>{reads++;assert.equal(path,'rpc/icash_platform_learning_report');assert.equal(body.p_actor,owner);return report;}});
const request=()=>new Request('https://www.geticashx.com/api/admin/learning?accountId=foreign');
assert.equal((await GET(request())).status,401);user={id:account};assert.equal((await GET(request())).status,403);assert.equal(reads,0);
user={id:owner};const response=await GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie');assert.equal(reads,1);
let accountFailure='',eventReads=0;
const events=await load('app/api/work/events/route.ts',{workAccount:async()=>{if(accountFailure)throw Error(accountFailure);return {accountId:account};},workspaceEventStream,db:async(path,method,body)=>{eventReads++;assert.equal(path,'rpc/icash_workspace_revision_batch');assert.deepEqual(body.p_accounts,[account]);return {[account]:'42'};}});
const controller=new AbortController();
const eventResponse=await events.GET(new Request('https://www.geticashx.com/api/work/events?accountId=foreign',{signal:controller.signal}));
assert.equal(eventResponse.status,200);assert.equal(eventResponse.headers.get('Content-Type'),'text/event-stream');assert.equal(eventResponse.headers.get('Cache-Control'),'private, no-store');
const reader=eventResponse.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert(first.includes('"revision":"42"'));assert(!first.includes(account));controller.abort();
const readsBeforeDenial=eventReads;
for(const [failure,status] of [['SIGN_IN_REQUIRED',401],['ACCOUNT_REQUIRED',403],['WORKSPACE_ACKNOWLEDGMENT_REQUIRED',403],['DATABASE_UNAVAILABLE',503]]){
 accountFailure=failure;const denied=await events.GET(new Request('https://www.geticashx.com/api/work/events'));
 assert.equal(denied.status,status);assert.equal(denied.headers.get('Cache-Control'),'private, no-store');assert.equal(eventReads,readsBeforeDenial,'Denied accounts never read or subscribe to revisions');
 assert(!(await denied.text()).includes(failure),'Internal errors stay private');
}
delete globalThis.__learningRoute;
console.log('Shared learning routes: owner-only aggregates, authenticated same-origin updates, server-owned account scope and private revision-only responses passed.');
