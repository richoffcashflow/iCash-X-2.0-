import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {membershipAccessible} from '../lib/membership-policy.ts';
import {vipActive} from '../lib/vip-policy.ts';
import {workspaceAcknowledgmentCurrent,workspaceAcknowledgmentHash} from '../lib/workspace-acknowledgment.ts';
import {workspaceAcknowledgmentVersion} from '../lib/workspace-acknowledgment-policy.ts';
let user={id:'owner'},account={id:'owned-account',billing_model:'membership_credits',workspace_ack_version:workspaceAcknowledgmentVersion,workspace_ack_user_id:'owner',workspace_ack_hash:workspaceAcknowledgmentHash},membership,calls=[],preview=false;
const deps={workspaceAcknowledgmentCurrent,membershipAccessible,vipActive,currentUser:async()=>user,accountMembership:async id=>{assert.equal(id,account.id);return membership;},db:async(path,method,body)=>{calls.push({path,method});if(path==='rpc/icash_vip_features_active'){assert.equal(method,'POST');assert.equal(body.p_account,account.id);return preview||vipActive(membership);}assert.equal(method,'GET','Access checks never charge or alter credits');assert(path.includes('owner_user_id=eq.owner'));return account?[account]:[];}};
globalThis.__workAccess=deps;
const source=ts.transpileModule(readFileSync(new URL('../lib/work-account.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {workAccount}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__workAccess;\n'+source).toString('base64'));
const future=new Date(Date.now()+86400000).toISOString();
for(const state of ['payment_failed','pending','cancelled','needs_review']){
 membership={state,paid_through:future};account.balance_cents=100000;
 await assert.rejects(workAccount(),/SUBSCRIPTION_REQUIRED/,'Credits never override a missed subscription');
}
for(const paid_through of [null,new Date(Date.now()-1).toISOString()]){membership={state:'active',paid_through};await assert.rejects(workAccount(),/SUBSCRIPTION_REQUIRED/);}
membership={state:'active',paid_through:future,cancel_at_period_end:true};assert.deepEqual(await workAccount(),{accountId:'owned-account',userId:'owner'},'A paid period remains accessible through its end');
membership.state='payment_failed';await assert.rejects(workAccount(),/SUBSCRIPTION_REQUIRED/);
membership.state='active';assert.equal((await workAccount()).accountId,'owned-account','Successful renewal restores access with saved credits');
await assert.rejects(workAccount({requireVip:true}),/VIP_REQUIRED/,'Standard access does not include the private AI assistant');
assert.equal((await workAccount()).accountId,'owned-account','Standard automation remains available');
membership.vip_until=future;assert.equal((await workAccount({requireVip:true})).accountId,'owned-account','Verified paid VIP can ask questions');
membership.vip_until=new Date(Date.now()-1000).toISOString();await assert.rejects(workAccount({requireVip:true}),/VIP_REQUIRED/,'Expired VIP is rejected even while Standard remains paid');
account.isBillingOwner=true;await assert.rejects(workAccount({requireVip:true}),/VIP_REQUIRED/,'A client admin flag alone does not grant entitlement');
preview=true;assert.equal((await workAccount({requireVip:true})).accountId,'owned-account','Server-authorized preview grants feature access');membership.state='payment_failed';await assert.rejects(workAccount({requireVip:true}),/SUBSCRIPTION_REQUIRED/,'Preview never bypasses paid workspace access');membership.state='active';preview=false;
account.billing_model='legacy';membership=null;assert.equal((await workAccount()).accountId,'owned-account');await assert.rejects(workAccount({requireVip:true}),/VIP_REQUIRED/,'Legacy accounts need verified VIP too');
for(const field of ['workspace_ack_version','workspace_ack_user_id','workspace_ack_hash']){const saved=account[field];account[field]='wrong';await assert.rejects(workAccount(),/WORKSPACE_ACKNOWLEDGMENT_REQUIRED/);assert.equal((await workAccount({allowInactiveMembership:true,allowUnacknowledged:true})).accountId,'owned-account');account[field]=saved;}
user=null;await assert.rejects(workAccount(),/SIGN_IN_REQUIRED/);
console.log('PASS subscription access: failed/expired membership blocks even funded accounts, paid access restores, no wallet mutations.');
