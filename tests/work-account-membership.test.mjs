import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {membershipAccessible} from '../lib/membership-policy.ts';
let user={id:'owner'},account={id:'owned-account',billing_model:'membership_credits'},membership,calls=[];
const deps={membershipAccessible,currentUser:async()=>user,accountMembership:async id=>{assert.equal(id,account.id);return membership;},db:async(path,method)=>{calls.push({path,method});assert.equal(method,undefined,'Access checks never charge or alter credits');assert(path.includes('owner_user_id=eq.owner'));return account?[account]:[];}};
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
user=null;await assert.rejects(workAccount(),/SIGN_IN_REQUIRED/);
console.log('PASS subscription access: failed/expired membership blocks even funded accounts, paid access restores, no wallet mutations.');
