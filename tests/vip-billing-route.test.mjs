import assert from 'node:assert/strict';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {membershipAccessible} from '../lib/membership-policy.ts';
import {workspaceAcknowledgmentCurrent} from '../lib/workspace-acknowledgment.ts';
import {vipTermsVersion} from '../lib/vip-policy.ts';

// Keep the real route AND workAccount guard in this test. Mocking workAccount or
// the browser's successful billing response hid the pre-workspace VIP failure.
const account={id:'owned-account',billing_model:'membership_credits',workspace_ack_version:null,workspace_ack_user_id:null,workspace_ack_hash:null};
let user={id:'paid-buyer'},accounts=[account],membership={id:'paid-membership',account_id:account.id,state:'active',paid_through:new Date(Date.now()+86400000).toISOString()},calls=[],origin=true,unavailable=false;
const accountMembership=async id=>{assert.equal(id,account.id);if(unavailable)throw Error('Database request failed');return membership;};
const {workAccount}=await loadService('lib/work-account.ts',{
 currentUser:async()=>user,accountMembership,membershipAccessible,workspaceAcknowledgmentCurrent,
 db:async(path,method)=>{assert.equal(method,undefined,'Billing must never accept workspace terms for the buyer');assert.match(path,/owner_user_id=eq.paid-buyer/);return accounts;}
});
const route=await loadService('app/api/billing/vip/route.ts',{
 NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})},z,
 allowedOrigin:()=>origin,workAccount,accountMembership,vipTermsVersion,
 publicMembership:m=>m?{accessible:membershipAccessible(m),vip:!!m.vip_until}:null,
 reconcileVipChanges:async id=>{assert.equal(id,membership.id);calls.push({reconcile:id});},
 changeVipPlan:async(m,action,url,options)=>{assert.equal(m,membership);assert.equal(m.account_id,account.id);assert.equal(url,'https://www.geticashx.com');assert(options.request instanceof Request);calls.push({action,options});return {clientSecret:'fixture-secret',publishableKey:'pk_test_fixture',sessionId:'cs_test_fixture'};},
 limitRequest:async(req,key,id)=>{assert(req instanceof Request);assert.equal(key,'vip-plan');assert.equal(id,account.id);}
});
const purchase={action:'upgrade',accepted:true,version:vipTermsVersion,webinar:true,embedded:true};
const request=(body=purchase)=>new Request('https://www.geticashx.com/api/billing/vip',{method:'POST',headers:{origin:'https://www.geticashx.com','Content-Type':'application/json'},body:JSON.stringify(body)});

await assert.rejects(workAccount(),/WORKSPACE_ACKNOWLEDGMENT_REQUIRED/,'A new paid buyer has not entered the workspace');
let response=await route.GET();
assert.equal(response.status,200,'VIP plan lookup must work before the first workspace visit');
assert.equal(response.body.membership.accessible,true);
assert.equal(response.headers['Cache-Control'],'private, no-store');
response=await route.POST(request());
assert.equal(response.status,200,'A new paid buyer can open VIP payment before workspace acknowledgment');
assert.equal(response.body.sessionId,'cs_test_fixture');
assert.equal(calls.filter(c=>c.action==='upgrade').length,1);
assert.equal(calls.find(c=>c.action).options.embedded,true);
assert.equal(calls.find(c=>c.action).options.webinar,true);
await assert.rejects(workAccount(),/WORKSPACE_ACKNOWLEDGMENT_REQUIRED/,'Opening billing does not accept workspace terms or start work');
assert.equal(account.workspace_ack_version,null);
assert.equal(membership.vip_until,undefined,'Opening checkout does not grant VIP');

calls=[];user=null;
assert.equal((await route.GET()).status,401,'An expired sign-in is recoverable, not a fake service outage');
assert.equal((await route.POST(request())).status,401);
assert.equal(calls.length,0,'Anonymous requests cannot inspect or change an account');
user={id:'paid-buyer'};
for(const value of [[],[account,account]]){accounts=value;assert.equal((await route.GET()).status,409);assert.equal((await route.POST(request())).status,409);}
accounts=[account];
for(const state of ['pending','payment_failed','cancelled','needs_review']){membership.state=state;assert.equal((await route.POST(request())).status,409);}
membership.state='active';const paidThrough=membership.paid_through;membership.paid_through=null;assert.equal((await route.POST(request())).status,409);membership.paid_through=paidThrough;
assert.equal(calls.length,0,'The onboarding exception cannot bypass ownership or paid membership');
origin=false;assert.equal((await route.POST(request())).status,403);origin=true;
for(const patch of [{accepted:false},{version:'old'},{accountId:'another-account'},{userId:'another-user'}])assert.equal((await route.POST(request({...purchase,...patch}))).status,409);
assert.equal(calls.length,0,'Origin, terms, and client-selected account guards still apply');
unavailable=true;assert.equal((await route.GET()).status,503,'A real service failure remains unavailable');
unavailable=false;assert.equal((await route.GET()).status,200,'The same buyer can retry after recovery');
console.log('PASS VIP billing route + real account guard: new paid buyer before workspace acknowledgment, signed-out recovery, account ownership, paid membership, terms, origin, and no fabricated acceptance. No live providers.');
