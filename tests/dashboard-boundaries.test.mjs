import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {contentSecurityPolicy,securityHeaders,webinarSecurityHeaders} from '../lib/security-headers.ts';
import {dashboardCookie,issueDashboardProof,validDashboardProof} from '../lib/dashboard-password-policy.ts';
const id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',sid='a34c37bf-f70e-4701-ac7d-9f8b28e15bc0',key='fixture-secret-'.repeat(4);
const access='h.'+Buffer.from(JSON.stringify({sub:id,session_id:sid})).toString('base64url')+'.s';
let user={id},proof;
const mocks={dashboardCookie,validDashboardProof,cookies:async()=>({get:n=>({value:n===dashboardCookie?proof:access})}),currentUser:async()=>user,workAccount:async()=>({userId:id,accountId:'account'})};
globalThis.__dashboardBoundaries=mocks;process.env.SUPABASE_SECRET_KEY=key;
const code=ts.transpileModule(readFileSync(new URL('../lib/dashboard-password.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const guard=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(mocks).join(',')+'}=globalThis.__dashboardBoundaries;\n'+code).toString('base64'));
await assert.rejects(guard.dashboardCurrentUser(true),/DASHBOARD_PASSWORD_REQUIRED/);await assert.rejects(guard.dashboardWorkAccount(),/DASHBOARD_PASSWORD_REQUIRED/);
proof=issueDashboardProof(access,id,key);assert.equal((await guard.dashboardCurrentUser(true)).id,id);assert.equal((await guard.dashboardWorkAccount()).userId,id);
user={id:'different-account'};await assert.rejects(guard.dashboardCurrentUser(true),/DASHBOARD_PASSWORD_REQUIRED/);
user=null;assert.equal(await guard.dashboardCurrentUser(true),null);
// Protect all current owner route variants as well as their shared operator/studio boundaries.
for(const dir of ['admin','owner-reception','owner-inbound-acceptance','owner-recording-test','owner-outbound-readiness','owner-voice-acceptance']){
 const root=new URL('../app/api/'+dir+'/',import.meta.url);for(const file of readdirSync(root,{recursive:true}).filter(p=>p.endsWith('route.ts'))){
  const source=readFileSync(new URL(file,root),'utf8');
  if(dir==='admin'&&file.startsWith('accounts/')){
   assert.match(source,/from '@\/lib\/owner-account-access'/,file);
   assert.match(source,/await ownerAccount(?:Actor|View)\(/,file);
   assert.match(readFileSync(new URL('../lib/owner-account-access.ts',import.meta.url),'utf8'),/await dashboardCurrentUser\(true\)/);
  }else assert.match(source,/from '@\/lib\/dashboard-password'/,dir+'/'+file);
 }
}
for(const file of ['webinar-account-adapter.ts','trusted-operator.ts','voice-test-server.ts'])assert.match(readFileSync(new URL('../lib/'+file,import.meta.url),'utf8'),/from '@\/lib\/dashboard-password'/);
assert.match(contentSecurityPolicy,/frame-ancestors 'none'/);assert.match(contentSecurityPolicy,/object-src 'none'/);assert.match(contentSecurityPolicy,/base-uri 'self'/);assert(!contentSecurityPolicy.includes('unsafe-eval'));assert.match(contentSecurityPolicy,/wss:\/\/\*\.twilio\.com/);assert.match(contentSecurityPolicy,/https:\/\/js\.stripe\.com/);
const headers=Object.fromEntries(securityHeaders.map(h=>[h.key,h.value]));assert.equal(headers['X-Frame-Options'],'DENY');assert.equal(headers['X-Content-Type-Options'],'nosniff');assert.match(headers['Permissions-Policy'],/microphone=\(self\)/);
assert(!contentSecurityPolicy.includes('www.facebook.com/signals/iwl.js'),'Meta setup script stays outside private page CSP');
const webinarHeaders=Object.fromEntries(webinarSecurityHeaders.map(h=>[h.key,h.value]));assert.match(webinarHeaders['Content-Security-Policy'],/https:\/\/www\.facebook\.com\/signals\/iwl\.js/);assert.match(webinarHeaders['Content-Security-Policy'],/frame-ancestors 'none'/);assert.equal(webinarHeaders['X-Frame-Options'],'DENY');
// The shared webinar adapter also serves ordinary customers: only its owner branch is gated.
let viewerUserId='customer';
const adapterMocks={currentUser:async()=>({id:viewerUserId}),dashboardCurrentUser:async()=>{throw Error('DASHBOARD_PASSWORD_REQUIRED');},ownerInboundTarget:{ownerUserId:id},webinarSite:{companyKey:'icash-x',workspacePath:'/'},db:async()=>[{id:'customer-account',bot_paused:false,daily_limit_cents:1000}]};
globalThis.__dashboardAdapter=adapterMocks;
const adapterCode=ts.transpileModule(readFileSync(new URL('../lib/webinar-account-adapter.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const adapter=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(adapterMocks).join(',')+'}=globalThis.__dashboardAdapter;\n'+adapterCode).toString('base64'));
assert.equal((await adapter.webinarCustomerAccount()).id,'customer-account');
assert.equal((await adapter.webinarCustomerAccount()).isOwner,false);
viewerUserId=id;assert.equal((await adapter.webinarCustomerAccount()).isOwner,true,'Signed-in owner may watch published webinars without dashboard unlock');
await assert.rejects(adapter.webinarOwnerIdentity(),/DASHBOARD_PASSWORD_REQUIRED/);
process.env.WEBINAR_OWNER_USER_ID='configured-owner';
assert.equal((await adapter.webinarCustomerAccount()).isOwner,false,'A configured owner replaces the product fallback');
viewerUserId='configured-owner';assert.equal((await adapter.webinarCustomerAccount()).isOwner,true);
delete process.env.WEBINAR_OWNER_USER_ID;delete globalThis.__dashboardAdapter;
delete globalThis.__dashboardBoundaries;delete process.env.SUPABASE_SECRET_KEY;
console.log('PASS dashboard API guards reject bypasses; all owner entry points covered; customer/public routes separate; headers preserve calling and checkout.');
