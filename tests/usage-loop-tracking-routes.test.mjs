import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {usageLoopEventSchema,usageLoopReportSchema,pruneUsageLoopObservations} from '../lib/usage-loop-tracking.ts';
const load=async(file,key,deps)=>{
 globalThis[key]=deps;
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
 return import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(deps).join(',')}}=globalThis.${key};\n`+code).toString('base64'));
};
let signedIn=true,origin=true,mode='live',writes=0,lastWrite;
const user='00000000-0000-4000-8000-000000000001',impressionId='00000000-0000-4000-8000-000000000002';
const input={impressionId,event:'shown',action:'funding',reason:'refill'};
const req=body=>new Request('https://example.test/api/work/usage-loop-event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const eventRoute=await load('app/api/work/usage-loop-event/route.ts','usageEventTest',{currentUser:async()=>signedIn?{id:user}:null,accountMode:()=>mode,allowedOrigin:()=>origin,usageLoopEventSchema,db:async(path,method,body)=>{assert.equal(path,'rpc/icash_record_usage_loop_event');writes++;lastWrite=body;return true;}});
assert.equal((await eventRoute.POST(req(input))).status,200);assert.equal(lastWrite.p_user,user);assert.equal(lastWrite.p_observation,impressionId);
assert.equal((await eventRoute.POST(req({...input,accountId:'other'}))).status,400);assert.equal(writes,1);
assert.equal((await eventRoute.POST(req({...input,event:'funded'}))).status,400);assert.equal(writes,1);
origin=false;assert.equal((await eventRoute.POST(req(input))).status,403);origin=true;
signedIn=false;assert.equal((await eventRoute.POST(req(input))).status,401);signedIn=true;
mode='test';assert.equal((await eventRoute.POST(req(input))).status,401);assert.equal(writes,1);

const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';let actor=null,reportReads=0;
const adminRoute=await load('app/api/admin/usage-loop/route.ts','usageAdminTest',{dashboardCurrentUser:async()=>actor?{id:actor}:null,ownerInboundTarget:{ownerUserId:owner},usageLoopReportSchema,db:async()=>{reportReads++;throw Error('optional analytics unavailable');}});
const adminReq=new Request('https://example.test/api/admin/usage-loop');
assert.equal((await adminRoute.GET(adminReq)).status,401);actor=user;
assert.equal((await adminRoute.GET(adminReq)).status,403);assert.equal(reportReads,0);actor=owner;
assert.equal((await adminRoute.GET(new Request(adminReq.url+'?includeOwner=anything'))).status,400);
assert.equal((await adminRoute.GET(adminReq)).status,503);assert.equal(reportReads,1);

// A retention outage must not block the other maintenance lanes or turn their
// healthy status into a failed maintenance tick.
let lanesRan=false,monitorRan=false,pruneTried=false;
const maintenance=await load('app/api/internal/maintenance/route.ts','usageMaintenanceTest',{
 authorizeOutboundBilling:()=>true,pruneUsageLoopObservations,
 db:async path=>{assert.equal(path,'rpc/icash_prune_usage_loop_observations');pruneTried=true;throw Error('telemetry unavailable');},
 maintenanceBatch:async lanes=>{assert.deepEqual(Object.keys(lanes),['webinar','purchaseEmail','purchaseFollowups','outbound','recording','ownerRecording','reception']);lanesRan=true;return {ok:true};},
 refreshReliability:async(_db,ok)=>{assert.equal(ok,true);monitorRan=true;return true;},
 webinarFollowups:async()=>{},outbound:async()=>{},recording:async()=>{},ownerRecording:async()=>{},reception:async()=>{},
});
assert.equal((await maintenance.GET(new Request('https://example.test/api/internal/maintenance'))).status,200);
assert(pruneTried&&lanesRan&&monitorRan);
for(const key of ['usageEventTest','usageAdminTest','usageMaintenanceTest'])delete globalThis[key];
console.log('PASS usage tracking routes: same-origin/session/mode checks, no client account or conversion fields, owner-only report, and telemetry failure isolated from maintenance.');
