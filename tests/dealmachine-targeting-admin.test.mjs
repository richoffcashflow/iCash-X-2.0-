import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {targetingDefinitionSchema} from '../lib/dealmachine-targeting.ts';
import {targetingReportSchema} from '../lib/targeting-report.ts';
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
const report={version:'seller-targeting-v1',checkedAt:new Date().toISOString(),cohortsTruncated:false,dedupPending:0,dedupReadyAccounts:0,configuredAccounts:0,settings:{enabled:false,mobile_verified:false},capabilities:null,experiments:[],cohorts:[]};
let user={id:owner},queries=[],savedReport=report;
const mocks={z,targetingDefinitionSchema,targetingReportSchema,ownerInboundTarget:{ownerUserId:owner},dashboardCurrentUser:async verified=>{assert.equal(verified,true);return user;},db:async(path,method,body)=>{queries.push({path,method,body});return path.endsWith('report')?savedReport:true;}};
globalThis.__targetingAdmin=mocks;
try{
 const code=ts.transpileModule(readFileSync(new URL('../app/api/admin/targeting/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(mocks).join(',')}}=globalThis.__targetingAdmin;\n${code}`).toString('base64'));
 const get=()=>GET(new Request('https://example.invalid/api/admin/targeting?actor=forged'));
 const post=(body,origin='https://example.invalid')=>POST(new Request('https://example.invalid/api/admin/targeting',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 for(const identity of [null,{id:'foreign',user_metadata:{ownerUserId:owner}}]){
  user=identity;assert.equal((await get()).status,identity?403:401);assert.equal((await post({action:'set_enabled',enabled:true})).status,identity?403:401);
 }assert.equal(queries.length,0);
 user={id:owner};assert.equal((await post({action:'set_enabled',enabled:true},'https://attacker.invalid')).status,403);
 assert.equal((await post({action:'set_enabled',enabled:true,budget:999999})).status,409);assert.equal(queries.length,0);
 let response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');assert.deepEqual(await response.json(),{report});assert.deepEqual(queries[0].body,{p_actor:owner});
 response=await post({action:'set_enabled',enabled:true});assert.equal(response.status,200);assert.deepEqual(queries[1].body,{p_actor:owner,p_action:'set_enabled',p_definition:null,p_enabled:true});
 for(const bad of [null,{}, {...report,settings:{enabled:true}},{...report,dedupPending:-1}]){savedReport=bad;assert.equal((await get()).status,503);}
 console.log('PASS targeting admin: owner/session/origin binding, exact actions, private caching and malformed evidence refusal.');
}finally{delete globalThis.__targetingAdmin;}
