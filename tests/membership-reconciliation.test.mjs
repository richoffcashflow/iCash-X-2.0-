import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let rows,calls,failRead=false,failSettlement=false,mode='live',sub;
const reset=()=>{rows=[{id:'member_one',mode:'live',state:'active',stripe_subscription_id:'sub_one'}];calls=[];failRead=false;failSettlement=false;mode='live';sub={id:'sub_one',metadata:{icash_membership:'member_one'}};};
const db=async(path,method,body)=>{calls.push({path,method,body});if(method==='PATCH'){assert.deepEqual(Object.keys(body),['updated_at']);return [];}assert.match(path,/mode=eq.live/);assert.match(path,/state=in\.\(pending,active,payment_failed,needs_review\)/);assert.match(path,/order=updated_at.asc,id.asc&limit=10/);return rows;};
const stripe={subscriptions:{retrieve:async id=>{calls.push({retrieve:id});if(failRead)throw Error('Unavailable');return sub;}},invoices:{list:async input=>{calls.push({list:input});assert.deepEqual(input,{subscription:'sub_one',status:'paid',limit:1});return {data:[{id:'in_paid'}]};}}};
const modules={'@/lib/vip-membership':{reconcileVipChanges:async()=>{}},
 '@/lib/stripe-test':{db},'@/lib/funding':{fundingStripe:()=>stripe},'@/lib/funding-policy':{fundingMode:()=>mode},
 '@/lib/membership':{
  syncMembershipSubscription:async value=>{calls.push({sync:value.id});return true;},
  settleMembershipInvoice:async id=>{calls.push({settle:id});if(failSettlement)throw Error('Amount mismatch');return true;},
  reconcileMembershipCheckout:async m=>{calls.push({checkout:m.id});return {...m,stripe_subscription_id:'sub_one'};}
 }
};
const code=ts.transpileModule(readFileSync(new URL('../lib/membership-reconciliation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function('require','module','exports',code)(name=>{assert(modules[name],name);return modules[name];},mod,mod.exports);
const {reconcileMemberships}=mod.exports;
reset();assert.deepEqual(await reconcileMemberships(Date.now()+10000),{checked:1,failed:0,deferred:0});assert(calls.some(c=>c.settle==='in_paid'));assert(calls.some(c=>c.sync==='sub_one'));assert.equal(calls.filter(c=>c.method==='PATCH').length,1);
reset();rows[0].stripe_subscription_id=null;rows[0].stripe_session_id='cs_live_one';await reconcileMemberships(Date.now()+10000);assert(calls.some(c=>c.checkout==='member_one'));assert(calls.some(c=>c.settle==='in_paid'));
reset();failRead=true;assert.equal((await reconcileMemberships(Date.now()+10000)).failed,1);assert.equal(calls.filter(c=>c.method==='PATCH').length,1,'Failure rotates the cursor');assert(!calls.some(c=>c.settle));
reset();failSettlement=true;assert.equal((await reconcileMemberships(Date.now()+10000)).failed,1);assert.equal(calls.filter(c=>c.method==='PATCH').length,1);
reset();sub.metadata.icash_membership='other';assert.equal((await reconcileMemberships(Date.now()+10000)).failed,1);assert(!calls.some(c=>c.sync||c.list||c.settle),'Wrong membership cannot reach settlement');
reset();assert.deepEqual(await reconcileMemberships(Date.now()-1),{checked:0,failed:0,deferred:1});assert(!calls.some(c=>c.retrieve||c.method));
reset();mode=null;assert.deepEqual(await reconcileMemberships(Date.now()+10000),{checked:0,failed:0,deferred:0});assert.equal(calls.length,0);
const route=readFileSync(new URL('../app/api/billing/reconcile/route.ts',import.meta.url),'utf8');assert.match(route,/reconcileMemberships\(Math.min\(deadline,Date.now\(\)\+15_000\)\)/);assert.match(route,/memberships.failed/);
console.log('PASS membership webhook recovery: canonical paid invoice delegation, pending checkout recovery, binding rejection, bounded queue, failed-row rotation, no provider charge/update API, no stale state writes. Fake providers only.');
