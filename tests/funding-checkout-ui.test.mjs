import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as fundingConsent from '../lib/funding-consent.ts';
import * as dailyConsent from '../lib/daily-consent.ts';
const processingFeeCents=()=>0; // Fixture fee; no payment/provider calls.
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../components/funding-checkout.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function elements(root){return !root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(elements):[root,...elements(root.props?.children)];}
function text(root){return typeof root==='string'?root:Array.isArray(root)?root.map(text).join(' '):root&&typeof root==='object'?text(root.props?.children):'';}
function find(root,p){const item=elements(root).find(p);assert.ok(item,'expected control');return item;}
let slots=[],cursor=0,dirty=true,pending=[],tree,calls=[];
let funding={earlyAccess:true,mode:'live',enabled:true,paidCents:1,packs:[{code:'budget_ten',price_cents:1000,credit_cents:1000,enabled:true},{code:'budget_25',price_cents:2500,credit_cents:2500,enabled:true}]};
let daily={ready:true,plan:null};
globalThis.window={location:{search:'',assign(){throw Error('No live checkout permitted in this test');}}};globalThis.document={hidden:false};
globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(options.method==='POST')return Response.json(url==='/api/setup/event'?{ok:true}:{saved:true,message:'Fixture save only'});return Response.json(url==='/api/billing/daily'?daily:funding);};
const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous.deps[index]))){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
const mod={exports:{}};new Function('require','module','exports',code)(name=>name==='react'?hooks:name==='@/lib/funding-consent'?fundingConsent:name==='@/lib/daily-consent'?dailyConsent:name==='@/lib/funding-fees'?{processingFeeCents}:name==='@/components/account-access'?{AccountAccess:'AccountAccess'}:require(name),mod,mod.exports);
function render(){cursor=0;dirty=false;tree=mod.exports.FundingCheckout({onSignedIn(){}});return tree;}
async function flush(){for(let i=0;i<15;i++){if(dirty)render();const tasks=pending;pending=[];tasks.forEach(fn=>fn());await new Promise(resolve=>setTimeout(resolve,2));if(!dirty&&!pending.length)return tree;}throw Error('Render did not settle');}
function checkbox(){return find(tree,n=>n.type==='input'&&n.props.type==='checkbox');}
function checkout(){return find(tree,n=>n.type==='button'&&n.props.className==='fund-button full'&&text(n).includes('/day'));}
render();tree=await flush();assert.equal(elements(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox').length,1);assert.equal(checkbox().props.checked,false);assert.equal(checkout().props.disabled,true);
assert.match(text(tree),/I authorize \$\s*10.00\s*\/day/);assert.match(text(tree),/including continued charges while outreach is unavailable/);assert.match(text(tree),/Outreach isn’t active yet/);assert.ok(find(tree,n=>n.type==='details'&&text(n).includes(fundingConsent.earlyAccessDailyDisclosure)));assert.equal(checkbox().props['aria-describedby'],'funding-summary');
checkbox().props.onChange({target:{checked:true}});tree=await flush();assert.equal(checkout().props.disabled,false);
find(tree,n=>n.type==='input'&&n.props.type==='range').props.onChange({target:{value:'1'}});tree=render();assert.equal(checkbox().props.checked,false,'amount change invalidates before effects');tree=await flush();assert.equal(checkout().props.disabled,true);assert.match(text(tree),/I authorize \$\s*25.00\s*\/day/);
checkbox().props.onChange({target:{checked:true}});tree=await flush();const submit=checkout();submit.props.onClick();submit.props.onClick();tree=await flush();const posts=calls.filter(call=>call.url==='/api/billing/daily'&&call.options.method==='POST');assert.equal(posts.length,1);const payload=JSON.parse(posts[0].options.body);assert.equal(payload.accepted,true);assert.equal(payload.earlyAccessAccepted,true);assert.equal(payload.totalCents,2500);assert.equal(payload.version,dailyConsent.dailyConsentVersion);assert.equal(payload.earlyAccessVersion,fundingConsent.earlyAccessTermsVersion);assert.equal(checkbox().props.checked,false,'saved action does not leave consent selected');
checkbox().props.onChange({target:{checked:true}});tree=await flush();funding={...funding,earlyAccess:false};find(tree,n=>n.type==='button'&&text(n)==='Refresh payment status').props.onClick();tree=await flush();assert.equal(checkbox().props.checked,false,'eligibility/disclosure change clears consent');assert.doesNotMatch(text(tree),/Outreach isn’t active yet/);
checkbox().props.onChange({target:{checked:true}});tree=await flush();daily={ready:false,plan:null};find(tree,n=>n.type==='button'&&text(n)==='Refresh payment status').props.onClick();tree=await flush();assert.equal(checkbox().props.checked,false);assert.equal(checkbox().props.disabled,true);assert.equal(checkout().props.disabled,true,'readiness false cannot checkout');
daily={ready:true,plan:{state:'active',budgetCents:1000,packCode:'budget_ten'}};find(tree,n=>n.type==='button'&&text(n)==='Refresh payment status').props.onClick();tree=await flush();
assert.equal(elements(tree).filter(n=>n.type==='input'&&n.props.type==='checkbox').length,0,'active available plans use explicit amount confirmation');
assert.match(text(checkout()),/Confirm daily budget/);assert.match(text(tree),/next.*renewal/i);assert.equal(checkout().props.disabled,false);
find(tree,n=>n.type==='input'&&n.props.type==='range').props.onChange({target:{value:'1'}});tree=await flush();checkout().props.onClick();tree=await flush();
const repeat=JSON.parse(calls.filter(call=>call.url==='/api/billing/daily'&&call.options.method==='POST').at(-1).options.body);assert.equal(repeat.action,'change');assert.equal(repeat.accepted,true);assert.equal(repeat.totalCents,2500);assert.equal(repeat.earlyAccessAccepted,false);
slots.forEach(slot=>slot?.cleanup?.());console.log('Checkout component handlers passed: one unchecked daily checkbox, exact amount/availability, full audited text, price/state resets, unchanged dual flags/versions and duplicate guard.');
