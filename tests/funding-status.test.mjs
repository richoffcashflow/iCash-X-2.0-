import * as embeddedPolicy from '../lib/embedded-checkout-policy.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as fundingAmounts from '../lib/funding-amount.ts';
import {fundingReturnSummary} from '../lib/funding-return.ts';
// Exercise the route without network calls or charges.
let signedIn=true,guest=true,settled=false,paths=[],retrieved=0,planMatch=false,orderMatch=true;
const receipt={id:'order',state:'pending',credit_cents:300,stripe_session_id:'cs_live_current',credited_at:null,payer_email:'test@example.invalid'};
const mocks={creditRefillContext:async(id,mode,balance)=>{assert.equal(id,'account');return {amountCents:7500};},...embeddedPolicy,...fundingAmounts,
 currentUser:async()=>signedIn?{id:'owner'}:null,
 privatePaymentCheckAllowed:async()=>false,customerFundingReady:async()=>false,earlyAccessFundingEnabled:()=>false,
 NextResponse:{json:(body,options={})=>({body,status:options.status??200})},
 cookies:async()=>({get:()=>guest?{value:'a'.repeat(64)}:undefined}),
 guestHash:()=> 'cookiehash',fundingMode:()=> 'live',fundingEnabled:()=>false,
 validGuest:value=>!!value,
 fundingStripe:()=>({checkout:{sessions:{retrieve:async()=>{retrieved++;return {payment_status:'paid'};}}}}),
 settleFunding:async()=>{settled=true;},fundingReturnSummary,
 db:async(path)=>{paths.push(path);
  if(path.startsWith('icash_auto_recharges'))return [];
  if(path.startsWith('icash_credit_packs'))return [];
  if(path.startsWith('icash_wallets')){assert(path.includes('account_id=eq.account'));return [{balance_cents:0,reserved_cents:0}];}
  if(path.startsWith('icash_funding_orders')&&path.includes('select=credit_cents')){assert(path.includes('account_id=eq.account')&&path.includes('mode=eq.live'));return [];}
  if(path.startsWith('icash_planning_estimates'))return [{}];
  if(path.startsWith('icash_accounts'))return [{id:'account'}];
  if(path.startsWith('icash_daily_plans'))return planMatch?[{id:'daily-plan'}]:[];
  if(path.startsWith('icash_funding_orders'))return orderMatch?[{...receipt,...(settled?{state:'paid',credited_at:'now'}:{})}]:[];
  throw Error('Unexpected query');
 }
};
globalThis.__fundingStatus=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/funding/status/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
source=source.replace(/^import .* from .*;$/gm,'');
source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__fundingStatus;\n'+source;
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const request=id=>new Request('https://www.geticashx.com/api/funding/status?session_id='+encodeURIComponent(id));
let response=await GET(request('cs_live_current'));
assert.equal(response.body.recommendedCents,7500);assert.equal(response.body.paidCents,300);assert.equal(response.body.needsClaim,false);
assert.equal(paths.filter(p=>p.startsWith('icash_funding_orders')&&!p.includes('select=credit_cents')).length,2,'read settlement state again');
assert(paths.filter(p=>p.startsWith('icash_funding_orders')&&!p.includes('select=credit_cents')).every(p=>p.includes('account_id=eq.account')&&p.includes('stripe_session_id=eq.cs_live_current')));
paths=[];orderMatch=false;retrieved=0;
response=await GET(request('cs_live_someoneelse'));
assert.equal(response.body.paidCents,0);assert.equal(retrieved,0,'never retrieve unowned sessions');
paths=[];planMatch=true;orderMatch=true;
response=await GET(request('cs_live_daily'));
assert(paths.some(p=>p.includes('daily_plan_id=eq.daily-plan')&&p.includes('account_id=eq.account')));
signedIn=false;paths=[];
response=await GET(request('cs_live_daily'));
assert.equal(response.body.needsClaim,true);assert(paths.some(p=>p.includes('guest_hash=eq.cookiehash')));
guest=false;retrieved=0;paths=[];
response=await GET(request('cs_live_daily'));
assert.equal(response.body.paidCents,0);assert.equal(retrieved,0);assert(!paths.some(p=>p.startsWith('icash_funding_orders')));
response=await GET(request('cs_live_x&account_id=eq.other'));
assert.equal(response.status,400);
delete globalThis.__fundingStatus;
console.log('Funding route: exact session, tenant isolation, guest verification, daily receipts, and settlement re-read passed.');
