import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
let userId='admin',origin=true,active=true,calls=[],failWrite=false;
const deps={z,NextResponse:{json:(body,options={})=>({body,status:options.status??200})},ownerInboundTarget:{ownerUserId:'admin'},allowedOrigin:()=>origin,
 workAccount:async options=>{if(!active&&!options?.allowInactiveMembership)throw Error('SUBSCRIPTION_REQUIRED');return {accountId:'owned-account',userId};},
 db:async(path,method,body)=>{calls.push({path,method,body});if(failWrite)throw Error('database error');return null;}};
async function load(file,key){globalThis[key]=deps;const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');return import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.'+key+';\n'+code).toString('base64'));}
const route=await load('app/api/account/admin-plan/route.ts','__adminPlanRoute');
const req=body=>new Request('https://www.geticashx.com/api/account/admin-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
for(const plan of ['vip','standard']){calls=[];assert.equal((await route.POST(req({plan}))).status,200);assert.deepEqual(calls,[{path:'rpc/icash_set_admin_plan',method:'POST',body:{p_account:'owned-account',p_user:'admin',p_plan:plan}}]);}
userId='ordinary-user';calls=[];assert.equal((await route.POST(req({plan:'vip'}))).status,403);assert.equal(calls.length,0,'Ordinary accounts cannot request admin access');
userId='admin';origin=false;assert.equal((await route.POST(req({plan:'vip'}))).status,403);origin=true;
for(const body of [{plan:'vip',accountId:'other-account'},{plan:'vip',userId:'admin'},{plan:'gold'},{}, {plan:'vip',vip:true}]){assert.equal((await route.POST(req(body))).status,409);assert.equal(calls.length,0,'No client-supplied account or entitlement accepted');}
active=false;assert.equal((await route.POST(req({plan:'vip'}))).status,409);assert.equal(calls.length,0);assert.equal((await route.POST(req({plan:'standard'}))).status,409);
active=true;calls=[];for(const plan of [null,true,{},'']){assert.equal((await route.POST(req({plan}))).status,409);assert.equal(calls.length,0);}
failWrite=true;assert.equal((await route.POST(req({plan:'vip'}))).status,409,'Failed database changes are never reported as saved');
console.log('PASS admin plan route: owner only, server account binding, both plans, membership lock, origin, strict payload and failed-save handling.');
