import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',deal='cccccccc-cccc-4ccc-8ccc-cccccccccccc',envelope='dddddddd-dddd-4ddd-8ddd-dddddddddddd',key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
let writes=[],reads=[],signedIn=true,owned=true,saveFails=false;
globalThis.__buyerCoordination={z,NextResponse:{json:(data,options)=>Response.json(data,options)},allowedOrigin:req=>req.headers.get('Origin')==='https://www.geticashx.com',workAccount:async()=>{if(!signedIn)throw Error();return {accountId:account,userId:actor};},db:async(path,method,body)=>{
 if(method==='POST'){writes.push({path,body});if(saveFails)throw Error('Sensitive provider detail');return key;}
 reads.push(path);assert(path.includes(`account_id=eq.${account}`));
 return path.startsWith('icash_deal_files')&&owned?[{id:deal}]:[];
}};
const compiled=ts.transpileModule(readFileSync('app/api/work/buyer-coordination/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from('const {z,NextResponse,allowedOrigin,workAccount,db}=globalThis.__buyerCoordination;\n'+compiled).toString('base64'));
const payload={action:'deposit',dealId:deal,envelopeId:envelope,key,amountCents:200000,method:'zelle',reference:'fixture reference',cleared:true};
const request=(body,origin='https://www.geticashx.com')=>new Request('https://www.geticashx.com/api/work/buyer-coordination',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('recording a cleared deposit uses authenticated owner scope and exact agreement',async()=>{
 const response=await POST(request(payload));assert.equal(response.status,200);assert.equal(writes.length,1);
 assert.deepEqual(writes[0],{path:'rpc/icash_confirm_buyer_deposit',body:{p_account:account,p_actor:actor,p_deal:deal,p_envelope:envelope,p_key:key,p_amount:200000,p_method:'zelle',p_reference:'fixture reference',p_cleared:true}});
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');
});
test('CSRF, spoofed scope, unsupported payment, excessive amount and uncleared funds never write',async()=>{
 writes=[];assert.equal((await POST(request(payload,'https://evil.invalid'))).status,403);
 for(const extra of [{accountId:key},{amountCents:500001},{amountCents:1.2},{method:'crypto'},{cleared:false}])assert.equal((await POST(request({...payload,...extra}))).status,409);
 signedIn=false;assert.equal((await POST(request(payload))).status,409);signedIn=true;assert.equal(writes.length,0);
});
test('failed save does not report success or leak provider details',async()=>{
 saveFails=true;const response=await POST(request(payload));saveFails=false;assert.equal(response.status,409);assert(!JSON.stringify(await response.json()).includes('Sensitive'));
});
test('availability saves only requested windows and cannot reserve a property',async()=>{
 writes=[];const response=await POST(request({action:'availability',dealId:deal,key,statement:'Seller gave this time',windows:['2026-10-16 2 PM Central'],timezone:'America/Chicago'}));assert.equal(response.status,200);assert.equal(writes.length,1);assert.equal(writes[0].path,'rpc/icash_save_viewing_slots');
});
test('read checks property ownership before loading private seller quotes or deposit references',async()=>{
 reads=[];owned=false;assert.equal((await GET(new Request(`https://www.geticashx.com/api/work/buyer-coordination?dealId=${deal}`))).status,404);assert.equal(reads.length,1);
 owned=true;reads=[];assert.equal((await GET(new Request(`https://www.geticashx.com/api/work/buyer-coordination?dealId=${deal}`))).status,200);assert.equal(reads.length,4);
});
