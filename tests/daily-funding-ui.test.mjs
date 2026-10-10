import * as finalSale from '../lib/final-sale-policy.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as budget from '../lib/daily-budget.ts';
import * as consent from '../lib/daily-consent.ts';
import * as early from '../lib/funding-consent.ts';
const require=createRequire(import.meta.url);
const all=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(all):[n,...all(n.props?.children)];
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):'';
const funding={mode:'live',earlyAccess:true,packs:[{code:'budget_ten',price_cents:1000,credit_cents:1000,enabled:true},{code:'budget_25',price_cents:2500,credit_cents:2500,enabled:true}]};
let states,refs,si,ri;
function render({ready=true,active=false,code='budget_ten',accepted=true}={}){
 states=[funding,{ready,plan:active?{state:'active',budgetCents:1000}:null},code,false,'','',false,accepted];refs=[];si=ri=0;
 const hooks={useEffect(){},useId:()=> 'budget',useRef:v=>refs[ri++]??={current:v},useState:()=>{const i=si++;return [states[i],v=>{states[i]=v;}];}};
 const mod={exports:{}};
 const compiled=ts.transpileModule(readFileSync(new URL('../components/daily-funding-checkout.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',compiled)(name=>name==='@/lib/final-sale-policy'?finalSale:name==='react'?hooks:name==='@/lib/daily-budget'?budget:name==='@/lib/daily-consent'?consent:name==='@/lib/funding-consent'?early:name==='./account-access'?{}:require(name),mod,mod.exports);
 return mod.exports.DailyFundingCheckout({onSignedIn(){}});
}
let posts=[];const oldFetch=globalThis.fetch,oldWindow=globalThis.window;
globalThis.window={location:{search:''}};
let release;globalThis.fetch=async(url,options)=>{
 if(options?.method==='POST'){posts.push(JSON.parse(options.body));await new Promise(r=>{release=r;});return {ok:true,json:async()=>({saved:true,message:'Saved'})};}
 return {ok:true,json:async()=>url.includes('billing')?{ready:true,plan:null}:funding};
};
try{
 for(const [active,code,amount] of [[false,'budget_ten',1000],[true,'budget_25',2500]]){
  let tree=render({active,code}),nodes=all(tree),button=nodes.find(n=>n.props?.className==='setup-primary daily-checkout-button');
  assert.equal(nodes.find(n=>n.props?.type==='checkbox').props.checked,true);
  assert.match(text(tree),/every 24 hours until you stop/);assert.match(text(tree),/Daily billing continues while work is waiting/);
  assert.equal(button.props.disabled,false);assert.match(text(button),new RegExp(`${active?'Save':'Run bot ·'} \\$${amount/100}/day`));
  assert.equal(posts.length,active?1:0,'rendering never submits billing consent');
  button.props.onClick();button.props.onClick();assert.equal(posts.length,active?2:1,'double clicks submit once');
  assert.deepEqual(posts.at(-1),{action:active?'change':'start',packCode:code,totalCents:amount,accepted:true,version:consent.dailyConsentVersion,earlyAccessAccepted:true,earlyAccessVersion:early.earlyAccessTermsVersion});
  release();await new Promise(r=>setTimeout(r,0));
 }
 const unaccepted=all(render({accepted:false})).find(n=>n.props?.className==='setup-primary daily-checkout-button');assert.equal(unaccepted.props.disabled,true);unaccepted.props.onClick();assert.equal(posts.length,2);
 const unavailable=all(render({ready:false})).find(n=>n.props?.className==='setup-primary daily-checkout-button');assert.equal(unavailable.props.disabled,true);
 unavailable.props.onClick();assert.equal(posts.length,2,'readiness blocks billing even when a handler is called directly');
}finally{globalThis.fetch=oldFetch;globalThis.window=oldWindow;}
console.log('Daily budget UI: explicit price and renewal, click-only consent, exact selected quote, duplicate guard and readiness hold passed.');
