import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
let userId='admin',origin=true,active=true,calls=[];
const deps={z,NextResponse:{json:(body,options={})=>({body,status:options.status??200})},ownerInboundTarget:{ownerUserId:'admin'},allowedOrigin:()=>origin,
 workAccount:async options=>{if(!active&&!options?.allowInactiveMembership)throw Error('SUBSCRIPTION_REQUIRED');return {accountId:'owned-account',userId};},
 db:async(path,method,body)=>{calls.push({path,method,body});return null;}};
async function load(file,key){globalThis[key]=deps;const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+code).toString('base64'));}
const route=await load('app/api/account/workspace-preview/route.ts','__previewRoute');
const req=body=>new Request('https://www.geticashx.com/api/account/workspace-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
for(const mode of ['vip','standard',null]){calls=[];assert.equal((await route.POST(req({mode}))).status,200);assert.deepEqual(calls,[{path:'rpc/icash_set_workspace_preview',method:'POST',body:{p_account:'owned-account',p_user:'admin',p_mode:mode}}]);}
userId='ordinary-user';calls=[];assert.equal((await route.POST(req({mode:'vip'}))).status,403);assert.equal(calls.length,0,'Ordinary accounts cannot request admin access');
userId='admin';origin=false;assert.equal((await route.POST(req({mode:'vip'}))).status,403);origin=true;
for(const body of [{mode:'vip',accountId:'other-account'},{mode:'vip',userId:'admin'},{mode:'gold'},{}, {mode:'vip',vip:true}]){assert.equal((await route.POST(req(body))).status,409);assert.equal(calls.length,0,'No client-supplied account or entitlement accepted');}
active=false;assert.equal((await route.POST(req({mode:'vip'}))).status,409);assert.equal(calls.length,0);assert.equal((await route.POST(req({mode:null}))).status,200,'Exit remains available after subscription expires');
const name=await load('app/api/account/bot-name/route.ts','__nameRoute');active=true;userId='standard-user';calls=[];
assert.equal((await name.POST(req({name:'  Harper  '}))).status,200);assert.equal(calls[0].body.p_name,'Harper');assert.equal(calls[0].body.p_user,'standard-user');
for(const value of ['', 'x'.repeat(65), '<script>', 'hello\nworld']){calls=[];assert.equal((await name.POST(req({name:value}))).status,409);assert.equal(calls.length,0);}
console.log('PASS preview/name routes: authenticated admin only, owned account binding, origin, strict payload, expiry exit and Standard name saving.');
