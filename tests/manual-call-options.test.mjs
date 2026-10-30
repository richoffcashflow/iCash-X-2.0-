import {recordingGateCostPending,recordingGateHoldReasons} from '../lib/recording-gate-diagnostics.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {z} from 'zod';
let origin=true,authorized=true,blocked=false,extraContact=false,recordingAttempts=[];const mutations=[],senderReads=[];
const account='11111111-1111-4111-8111-111111111111',screen='22222222-2222-4222-8222-222222222222',phone='+12025550101';
const secondPhone='+12025550102',primary='+14243948384',secondary='+17208134296',senders=new Map([[phone,primary],[secondPhone,secondary]]);
const mocks={recordingGateCostPending,z,allowedOrigin:()=>origin,NextResponse:{json:(body,options={})=>({body,status:options.status??200})},workAccount:async()=>{if(!authorized)throw Error();return {accountId:account,userId:'owner'};},db:async(path,method,body)=>{
 if(method!=='POST'){assert(path.includes('account_id=eq.'+account));assert(path.includes('screening_id=eq.'+screen));if(path.startsWith('icash_call_recordings?')){assert(path.includes('last_error,last_action'));return recordingAttempts;}if(['icash_customer_phone_calls?','icash_deal_files?'].some(prefix=>path.startsWith(prefix)))return [];throw Error('Unexpected read '+path);}
 assert.equal(body.p_account,account);if(body.p_screening)assert.equal(body.p_screening,screen);
 if(path==='rpc/icash_customer_call_sender'){senderReads.push(body.p_recipient);return senders.get(body.p_recipient)??null;}
 if(path==='rpc/icash_manual_contacts')return [{phone,name:'Alex',phone_type:'wireless',blocked},...(extraContact?[{phone:secondPhone,name:'Blake',phone_type:'wireless',blocked:false}]:[])];
 if(path==='rpc/icash_manual_contact_reason')return blocked?'Do not contact. This number is blocked.':null;
 if(path==='rpc/icash_start_manual_call'){mutations.push(body);return blocked?{error:'Do not contact.'}:{manual:true,dialUrl:'tel:'+body.p_phone};}
 throw Error('Unexpected RPC');
}};
globalThis.__manualCall=mocks;
const source=ts.transpileModule(readFileSync(new URL('../app/api/work/manual-call/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(mocks).join(',')+'}=globalThis.__manualCall;\n'+source).toString('base64'));
const get=()=>GET(new Request('https://example.test/api/work/manual-call?screeningId='+screen));
let r=await get();assert.equal(r.body.contacts[0].available,true);assert.equal(r.body.contacts[0].name,'Alex');assert.equal(r.body.contacts[0].businessNumber,primary);assert.equal(r.body.businessNumber,undefined,'A property-wide sender must not override each recipient’s routing');assert.equal(mutations.length,0);
for(const reason of ['terminal_carrier_reconciliation_required',...recordingGateHoldReasons]){
 recordingAttempts=[{id:screen,state:'declined',created_at:'2026-10-19T00:00:00Z',last_error:reason,last_action:'reconcile_retry'}];
 r=await get();assert.equal(r.body.attempts[0].costPending,true,reason);
 recordingAttempts[0].last_action='gate_settled';r=await get();assert.equal(r.body.attempts[0].costPending,false,'Settled must override stale '+reason);
}
for(const reason of [null,'unrelated_error','RAW_PROVIDER_PRIVATE_VALUE']){
 recordingAttempts=[{id:screen,state:'declined',created_at:'2026-10-19T00:00:00Z',last_error:reason,last_action:'reconcile_retry'}];r=await get();assert.equal(r.body.attempts[0].costPending,false);
}
recordingAttempts=[];
const beforeBlocked=senderReads.length;blocked=true;r=await get();assert.equal(r.body.contacts[0].available,false);assert.equal(r.body.contacts[0].businessNumber,null);assert.equal(senderReads.length,beforeBlocked,'Blocked contacts do not select an alternate caller');
const post=(p=phone)=>POST(new Request('https://example.test/api/work/manual-call',{method:'POST',body:JSON.stringify({screeningId:screen,phone:p})}));
r=await post();assert.equal(r.status,410);assert.equal(r.body.dialUrl,undefined);blocked=false;
origin=false;r=await post();assert.equal(r.status,403);origin=true;
authorized=false;r=await post();assert.equal(r.status,401);authorized=true;
r=await post('invalid');assert.equal(r.status,410);
r=await post();assert.equal(r.status,410);assert.equal(mutations.length,0,'retired dialer never creates an attempt or takeover');
extraContact=true;r=await get();assert.deepEqual(r.body.contacts.map(c=>[c.phone,c.businessNumber,c.available]),[[phone,primary,true],[secondPhone,secondary,true]],'Each recipient uses its own server-selected conversation number');
const availableContacts=r.body.contacts;
senders.delete(secondPhone);r=await get();assert.equal(r.body.contacts[0].available,true);assert.equal(r.body.contacts[1].available,false);assert.equal(r.body.contacts[1].businessNumber,null);assert.match(r.body.contacts[1].reason,/business calling number is unavailable/i,'A missing or conflicting route is a hold, not another contact’s caller');
const heldContact=r.body.contacts[1];
delete globalThis.__manualCall;

const require=createRequire(import.meta.url),component={exports:{}};
const componentSource=ts.transpileModule(readFileSync(new URL('../components/browser-call-controls.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',componentSource)(name=>{
 if(name==='@/components/owner-phone-privacy')return {PrivatePhone:({children})=>children};
 if(name==='react')return {useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect(){},useEffectEvent:f=>f};
 if(name==='react/jsx-runtime')return require(name);
 if(name==='lucide-react')return {Mic:()=>null,MicOff:()=>null,Phone:()=>null,PhoneOff:()=>null};
 if(name==='@/lib/browser-call-session')return {BrowserCallSession:class{constructor(){throw Error('A display fixture must not dial');}}};
 throw Error('Unexpected component import '+name);
},component,component.exports);
const all=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props?.children)];
const render=contacts=>component.exports.BrowserCallControls({screeningId:screen,contacts,onFinished(){}});
const cards=all(render(availableContacts)).filter(n=>n.props?.className==='seller-contact-card');
assert.equal(cards.length,2);assert.match(renderToStaticMarkup(cards[0]),/Alex.*From \(424\) 394-8384/s);assert.match(renderToStaticMarkup(cards[1]),/Blake.*From \(720\) 813-4296/s);
assert.equal(all(cards[0]).find(n=>n.type==='button').props['aria-label'],'Call Alex from '+primary);
assert.equal(all(cards[1]).find(n=>n.type==='button').props['aria-label'],'Call Blake from '+secondary);
assert.equal(all(render([availableContacts[0],heldContact])).filter(n=>n.props?.className==='seller-contact-card').length,1,'An unavailable route exposes no call button');
assert.equal(mutations.length,0);
console.log('Manual call API and UI: tenant scope, recipient-specific numbers, unavailable route hold, names, read-only preview, blocked number, origin/auth, retired dialer and zero mutations passed.');
