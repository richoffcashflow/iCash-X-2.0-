import * as refill from '../lib/credit-refill-recommendation.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as fundingAmounts from '../lib/funding-amount.ts';
import * as fundingConsent from '../lib/funding-consent.ts';
import * as recharge from '../lib/auto-recharge-policy.ts';
import * as membership from '../lib/membership-policy.ts';
const processingFeeCents=()=>0; // Fixture fee; no payment/provider calls.
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../components/funding-checkout.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function elements(root){return !root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(elements):[root,...elements(root.props?.children)];}
function text(root){return typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';}
function find(root,p){const item=elements(root).find(p);assert.ok(item,'expected control');return item;}
let slots=[],cursor=0,dirty=true,pending=[],tree,calls=[];
let funding={earlyAccess:true,mode:'live',enabled:true,custom:{enabled:true,minCents:1000,maxCents:100000},paidCents:1,packs:[{code:'budget_ten',price_cents:1000,credit_cents:1000,enabled:true},{code:'budget_25',price_cents:2500,credit_cents:2500,enabled:true}]};
let daily={ready:true,plan:null};
globalThis.window={location:{search:'',assign(url){calls.push({redirect:url});}}};globalThis.document={hidden:false};
globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(options.method==='POST')return Response.json(url==='/api/setup/event'?{ok:true}:{url:'https://checkout.stripe.com/fixture'});return Response.json(url==='/api/billing/daily'?daily:funding);};
const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
const mod={exports:{}};new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='@/lib/credit-refill-recommendation'?refill:name==='@/lib/funding-amount'?fundingAmounts:name==='@/lib/funding-consent'?fundingConsent:name==='@/lib/membership-policy'?membership:name==='@/lib/auto-recharge-policy'?recharge:name==='@/lib/funding-fees'?{processingFeeCents}:name==='./stripe-embedded-checkout'?{StripeEmbeddedCheckout:'StripeEmbeddedCheckout'}:name==='./account-access'?{AccountAccess:'AccountAccess'}:require(name),mod,mod.exports);
function render(){cursor=0;dirty=false;tree=mod.exports.FundingCheckout({onSignedIn(){}});return tree;}
async function flush(){for(let i=0;i<15;i++){if(dirty)render();const tasks=pending;pending=[];tasks.forEach(fn=>fn());await new Promise(resolve=>setTimeout(resolve,2));if(!dirty&&!pending.length)return tree;}throw Error('Render did not settle');}
function checkout(){return find(tree,n=>n.type==='button'&&n.props.className==='fund-button full');}
render();tree=await flush();assert.equal(checkout().props.disabled,false);assert.match(text(tree),/One-time purchase/);assert.match(text(tree),/One-time payment/);assert.match(text(tree),/Your bot starts eligible work after payment/);assert.equal(calls.filter(c=>c.options?.method==='POST').length,0,'Reading never purchases');
find(tree,n=>n.type==='button'&&text(n).trim()==='$25').props.onClick();tree=await flush();assert.match(text(checkout()),/25/);
const submit=checkout();submit.props.onClick();submit.props.onClick();tree=await flush();const posts=calls.filter(c=>c.url==='/api/funding/checkout'&&c.options.method==='POST');assert.equal(posts.length,1);const payload=JSON.parse(posts[0].options.body);assert.equal(payload.totalCents,2500);assert.equal(payload.days,1);assert.equal(payload.version,membership.workCreditTermsVersion);assert.equal(payload.accepted,true);assert.equal(payload.earlyAccessAccepted,true);assert.equal(calls.filter(c=>c.redirect).length,1);assert.equal(calls.some(c=>c.url==='/api/billing/daily'),false);
// Higher presets use the existing exact custom-amount checkout, never a silent charge.
for(const dollars of [50,100,250]){const count=calls.filter(c=>c.options?.method==='POST').length;find(tree,n=>n.type==='button'&&text(n).trim()==='$'+dollars).props.onClick();tree=await flush();assert.match(text(checkout()),new RegExp(String(dollars)));assert.equal(calls.filter(c=>c.options?.method==='POST').length,count);}
// Custom amounts remain manual, use exact cents, and cannot be submitted below the minimum.
find(tree,n=>n.type==='button'&&text(n).trim()==='Custom').props.onClick();tree=await flush();assert.equal(checkout().props.disabled,true);
const input=()=>find(tree,n=>n.type==='input'&&n.props.id==='custom-credit-amount');
for(const value of ['9.99','1000.01','12.345','-10','1e2']){input().props.onChange({target:{value}});tree=await flush();assert.equal(checkout().props.disabled,true);}
input().props.onChange({target:{value:'37.42'}});tree=await flush();assert.equal(checkout().props.disabled,false);assert.match(text(checkout()),/37.42/);
assert.equal(calls.filter(c=>c.options?.method==='POST').length,1,'Choosing amounts never purchases');
checkout().props.onClick();tree=await flush();const customPost=calls.filter(c=>c.url==='/api/funding/checkout').at(-1);const customPayload=JSON.parse(customPost.options.body);assert.equal(customPayload.packCode,fundingAmounts.customFundingCode);assert.equal(customPayload.customAmountCents,3742);assert.equal(customPayload.totalCents,3742);
// Explicit opt-in is required; selecting it does not charge or save a payment method.
funding={...funding,earlyAccess:false};slots=[];dirty=true;tree=await flush();
let box=find(tree,n=>n.type==='input'&&n.props.type==='checkbox');assert.equal(box.props.checked,false);
const beforeOptIn=calls.filter(c=>c.options?.method==='POST').length;box.props.onChange({target:{checked:true}});tree=await flush();assert.equal(calls.filter(c=>c.options?.method==='POST').length,beforeOptIn);assert.match(text(tree),/Automatically add \$10.*below \$5.*24 hours/);
checkout().props.onClick();tree=await flush();const autoPayload=JSON.parse(calls.filter(c=>c.url==='/api/funding/checkout').at(-1).options.body);assert.equal(autoPayload.autoRecharge,true);assert.equal(autoPayload.autoRechargeVersion,recharge.autoRechargeVersion);
// An uncertain network result surfaces an error and never retries a payment by itself.
globalThis.fetch=async(url,options={})=>{calls.push({url,options});throw Error('Synthetic connection loss');};checkout().props.onClick();tree=await flush();assert.match(text(tree),/Synthetic connection loss/);assert.equal(calls.filter(c=>c.url==='/api/funding/checkout'&&c.options.method==='POST').length,4);
// Inline completion waits for the newly selected session, never historical receipts.
slots.forEach(slot=>slot?.cleanup?.());slots=[];pending=[];dirty=true;
let paid=false,completed=0;
window.location={search:'',href:'https://www.geticashx.com/#funding',assign(){throw Error('Inline payment must stay here');}};
window.history={replaceState(_a,_b,path){window.location.href='https://www.geticashx.com'+path;window.location.search=new URL(window.location.href).search;}};
funding={...funding,embeddedReady:true,paidCents:10000};
globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(options.method==='POST')return Response.json({clientSecret:'cs_live_inline_secret_fixture',publishableKey:'pk_live_fixture',sessionId:'cs_live_inline'});return Response.json({...funding,paidCents:url.includes('session_id=cs_live_inline')?(paid?2500:0):10000});};
render=()=>{cursor=0;dirty=false;tree=mod.exports.FundingCheckout({initialAmountCents:7500,reason:'Add $75 in credits for eligible research.',onSignedIn(){completed++;}});return tree;};
tree=await flush();assert.match(text(checkout()),/75/);assert.match(text(tree),/Add \$75 in credits/);find(tree,n=>n.type==='button'&&text(n).trim()==='$50').props.onClick();tree=await flush();assert.match(text(tree),/Add \$50 in credits/);assert.doesNotMatch(text(tree),/Add \$75 in credits/);checkout().props.onClick();tree=await flush();
const inline=find(tree,n=>n.type==='StripeEmbeddedCheckout');assert.equal(completed,0);
inline.props.onComplete();tree=await flush();assert.match(text(tree),/Confirming your credits/);assert.equal(completed,0,'Historical funding cannot confirm the new session');
paid=true;find(tree,n=>n.type==='button'&&text(n)==='Check payment').props.onClick();tree=await flush();assert.equal(completed,1);assert.equal(window.location.search,'');
slots.forEach(slot=>slot?.cleanup?.());console.log('PASS prepaid checkout handlers: no automatic payment, exact chosen amount/terms, one-time request, duplicate lock, permitted Stripe URL, and uncertain result surfaced.');
