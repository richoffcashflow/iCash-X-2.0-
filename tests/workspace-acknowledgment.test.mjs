import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {workspaceAcknowledgmentCurrent,workspaceAcknowledgmentHash} from '../lib/workspace-acknowledgment.ts';
import {workspaceAcknowledgmentVersion,workspaceAcknowledgmentDocument} from '../lib/workspace-acknowledgment-policy.ts';
const pg=new PGlite(),account='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.icash_accounts(id uuid primary key,owner_user_id uuid references auth.users);insert into auth.users values('${owner}'),('${other}');insert into public.icash_accounts values('${account}','${owner}');grant select,update on public.icash_accounts to service_role;`);
 await pg.exec(readFileSync(new URL('../supabase/migrations/20261015220517_workspace_acknowledgment.sql',import.meta.url),'utf8'));
 assert.equal(workspaceAcknowledgmentCurrent((await pg.query('select * from icash_accounts')).rows[0],owner),false,'migration never accepts on behalf of users');
 await pg.exec('set role service_role');
 const accept=async(user=owner,hash=workspaceAcknowledgmentHash,document=workspaceAcknowledgmentDocument)=>(await pg.query('select public.icash_accept_workspace_acknowledgment($1,$2,$3,$4,$5,$6) as receipt',[account,user,workspaceAcknowledgmentVersion,document,hash,JSON.stringify({userAgent:'local fixture'})])).rows[0].receipt;
 await assert.rejects(accept(other),/Account owner required/);
 await assert.rejects(accept(owner,'0'.repeat(64)),/Document hash mismatch/);
 const first=await accept(),retry=await accept();assert.deepEqual(first,retry,'a retry preserves the original acceptance time');
 assert.equal((await pg.query('select count(*)::int as count from icash_workspace_acknowledgments')).rows[0].count,1);
 assert.equal(workspaceAcknowledgmentCurrent((await pg.query('select * from icash_accounts')).rows[0],owner),true);
 assert.equal(workspaceAcknowledgmentCurrent((await pg.query('select * from icash_accounts')).rows[0],other),false,'acceptance is bound to the person');
 await assert.rejects(pg.query('update icash_workspace_acknowledgments set accepted_at=now()'),/permission denied/);
 await assert.rejects(pg.query('delete from icash_workspace_acknowledgments'),/permission denied/);
 const changed=workspaceAcknowledgmentDocument+' changed',changedHash=(await pg.query("select encode(sha256(convert_to($1,'UTF8')),'hex') as hash",[changed])).rows[0].hash;
 await assert.rejects(accept(owner,changedHash,changed),/Acknowledgment version changed/);
 for(const role of ['anon','authenticated']){
  await pg.exec(`reset role;set role ${role}`);
  await assert.rejects(accept(),/permission denied/);
  await assert.rejects(pg.query('select * from icash_workspace_acknowledgments'),/permission denied/);
 }
}finally{await pg.close();}

let signedIn=true,origin=true,fail=false,receiptMissing=false,calls=[];
const deps={z,workspaceAcknowledgmentVersion,workspaceAcknowledgmentDocument,workspaceAcknowledgmentHash,allowedOrigin:()=>origin,purchaseContext:()=>({userAgent:'fixture'}),NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},workAccount:async options=>{assert.deepEqual(options,{allowInactiveMembership:true,allowUnacknowledged:true});if(!signedIn)throw Error('SIGN_IN_REQUIRED');return {accountId:account,userId:owner};},db:async(path,method,body)=>{calls.push({path,method,body});if(fail)throw Error('private database detail');if(method==='POST')return {accepted:true,version:workspaceAcknowledgmentVersion,acceptedAt:'2026-10-15T22:30:00Z'};assert(path.includes(`account_id=eq.${account}&user_id=eq.${owner}&version=eq.${workspaceAcknowledgmentVersion}`));return receiptMissing?[]:[{document:workspaceAcknowledgmentDocument,accepted_at:'2026-10-15T22:30:00Z'}];}};
const route=await loadService('app/api/account/workspace-acknowledgment/route.ts',deps);
const request=body=>new Request('https://www.geticashx.com/api/account/workspace-acknowledgment',{method:'POST',body:JSON.stringify(body)}),valid={version:workspaceAcknowledgmentVersion,accepted:true};
for(const body of [{...valid,accepted:false},{...valid,version:'old'},{...valid,accountId:other}])assert.equal((await route.POST(request(body))).status,409);
assert.equal(calls.length,0);
origin=false;assert.equal((await route.POST(request(valid))).status,403);origin=true;
signedIn=false;assert.equal((await route.POST(request(valid))).status,401);signedIn=true;
assert.equal((await route.POST(request(valid))).status,200);
assert.deepEqual(calls[0].body,{p_account:account,p_user:owner,p_version:workspaceAcknowledgmentVersion,p_document:workspaceAcknowledgmentDocument,p_hash:workspaceAcknowledgmentHash,p_context:{userAgent:'fixture'}});
fail=true;const failed=await route.POST(request(valid));assert.equal(failed.status,503);assert(!JSON.stringify(failed).includes('private database'));fail=false;
const copy=await route.GET();assert.equal(copy.headers.get('cache-control'),'private, no-store');assert.match(copy.headers.get('content-disposition'),/attachment/);assert.match(await copy.text(),/Accepted: .*PM/);
receiptMissing=true;assert.equal((await route.GET()).status,404);

let acknowledged=false,discoveries=0;
const discovery=await loadService('app/api/work/discovery/route.ts',{NextResponse:deps.NextResponse,currentUser:async()=>({id:owner}),fundingMode:()=> 'live',db:async()=>[{id:account}],workspaceAcknowledgmentCurrent:()=>acknowledged,discoverForAccount:async()=>{discoveries++;return {status:'queued'};}});
const discoveryRequest=()=>new Request('https://www.geticashx.com/api/work/discovery',{method:'POST',headers:{origin:'https://www.geticashx.com'}});
assert.equal((await discovery.POST(discoveryRequest())).status,403);assert.equal(discoveries,0);acknowledged=true;assert.equal((await discovery.POST(discoveryRequest())).status,200);assert.equal(discoveries,1);
const originalReady=process.env.ICASH_LIVE_WORK_READY;process.env.ICASH_LIVE_WORK_READY='true';
try{
 let mutations=[];acknowledged=false;
 const control=await loadService('app/api/work/control/route.ts',{z,NextResponse:deps.NextResponse,allowedOrigin:()=>true,fundingMode:()=> 'live',stopDaily:async()=>{throw Error('No billing provider in fixtures');},workAccount:async options=>{if(!acknowledged&&!options.allowUnacknowledged)throw Error('WORKSPACE_ACKNOWLEDGMENT_REQUIRED');if(options.allowUnacknowledged)assert.equal(options.allowInactiveMembership,true);return {accountId:account,userId:owner};},db:async(path,method,body)=>{if(method==='POST')mutations.push({path,body});return [];}});
 const controlRequest=action=>new Request('https://www.geticashx.com/api/work/control',{method:'POST',body:JSON.stringify({action,...(['takeover','return_to_bot'].includes(action)?{screeningId:other}:{})})});
 for(const action of ['resume','takeover','return_to_bot'])assert.notEqual((await control.POST(controlRequest(action))).status,200);
 assert.equal(mutations.length,0);assert.equal((await control.POST(controlRequest('pause'))).status,200);assert.equal(mutations[0].path,'rpc/icash_pause_work_and_billing');
 acknowledged=true;assert.equal((await control.POST(controlRequest('takeover'))).status,200);assert.deepEqual(mutations[1].body,{p_user:owner,p_account:account,p_action:'takeover',p_screening:other});
}finally{if(originalReady===undefined)delete process.env.ICASH_LIVE_WORK_READY;else process.env.ICASH_LIVE_WORK_READY=originalReady;}
console.log('PASS workspace acknowledgment: immutable owner-bound receipts, version/hash integrity, explicit acceptance, private copies, retries and discovery admission. No live provider requests.');
