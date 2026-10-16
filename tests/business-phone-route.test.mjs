import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {additionalBusinessPhones,secondaryBusinessPhone,newBusinessPhone} from '../lib/business-phone-policy.ts';
let owner=true,origin=true,reads=[],writes=[];
class WebinarError extends Error{constructor(status,message){super(message);this.status=status;}}
class BusinessPhoneError extends Error{}
const status=phone=>({phone,incoming:true,callerIdVerified:true,callerIdSid:'private-caller-id',providerAccountSid:'private-account'});
const deps={z,additionalBusinessPhones,secondaryBusinessPhone,WebinarError,BusinessPhoneError,webinarHeaders:{},db:()=>{},
 webinarOwner:async()=>{if(!owner)throw new WebinarError(403,'Owner required');},webinarOrigin:()=>{if(!origin)throw new WebinarError(403,'Origin required');},webinarBody:req=>req.json(),webinarError:e=>Response.json({error:e.message},{status:e.status??400}),
 inspectBusinessPhone:async(env,fetcher,phone)=>{reads.push(phone);return status(phone);},connectBusinessPhone:async(db,env,fetcher,phone)=>{writes.push(phone);return status(phone);}};
globalThis.__phoneRoute=deps;
const source=ts.transpileModule(readFileSync('app/api/messaging/admin/calls/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const route=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__phoneRoute;\n'+source).toString('base64'));
const url='https://example.test/api/messaging/admin/calls';
const get=phone=>route.GET(new Request(url+(phone?'?phone='+encodeURIComponent(phone):'')));
const post=body=>route.POST(new Request(url,{method:'POST',body:JSON.stringify(body)}));
let result=await get(newBusinessPhone);assert.equal(result.status,200);assert.deepEqual(await result.json(),{phone:newBusinessPhone,incoming:true,callerIdVerified:true});assert.deepEqual(reads,[newBusinessPhone]);assert.equal(writes.length,0);
assert.equal((await post({action:'connect',phone:newBusinessPhone})).status,200);assert.deepEqual(writes,[newBusinessPhone]);
await post({action:'connect'});assert.equal(writes.at(-1),secondaryBusinessPhone,'An older page still targets only its displayed legacy number');
for(const phone of ['+12125550199','bad']){assert.equal((await get(phone)).status,400);assert.equal((await post({action:'connect',phone})).status,400);}
const count=writes.length;owner=false;assert.equal((await get(newBusinessPhone)).status,403);assert.equal((await post({action:'connect',phone:newBusinessPhone})).status,403);owner=true;origin=false;assert.equal((await post({action:'connect',phone:newBusinessPhone})).status,403);assert.equal(writes.length,count);
delete globalThis.__phoneRoute;
console.log('PASS call-settings route: exact new-number targeting, legacy compatibility, owner/origin boundaries, unsupported-number rejection and private provider identifiers.');
