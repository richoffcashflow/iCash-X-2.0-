import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
let enabled=true,ready=true,claimed=false,charged=0,settled=0,createCalls=0,confirmCalls=0,lostResponse=false,fail=false,cancelBeforeConfirm=false;
const attempt={id:'00000000-0000-4000-8000-000000000001',account_id:'account',order_id:'order',approved_order:'approval',amount_cents:2500,mode:'live',stripe_customer_id:'cus_fixture',stripe_payment_method_id:'pm_fixture',stripe_payment_id:null,created_at:new Date().toISOString(),state:'pending'};
let pi=null;
const stripe={paymentIntents:{
 create:async(body,options)=>{createCalls++;assert.equal(body.confirm,undefined,'Create cannot charge before durable PI save');assert.match(options.idempotencyKey,/icash-auto-create:/);pi??={...body,id:'pi_fixture',livemode:true,status:'requires_confirmation',amount_received:0};return pi;},
 retrieve:async()=>pi,
 confirm:async(id,body,options)=>{confirmCalls++;assert.equal(attempt.stripe_payment_id,id);assert.equal(body.off_session,true);assert.match(options.idempotencyKey,/icash-auto-confirm:/);if(fail){pi={...pi,status:'requires_action'};throw Error('Bank verification');}charged++;pi={...pi,status:'succeeded',amount_received:2500};if(lostResponse){lostResponse=false;throw Error('Response lost');}return pi;},
 cancel:async()=>{pi={...pi,status:'canceled'};return pi;}
}};
const db=async(path,method,body)=>{
 if(path==='rpc/icash_due_auto_recharges')return [{account_id:'account'}];
 if(path==='rpc/icash_claim_auto_recharge'){if(claimed||attempt.state!=='pending')return null;claimed=true;return {...attempt};}
 if(path==='rpc/icash_auto_recharge_allowed')return enabled;
 if(path.startsWith('icash_auto_recharge_attempts?')){if(method==='PATCH'){Object.assign(attempt,body);if(body.stripe_payment_id&&cancelBeforeConfirm)enabled=false;return [];}return [{...attempt}];}
 if(path==='rpc/icash_settle_auto_recharge'){assert.equal(body.p_amount,2500);attempt.state='paid';settled++;return;}
 if(path.startsWith('icash_funding_orders?'))return [];
 if(path.startsWith('icash_auto_recharges?')){enabled=false;return [];}
 throw Error('Unexpected DB '+path);
};
const modules={'@/lib/stripe-test':{db},'@/lib/funding':{fundingStripe:()=>stripe},'@/lib/funding-policy':{fundingMode:()=> 'live'},'@/lib/launch-readiness':{customerFundingReady:async()=>ready}};
const code=ts.transpileModule(readFileSync(new URL('../lib/auto-recharge.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,mod={exports:{}};new Function('require','module','exports',code)(name=>{assert(modules[name],name);return modules[name];},mod,mod.exports);
const {reconcileAutoRecharge,settleAutoRecharge}=mod.exports;
const reset=()=>{enabled=true;ready=true;claimed=false;attempt.state='pending';attempt.stripe_payment_id=null;attempt.created_at=new Date().toISOString();pi=null;createCalls=0;confirmCalls=0;charged=0;settled=0;fail=false;lostResponse=false;cancelBeforeConfirm=false;};
reset();enabled=false;await reconcileAutoRecharge(Date.now()+10000);assert.equal(createCalls,0);assert.equal(charged,0);
reset();ready=false;await reconcileAutoRecharge(Date.now()+10000);assert.equal(createCalls,0);
reset();cancelBeforeConfirm=true;await reconcileAutoRecharge(Date.now()+10000);assert.equal(createCalls,1);assert.equal(confirmCalls,0);assert.equal(pi.status,'canceled');
reset();lostResponse=true;await reconcileAutoRecharge(Date.now()+10000);assert.equal(charged,1);assert.equal(settled,1);claimed=false;await reconcileAutoRecharge(Date.now()+10000);assert.equal(charged,1,'Retry cannot create second charge');
for(const patch of [{amount:1000},{amount_received:1000},{customer:'cus_other'},{payment_method:'pm_other'},{livemode:false},{currency:'eur'},{metadata:{...pi.metadata,icash_funding_order:'other'}}])await assert.rejects(settleAutoRecharge({...pi,...patch}));
reset();fail=true;await reconcileAutoRecharge(Date.now()+10000);assert.equal(charged,0);assert.equal(settled,0);assert.equal(enabled,false);assert.equal(attempt.state,'failed');
reset();attempt.created_at=new Date(Date.now()-25*3600000).toISOString();await reconcileAutoRecharge(Date.now()+10000);assert.equal(createCalls,0,'Unknown create is never replayed after idempotency expiry');
console.log('PASS recharge worker: no charge without current authorization/readiness; cancellation between create/confirm; lost response recovery; exact amount, mode, owner and method matching; authentication-required stop; no stale replay.');
