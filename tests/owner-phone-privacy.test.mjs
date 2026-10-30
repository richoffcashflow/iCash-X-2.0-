import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {privatePhoneDisplay} from '../lib/private-phone-display.ts';
import {sellerSubmissionStatus} from '../lib/seller-submission-status.ts';
import {botDemoConsentText,botDemoConsentVersion} from '../lib/bot-demo.ts';
import {optinCallNowText,optinCallNowVersion} from '../lib/optin-call-now.ts';

const require=createRequire(import.meta.url),phone='+12142155500',other='+12142155501';
function load(path,mocks={}){
 const mod={exports:{}};
 const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),mod,mod.exports);
 return mod.exports;
}
for(const value of [phone,'2142155500','1 (214) 215-5500','(214) 215-5500','214.215.5500'])assert.equal(privatePhoneDisplay(value,phone),'21421****');
for(const value of [other,'21421','21421****','Not available'])assert.equal(privatePhoneDisplay(value,phone),value);
assert.equal(privatePhoneDisplay(phone),phone,'No owner scope means no masking');
const privacy=load('components/owner-phone-privacy.tsx',{'@/lib/private-phone-display':{privatePhoneDisplay}});
const child=React.createElement(privacy.PrivatePhone,null,phone);
const render=value=>renderToStaticMarkup(React.createElement(privacy.OwnerPhonePrivacy,{phone:value},child));
assert.equal(render(phone),'21421****');assert.equal(render(null),phone);
assert.equal(renderToStaticMarkup(React.createElement(privacy.OwnerPhonePrivacy,{phone},React.createElement(privacy.OwnerPhonePrivacy,{phone:null},child))),phone,'A different account scope cannot inherit owner masking');

const {BrowserCallControls}=load('components/browser-call-controls.tsx',{'@/components/owner-phone-privacy':privacy,'@/lib/browser-call-session':{}});
const call=React.createElement(BrowserCallControls,{screeningId:'fixture',contacts:[{phone,name:'Owner',available:true}],onFinished(){}});
const ownCall=renderToStaticMarkup(React.createElement(privacy.OwnerPhonePrivacy,{phone},call));
assert.match(ownCall,/21421\*\*\*\*/);assert.doesNotMatch(ownCall,/215-5500|2142155500/);
assert.match(renderToStaticMarkup(call),/\(214\) 215-5500/,'Customer call controls retain the original phone display');

const {DemoPhoneField}=load('components/demo-phone-field.tsx',{'@/lib/private-phone-display':{privatePhoneDisplay}});
let html=renderToStaticMarkup(React.createElement(DemoPhoneField,{value:phone,privatePhone:phone,disabled:false,onChange(){}}));
assert.match(html,/value="21421\*\*\*\*"/);assert.match(html,/readOnly/);assert.doesNotMatch(html,/2142155500|12142155500/);
html=renderToStaticMarkup(React.createElement(DemoPhoneField,{value:other,privatePhone:phone,disabled:false,onChange(){}}));
assert.match(html,/type="password"/,'Editing a number stays visually concealed');
html=renderToStaticMarkup(React.createElement(DemoPhoneField,{value:other,disabled:false,onChange(){}}));
assert.match(html,/type="tel"/,'Ordinary forms retain their normal input');

// Exercise the real form's account load, address step and submission without
// contacting any provider. The display value must never become the recipient.
let cells=[],cursor=0,effects=[],tree,requests=[];
const hooks={useState(value){const i=cursor++;if(!(i in cells))cells[i]=value;return[cells[i],next=>{cells[i]=typeof next==='function'?next(cells[i]):next;}];},useRef(value){const i=cursor++;return cells[i]??={current:value};},useEffect(fn){const i=cursor++;if(!(i in cells)){cells[i]=true;effects.push(fn);}}};
const form=load('components/bot-demo.tsx',{
 react:hooks,'@/components/seller-address-input':{SellerAddressInput:'AddressInput'},
 '@/lib/bot-demo':{botDemoConsentText,botDemoConsentVersion},'@/lib/optin-call-now':{optinCallNowText,optinCallNowVersion},
 '@/lib/seller-submission-status':{sellerSubmissionStatus},'./demo-phone-field':{DemoPhoneField:'DemoPhoneField'},
});
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const renderForm=()=>{cursor=0;tree=form.BotDemo();return nodes(tree);};
const saved={fetch:globalThis.fetch,requestAnimationFrame:globalThis.requestAnimationFrame};
try{
 globalThis.requestAnimationFrame=()=>0;
 globalThis.fetch=async(url,options)=>{if(options?.method==='POST'){requests.push(JSON.parse(options.body));return Response.json({received:true});}return Response.json({ready:true,privateDemoPhone:phone});};
 renderForm();const initial=effects;effects=[];initial.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));
 let ns=renderForm();ns.find(n=>n.type==='AddressInput').props.onChange('123 Fixture Street, Dallas, TX 75210');
 ns=renderForm();ns.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 ns=renderForm();assert.equal(ns.find(n=>n.type==='DemoPhoneField').props.value,phone);
 ns.find(n=>n.props?.id==='demo-name').props.onChange({target:{value:'Fixture Owner'}});
 ns.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
 ns=renderForm();await ns.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(requests.length,1);assert.equal(requests[0].phone,phone);assert.equal(requests[0].consented,true);
 assert(!requests[0].phone.includes('*'),'Submission always retains the real recipient');
}finally{Object.assign(globalThis,saved);}

const ownerInboundTarget={ownerUserId:'owner',accountId:'owner-account',ownerPhone:phone};let user=null;
const route=load('app/api/demo/intake/route.ts',new Proxy({
 'next/server':{},'next/headers':{},'node:crypto':require('node:crypto'),
 '@/lib/dashboard-password':{dashboardCurrentUser:async()=>user},'@/lib/owner-inbound-acceptance':{ownerInboundTarget},
}, {get:(obj,key)=>obj[key]??{},getOwnPropertyDescriptor:()=>({configurable:true,enumerable:true})}));
for(const identity of [null,{id:'another-owner'},{id:'owner'}]){
 user=identity;const response=await route.GET(),body=await response.json();
 assert.equal(body.ready,identity?.id==='owner');assert.equal(body.privateDemoPhone,identity?.id==='owner'?phone:null);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
}
console.log('PASS owner phone privacy: exact number matching, isolated display scope, concealed form editing, authorized default and original recipient submission. No provider work.');
