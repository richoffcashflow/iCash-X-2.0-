import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
import {createHash,randomBytes,randomInt} from 'node:crypto';
import {allowedOrigin} from '../lib/funding-policy.ts';
import {sellerOptinSource,sellerOptinCampaign,sellerOptinPlan,chooseSellerOptin} from '../lib/seller-optin.ts';
let token=null,stored=null,opens=0,events=[];
const jar={get:()=>token?{value:token}:undefined,set:(key,value,opts)=>{assert.equal(key,'homeoffer_optin');assert.equal(opts.httpOnly,true);assert.equal(opts.secure,true);token=value;}};
const mocks={z,cookies:async()=>jar,randomBytes,randomInt,allowedOrigin,validGuest:v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),guestHash:v=>createHash('sha256').update(v).digest('hex'),limitRequest:async()=>{},sellerOptinSource,sellerOptinCampaign,sellerOptinPlan,chooseSellerOptin,sellerOptinRoutingRows:async()=>[],db:async(path,method,body)=>{
 if(path.startsWith('icash_seller_optin_visits?'))return stored?[{variant:stored}]:[];
 if(path==='rpc/icash_open_seller_optin'){opens++;stored=body.p_variant;assert.equal(body.p_source,'meta');assert.equal(body.p_device,'mobile');return stored;}
 if(path==='rpc/icash_record_seller_optin_event'){events.push(body.p_event);return true;}
 throw Error('Unexpected DB call');
}};
globalThis.__optinMocks=mocks;
let source=ts.transpileModule(readFileSync(new URL('../app/api/seller/experiment/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
source='const {'+Object.keys(mocks).join(',')+'}=globalThis.__optinMocks;\n'+source;
const route=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const req=(body,headers={})=>new Request('https://homeoffernetwork.com/api/seller/experiment',{method:'POST',headers:{origin:'https://homeoffernetwork.com','user-agent':'Mozilla iPhone Safari','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
assert.equal((await route.POST(req({event:'open'},{origin:'https://other.example'}))).status,403);
assert.equal((await (await route.POST(req({event:'open'},{'sec-gpc':'1'}))).json()).measured,false);assert.equal(token,null);assert.equal(opens,0);
assert.equal((await (await route.POST(req({event:'open'},{'user-agent':'SomeCrawler'}))).json()).measured,false);assert.equal(opens,0);
assert.equal((await route.POST(req({event:'open',variant:'fast_cash'}))).status,400,'Client cannot choose its own assignment');
const first=await (await route.POST(req({event:'open',source:'instagram'}))).json();assert.equal(first.measured,true);assert.equal(opens,1);
const second=await (await route.POST(req({event:'open',source:'instagram'}))).json();assert.equal(second.variant,first.variant);assert.equal(opens,1);
await route.POST(req({event:'view'}));assert.deepEqual(events,['view']);
assert.equal((await route.POST(req({event:'qualified'}))).status,400,'Only server-verified property results can qualify');
const raw='x'.repeat(601);assert.equal((await route.POST(new Request('https://homeoffernetwork.com/api/seller/experiment',{method:'POST',headers:{origin:'https://homeoffernetwork.com'},body:raw}))).status,400);
console.log('PASS opt-in API: origin validation, opt-outs, bot exclusion, cookie security, sticky assignment and client event allowlist.');
