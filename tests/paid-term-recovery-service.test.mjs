import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as policy from '../lib/membership-policy.ts';
import {vipActive} from '../lib/vip-policy.ts';
let row,calls=[];
const deps={...policy,vipActive,authorizedPlanPrice:async()=>{throw Error('Unexpected plan change');},fundingMode:()=> 'live',fundingStripe:()=>{throw Error('Recovery must never invoke Stripe');},db:async(path,method='GET',body)=>{
 calls.push({path,method,body});
 if(path==='rpc/icash_request_membership_cancellation'){assert.equal(body.p_account,'account');row={...row,state:'cancel_requested'};return row;}
 assert(path.startsWith('icash_memberships?'));
 if(method==='PATCH'){assert(path.includes('account_id=eq.account'));Object.assign(row,body);return [row];}
 return [row];
}};
globalThis.__paidRecoveryDeps=deps;
const code=ts.transpileModule(readFileSync(new URL('../lib/membership.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const service=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__paidRecoveryDeps;\n'+code).toString('base64'));
row={id:'recovery',account_id:'account',mode:'live',consent_version:'paid-term-recovery-v1',state:'active',price_cents:10000,paid_through:new Date(Date.now()+86400000).toISOString(),vip_until:new Date(Date.now()+86400000).toISOString(),cancel_at_period_end:true,stripe_subscription_id:null};
const current=await service.accountMembership('account');assert.equal(current.id,'recovery');assert(calls.every(c=>c.method==='GET'));
const view=service.publicMembership(current);assert.equal(view.nonRenewingRecovery,true);assert.equal(view.accessible,true);assert.equal(view.vip,true);assert.equal(await service.membershipRetentionOffer(current),null);
await service.stopMembership(current);assert.equal(row.state,'cancelled');assert(!service.publicMembership(row).accessible);
row={...current,state:'active',paid_through:new Date(Date.now()-1).toISOString()};calls=[];
const expired=await service.accountMembership('account');assert.equal(expired.state,'cancelled');assert.equal(service.publicMembership(expired).accessible,false);
assert.equal(calls.filter(c=>c.method==='PATCH').length,1);assert(calls.find(c=>c.method==='PATCH').path.includes('consent_version=eq.paid-term-recovery-v1'));
row={...current,state:'active',consent_version:'ordinary',paid_through:new Date(Date.now()-1).toISOString()};calls=[];await service.accountMembership('account');assert(calls.every(c=>c.method==='GET'),'Ordinary expired subscriptions are not rewritten by recovery cleanup');
console.log('PASS paid-term service: active software/VIP, no retention or Stripe actions, account-scoped expiration and immediate customer cancellation.');

const diagDeps={accountMembership:async()=>row,membershipAccessible:policy.membershipAccessible,fundingMode:()=> 'live',db:async()=>{throw Error('Unrelated check unavailable');}};
globalThis.__recoveryDiagnostics=diagDeps;
const diagCode=ts.transpileModule(readFileSync(new URL('../lib/support-diagnostics.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {collectSupportDiagnostics}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(diagDeps).join(',')+'}=globalThis.__recoveryDiagnostics;\n'+diagCode).toString('base64'));
for(const state of ['active','needs_review','cancel_requested','cancelled']){
 row={...current,state};const evidence=(await collectSupportDiagnostics('account')).find(e=>e.key==='subscription');
 assert.equal(evidence.softwareAccess,state==='active');assert.match(evidence.detail,/does not renew/);assert.doesNotMatch(evidence.detail,/\$100|\/month|new payment received/i);
 if(state==='needs_review')assert.match(evidence.detail,/held for payment review/);
}
console.log('PASS recovery support evidence: exact active/review/cancellation state, finite term and no invented recurring payment.');
