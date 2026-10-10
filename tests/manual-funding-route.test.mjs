import * as finalSale from '../lib/final-sale-policy.ts';
import * as embeddedPolicy from '../lib/embedded-checkout-policy.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as recharge from '../lib/auto-recharge-policy.ts';
import * as amounts from '../lib/funding-amount.ts';
import * as policy from '../lib/membership-policy.ts';
import * as consent from '../lib/funding-consent.ts';
let user={id:'owner',email:'fixture@example.invalid'},active=true,orders=[],calls=[],sessions=new Map();
const stripe={checkout:{sessions:{create:async(body,options)=>{calls.push({create:body,options});const s={id:'cs_live_'+(sessions.size+1),status:'open',payment_status:'unpaid',livemode:true,url:body.ui_mode==='embedded_page'?null:'https://checkout.stripe.com/fixture',ui_mode:body.ui_mode??'hosted_page',client_secret:body.ui_mode==='embedded_page'?'cs_live_secret_fixture':null,metadata:body.metadata};sessions.set(s.id,s);return s;},retrieve:async id=>sessions.get(id),expire:async id=>{sessions.get(id).status='expired';}}}};
let acceptanceFails=false;
const deps={...finalSale,recordPurchaseAcceptance:async(_req,receipt)=>{if(acceptanceFails)throw Error('Receipt unavailable');calls.push({acceptance:receipt});},...embeddedPolicy,...recharge,...amounts,...policy,...consent,NextResponse:{json:(body,o={})=>({body,status:o.status??200})},allowedOrigin:()=>true,privatePaymentCheckAllowed:async()=>false,customerFundingReady:async()=>true,earlyAccessFundingEnabled:()=>false,fundingMode:()=> 'live',cookies:async()=>({get:()=>({value:'a'.repeat(64)})}),validGuest:()=>true,guestHash:()=> 'hash',limitRequest:async()=>{},currentUser:async()=>user,accountMembership:async()=>({mode:'live',account_id:'account',stripe_customer_id:'cus_owned'}),fundingStripe:()=>stripe,processingFeeCents:()=>0,maximumFundingDays:()=>7,settleFunding:async()=>{throw Error('Unexpected payment');},db:async(path,method,body)=>{
 calls.push({path,method,body});
 if(path.startsWith('icash_accounts'))return [{id:'account'}];
 if(path.startsWith('icash_daily_plans'))return [];
 if(path==='rpc/icash_membership_work_allowed')return active;
 if(path.startsWith('icash_credit_packs')){const code=new URLSearchParams(path.split('?')[1]).get('code').slice(3);return [{code,price_cents:code==='budget_25'?2500:1000,credit_cents:code==='budget_25'?2500:1000}];}
 if(path==='icash_funding_orders'&&method==='POST'){const row={id:'order'+(orders.length+1),state:'pending',...body};orders.push(row);return [row];}
 if(path.startsWith('icash_funding_orders?')){if(method==='PATCH'){const id=new URLSearchParams(path.split('?')[1]).get('id').slice(3);Object.assign(orders.find(o=>o.id===id),body);return [];}return orders.filter(o=>o.state==='pending').slice(-1);}
 if(path==='rpc/icash_prepare_auto_recharge')return true;
 if(path==='rpc/icash_record_funding_consent')return true;
 throw Error('Unexpected database operation '+path);
}};
globalThis.__manualFunding=deps;
const source=ts.transpileModule(readFileSync(new URL('../app/api/funding/checkout/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__manualFunding;\n'+source).toString('base64'));
const purchase={accepted:true,version:policy.workCreditTermsVersion,packCode:'budget_ten',days:1,totalCents:1000};
const request=body=>new Request('https://www.geticashx.com/api/funding/checkout',{method:'POST',headers:{origin:'https://www.geticashx.com'},body:JSON.stringify(body)});
const custom=cents=>({...purchase,packCode:amounts.customFundingCode,customAmountCents:cents,totalCents:cents});
for(const cents of [999,100001,1000.1,Infinity,-1000,'1000',null]){assert.equal((await POST(request(custom(cents)))).status,400);}
assert.equal((await POST(request({...purchase,totalCents:1}))).status,400);
assert.equal((await POST(request({...purchase,customAmountCents:1000}))).status,400);
assert.equal(calls.filter(c=>c.create).length,0);
user=null;assert.equal((await POST(request(custom(3742)))).status,401);user={id:'owner'};
active=false;assert.equal((await POST(request(custom(3742)))).status,409);active=true;
assert.equal(calls.filter(c=>c.create).length,0,'Unpaid membership cannot recharge');
assert.equal((await POST(request(custom(3742)))).status,200);
assert.equal(orders[0].price_cents,3742);assert.equal(orders[0].credit_cents,3742);assert.equal(orders[0].account_id,'account');
const created=calls.find(c=>c.create);assert.equal(created.create.mode,'payment');assert.equal(created.create.customer,'cus_owned');assert.equal(created.create.line_items[0].price_data.unit_amount,3742);assert.equal(created.create.line_items[0].price_data.recurring,undefined);assert.equal(created.create.payment_intent_data?.setup_future_usage,undefined);assert.equal(created.create.metadata.icash_prepaid_work,'true');assert(created.options.idempotencyKey);assert.equal(created.create.subscription_data,undefined);
assert.equal((await POST(request(custom(3742)))).status,200);assert.equal(calls.filter(c=>c.create).length,1,'Repeated request reuses its open checkout');
assert.equal((await POST(request({...purchase,packCode:'budget_25',totalCents:2500}))).status,200);assert.equal(orders[0].state,'expired');assert.equal(orders[1].credit_cents,2500);
assert.equal(calls.some(c=>/post_credit|apply_prepaid|settle_funding/.test(c.path??'')),false,'Opening checkout never grants credits or starts work');
for(const [value,expected] of [['37.42',3742],['10',1000],['1000',100000],['9.99',null],['1e2',null],['50.999',null]])assert.equal(amounts.fundingAmountCents(value),expected);
console.log('PASS manual funding: exact custom cents, bounds, tamper protection, subscription gate, one-time payment, checkout reuse and no credit before payment.');

assert.equal((await POST(request({...purchase,autoRecharge:true}))).status,400);
assert.equal((await POST(request({...purchase,autoRecharge:'true',autoRechargeVersion:recharge.autoRechargeVersion}))).status,400);
const automatic={...purchase,autoRecharge:true,autoRechargeVersion:recharge.autoRechargeVersion};
assert.equal((await POST(request(automatic))).status,200);
const autoCreate=calls.filter(c=>c.create).at(-1).create;assert.equal(autoCreate.payment_intent_data.setup_future_usage,'off_session');assert.equal(autoCreate.metadata.icash_auto_recharge,'true');assert.match(autoCreate.custom_text.submit.message,/\$10.*below \$5.*24 hours/);
assert.equal((await POST(request(purchase))).status,200);assert.equal(calls.filter(c=>c.create).at(-1).create.payment_intent_data,undefined,'Changing to manual replaces auto checkout');
console.log('PASS auto recharge checkout: explicit versioned opt-in, exact amount/threshold, saved-card setup only on opt-in, manual replacement expires auto checkout.');

// The same one-time order supports inline Stripe and survives repeated opens.
process.env.STRIPE_PUBLISHABLE_KEY='pk_live_fixture';
const inline={...purchase,embedded:true};
let inlineResponse=await POST(request(inline));assert.equal(inlineResponse.status,200);assert.equal(inlineResponse.body.publishableKey,'pk_live_fixture');assert(inlineResponse.body.clientSecret);assert.equal(inlineResponse.body.url,undefined);
const inlineCreate=calls.filter(c=>c.create).at(-1).create;
assert.equal(inlineCreate.ui_mode,'embedded_page');assert.equal(inlineCreate.redirect_on_completion,'never');assert.equal(inlineCreate.success_url,undefined);assert.equal(inlineCreate.cancel_url,undefined);assert.equal(inlineCreate.customer,'cus_owned');
const count=calls.filter(c=>c.create).length;
assert.equal((await POST(request(inline))).body.sessionId,inlineResponse.body.sessionId);assert.equal(calls.filter(c=>c.create).length,count,'Reopening inline checkout reuses the owned session');
const last=sessions.get(inlineResponse.body.sessionId);last.status='complete';last.payment_status='unpaid';
assert.equal((await POST(request(inline))).status,409);assert.equal(calls.filter(c=>c.create).length,count,'An uncertain completed payment never creates another purchase');
last.status='expired';
process.env.STRIPE_PUBLISHABLE_KEY='pk_test_fixture';
const fallback=await POST(request(inline));assert.equal(fallback.status,200);assert.match(fallback.body.url,/checkout.stripe.com/);assert.equal(fallback.body.clientSecret,undefined,'Wrong-mode keys use hosted payment');
delete process.env.STRIPE_PUBLISHABLE_KEY;
console.log('PASS inline funding: exact amount, matching Stripe key, saved customer, no redirect, same-session retry, uncertain-payment hold, and hosted fallback.');

acceptanceFails=true;const before=calls.filter(c=>c.create).length;assert.equal((await POST(request(custom(4111)))).status,503);assert.equal(calls.filter(c=>c.create).length,before,'Failed evidence persistence prevents a new checkout');
