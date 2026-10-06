import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
let origin=true,authorized=true,blocked=false;const mutations=[];
const account='11111111-1111-4111-8111-111111111111',screen='22222222-2222-4222-8222-222222222222',phone='+12025550101';
const mocks={z,allowedOrigin:()=>origin,NextResponse:{json:(body,options={})=>({body,status:options.status??200})},workAccount:async()=>{if(!authorized)throw Error();return {accountId:account,userId:'owner'};},db:async(path,method,body)=>{
 assert.equal(body.p_account,account);if(body.p_screening)assert.equal(body.p_screening,screen);
 if(path==='rpc/icash_manual_contacts')return [{phone,name:'Alex',phone_type:'wireless',blocked}];
 if(path==='rpc/icash_manual_contact_reason')return blocked?'Do not contact. This number is blocked.':null;
 if(path==='rpc/icash_start_manual_call'){mutations.push(body);return blocked?{error:'Do not contact.'}:{manual:true,dialUrl:'tel:'+body.p_phone};}
 throw Error('Unexpected RPC');
}};
globalThis.__manualCall=mocks;
const source=ts.transpileModule(readFileSync(new URL('../app/api/work/manual-call/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(mocks).join(',')+'}=globalThis.__manualCall;\n'+source).toString('base64'));
const get=()=>GET(new Request('https://example.test/api/work/manual-call?screeningId='+screen));
let r=await get();assert.equal(r.body.contacts[0].available,true);assert.equal(r.body.contacts[0].name,'Alex');assert.equal(mutations.length,0);
blocked=true;r=await get();assert.equal(r.body.contacts[0].available,false);
const post=(p=phone)=>POST(new Request('https://example.test/api/work/manual-call',{method:'POST',body:JSON.stringify({screeningId:screen,phone:p})}));
r=await post();assert.equal(r.status,409);assert.equal(r.body.dialUrl,undefined);blocked=false;
origin=false;mutations.length=0;r=await post();assert.equal(r.status,403);assert.equal(mutations.length,0);origin=true;
authorized=false;r=await post();assert.equal(r.status,409);assert.equal(mutations.length,0);authorized=true;
r=await post('invalid');assert.equal(r.status,409);assert.equal(mutations.length,0);
r=await post();assert.equal(r.status,200);assert.equal(r.body.dialUrl,'tel:'+phone);assert.equal(mutations[0].p_actor,'owner');
const ui=readFileSync(new URL('../components/manual-call-options.tsx',import.meta.url),'utf8');assert(ui.indexOf('onTakeover?.()')<ui.indexOf('window.location.assign'));
delete globalThis.__manualCall;console.log('Manual call API: tenant scope, names, read-only preview, blocked number, origin/auth, malformed number and explicit dialer action passed.');
