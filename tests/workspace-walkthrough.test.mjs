import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
import {walkthroughInput,walkthroughState,walkthroughVersion} from '../lib/workspace-walkthrough.ts';

const pg=new PGlite(),adapter=databaseAdapter(pg),{q,rpc}=adapter;
const oldAccount=randomUUID(),newAccount=randomUUID(),owner=randomUUID(),other=randomUUID();
try{
 await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;create table public.icash_accounts(id uuid primary key,owner_user_id uuid,workspace_ack_version text);grant select on public.icash_accounts to service_role;');
 await q('insert into icash_accounts values($1,$2,$3),($4,$5,null)',[oldAccount,owner,'accepted-version',newAccount,other]);
 await pg.exec(readFileSync(new URL('../config/workspace-walkthrough.sql',import.meta.url),'utf8'));
 await pg.exec('set role service_role');
 assert.equal((await q('select state from icash_workspace_walkthroughs where account_id=$1',[oldAccount])).rows[0].state,'available','Existing users are not interrupted or marked complete');
 assert.equal((await q('select * from icash_workspace_walkthroughs where account_id=$1',[newAccount])).rows.length,0);
 const input={p_account:newAccount,p_user:other,p_step:1,p_state:'active'};
 await assert.rejects(()=>rpc('icash_save_workspace_walkthrough',{...input,p_user:owner}),/Account owner/);
 for(const bad of [{p_step:-1},{p_step:4},{p_step:null},{p_state:'new'},{p_state:null},{p_state:'completed',p_step:1}])await assert.rejects(()=>rpc('icash_save_workspace_walkthrough',{...input,...bad}),/Invalid walkthrough/);
 assert.deepEqual(await rpc('icash_save_workspace_walkthrough',input),{step:1,state:'active'});
 await rpc('icash_save_workspace_walkthrough',input);
 assert.equal((await q('select * from icash_workspace_walkthroughs where account_id=$1',[newAccount])).rows.length,1,'Duplicate save is idempotent');
 assert.deepEqual(await rpc('icash_save_workspace_walkthrough',{...input,p_state:'dismissed'}),{step:1,state:'dismissed'});
 assert.deepEqual(await rpc('icash_save_workspace_walkthrough',{...input,p_state:'completed',p_step:3}),{step:3,state:'completed'});
 assert.equal((await q('select workspace_ack_version from icash_accounts where id=$1',[newAccount])).rows[0].workspace_ack_version,null,'A tour never accepts the workspace acknowledgment');
 let accountId=oldAccount,userId=owner,authError=false,origin=true,limited=false;
 const course={revision:1,state:'in_progress',percent:20};
 const db=async(path,method,body)=>{const data=await adapter.db(path,method,body);return path.startsWith('icash_workspace_walkthroughs?')?data.map(({step,state})=>({step,state})):data;};
 const route=await loadService('app/api/account/walkthrough/route.ts',{workAccount:async()=>{if(authError)throw Error('SIGN_IN_REQUIRED');return {accountId,userId};},db,allowedOrigin:()=>origin,limitRequest:async(req,scope,id)=>{assert.equal(scope,'workspace-walkthrough');assert.equal(id,accountId);if(limited)throw Object.assign(Error('Limited'),{status:429});},readCourseProgress:async id=>{assert.equal(id,accountId);return course;},walkthroughInput,walkthroughState,walkthroughVersion});
 let response=await route.GET();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal((await response.json()).tour.state,'available');
 accountId=newAccount;userId=other;
 response=await route.GET();const loaded=await response.json();assert.deepEqual(loaded.tour,{step:3,state:'completed'});assert.equal(loaded.course.percent,20,'Tour completion does not mark the course watched');
 const request=value=>new Request('https://example.invalid/api/account/walkthrough',{method:'POST',body:JSON.stringify(value)});
 assert.equal((await route.POST(request({step:0,state:'active'}))).status,200,'Completed tours can be replayed');
 assert.equal((await route.POST(request({step:1,state:'active',accountId:oldAccount}))).status,400,'Clients cannot choose the account');
 origin=false;assert.equal((await route.POST(request({step:1,state:'active'}))).status,403);origin=true;
 limited=true;assert.equal((await route.POST(request({step:1,state:'active'}))).status,429);limited=false;
 authError=true;assert.equal((await route.GET()).status,401);assert.equal((await route.POST(request({step:1,state:'active'}))).status,401);authError=false;
 for(const role of ['anon','authenticated']){await pg.exec('reset role;set role '+role);await assert.rejects(()=>q('select * from icash_workspace_walkthroughs'));await assert.rejects(()=>rpc('icash_save_workspace_walkthrough',input));}
}finally{await pg.close();}
console.log('PASS walkthrough: account-bound resume/dismiss/replay, existing-user rollout, private grants, input/auth/origin/rate checks, and course/consent separation. No external services.');
