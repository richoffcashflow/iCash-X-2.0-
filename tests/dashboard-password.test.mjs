import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {dashboardCookie,dashboardLifetime,issueDashboardProof,validDashboardProof} from '../lib/dashboard-password-policy.ts';
import {dashboardPath,dashboardReturnPath} from '../lib/dashboard-paths.ts';
const userId='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',sessionId='a34c37bf-f70e-4701-ac7d-9f8b28e15bc0',key='test-only-key-'.repeat(4),now=1800000000000;
const access=(sub=userId,sid=sessionId)=>'header.'+Buffer.from(JSON.stringify({sub,session_id:sid})).toString('base64url')+'.signature';
const proof=issueDashboardProof(access(),userId,key,now);
assert(validDashboardProof(proof,access(),key,userId,now));
assert(!validDashboardProof(proof,access(),key,userId,now+dashboardLifetime*1000));
assert(!validDashboardProof(proof,access(userId,'11111111-1111-1111-1111-111111111111'),key,userId,now));
assert(!validDashboardProof(proof,access('11111111-1111-1111-1111-111111111111'),key,userId,now));
assert(!validDashboardProof(proof+'x',access(),key,userId,now));
assert(!validDashboardProof(proof,access(),key+'x',userId,now));
assert(!validDashboardProof(proof,undefined,key,userId,now));
assert(!validDashboardProof(proof,access(),undefined,userId,now));
assert(!validDashboardProof(proof,access(),key,userId,now-10000));
for(const path of ['/admin','/admin/disputes','/webinaradmin','/messagingadmin/calls','/owner-reception','/test-bot'])assert(dashboardPath(path));
for(const path of ['/','/sell','/buyers','/webinar','/support','/api/webhooks/stripe','/admin-lookalike'])assert(!dashboardPath(path));
for(const path of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','/api/internal/seller','/admin/../../sell'])assert.equal(dashboardReturnPath(path),'/admin');
assert.equal(dashboardReturnPath('/admin/disputes?page=2'),'/admin/disputes?page=2');

let user={id:userId,email:'owner@example.invalid',email_confirmed_at:'2026-10-01'},limited=false,correct=true,mismatch=false,authCalls=[],jar=new Map([['icash_access',access()]]),cookieOptions;
const mocks={dashboardCookie,dashboardLifetime,issueDashboardProof,validDashboardProof,ownerInboundTarget:{ownerUserId:userId},
 cookies:async()=>({get:n=>jar.has(n)?{value:jar.get(n)}:undefined,set:(n,v,o)=>{if(o.maxAge===0)jar.delete(n);else jar.set(n,v);cookieOptions=o;},delete:n=>jar.delete(n)}),
 currentUser:async()=>user,allowedOrigin:r=>r.headers.get('origin')==='https://app.invalid',limitRequest:async()=>{if(limited)throw Error('rate limited');},db:async()=>[],
 authRequest:async(path,body,token)=>{authCalls.push(path);if(path.startsWith('token')){if(!correct)throw Error('invalid password');return {access_token:'temporary-grant',user:{id:mismatch?'11111111-1111-1111-1111-111111111111':userId,email_confirmed_at:'yes'}};}assert.equal(token,'temporary-grant');},
};
globalThis.__dashboardTest=mocks;
function load(path){const source=readFileSync(new URL(path,import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(mocks).join(',')+'}=globalThis.__dashboardTest;\n'+code).toString('base64'));}
process.env.SUPABASE_SECRET_KEY=key;
const route=await load('../app/api/auth/dashboard-password/route.ts');
const request=(origin='https://app.invalid')=>new Request('https://app.invalid/api/auth/dashboard-password',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({password:'fixture-only'})});
assert.equal((await route.POST(request('https://evil.invalid'))).status,403);assert.equal(authCalls.length,0);
user=null;assert.equal((await route.POST(request())).status,403);assert.equal(authCalls.length,0);
user={id:'11111111-1111-1111-1111-111111111111',email:'customer@example.invalid'};assert.equal((await route.POST(request())).status,403);assert.equal(authCalls.length,0);
user={id:userId,email:'owner@example.invalid'};limited=true;assert.equal((await route.POST(request())).status,403);assert.equal(authCalls.length,0);limited=false;
correct=false;assert.equal((await route.POST(request())).status,403);assert(!jar.has(dashboardCookie));correct=true;
mismatch=true;assert.equal((await route.POST(request())).status,403);assert(!jar.has(dashboardCookie));mismatch=false;
assert.equal((await route.POST(request())).status,200);assert(validDashboardProof(jar.get(dashboardCookie),access(),key,userId));assert.equal(jar.get('icash_access'),access());assert.deepEqual(cookieOptions,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:3600});
assert.equal((await route.GET()).status,200);assert.equal((await (await route.GET()).json()).unlocked,true);
assert.equal((await route.DELETE(request('https://evil.invalid'))).status,403);assert(jar.has(dashboardCookie));
await route.DELETE(request());assert(!jar.has(dashboardCookie));assert.equal((await (await route.GET()).json()).unlocked,false);
assert(authCalls.includes('logout?scope=local'));
delete globalThis.__dashboardTest;delete process.env.SUPABASE_SECRET_KEY;
console.log('PASS dashboard password: user/session binding, tampering, expiry, redirect safety, origin, owner-only grants, rate limit, password failure, temporary-session revocation, secure cookies and lock.');
