import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';
import ts from 'typescript';
import {automaticMeasurementEligible} from '../lib/webinar-measurement-policy.ts';
import {checkoutMeasurementHeaders} from '../lib/checkout-measurement-client.ts';
const original={VERCEL_ENV:process.env.VERCEL_ENV,VERCEL:process.env.VERCEL};
let enabled=true,exists=false,writes=[],creates=[],unavailable=false,reminderBindings=[],privateCampaign=false;
const deps={bindReminderCheckout:async(...args)=>reminderBindings.push(args),isIP,automaticMeasurementEligible,legacyAdMeasurementExcluded:async()=>privateCampaign,
 cookies:async()=>({get:name=>({value:name==='_fbp'?'fb.1.123.browser':undefined})}),
 webinarSettings:async()=>({meta:{enabled,pixelId:'1104248230721457'}}),
 webinarVisitor:async create=>{creates.push(create);if(!create&&!exists)throw Error('No visitor');exists=true;return {id:'visitor'};},
 db:async(path,method,body,signal)=>{assert(signal instanceof AbortSignal);if(unavailable)throw Error('Database unavailable');writes.push({path,body});}
};
globalThis.__checkoutMeasurement=deps;
const code=ts.transpileModule(readFileSync(new URL('../lib/checkout-measurement.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {bindCheckoutMeasurement}=await import('data:text/javascript;base64,'+Buffer.from(`const {${Object.keys(deps).join(',')}}=globalThis.__checkoutMeasurement;\n`+code).toString('base64'));
const request=(headers={})=>new Request('https://www.geticashx.com/api/billing/membership',{headers:{'x-icash-measurement':'automatic','x-vercel-ip-country':'US','x-vercel-forwarded-for':'203.0.113.4','x-icash-fbclid':'click_fixture',...headers}});
try{
 process.env.VERCEL_ENV='production';process.env.VERCEL='1';
 privateCampaign=true;await bindCheckoutMeasurement(request(),'cs_live_private','live');assert.equal(writes.length,0);assert.equal(creates.length,0,'Private signup creates no ad identity');privateCampaign=false;
 await bindCheckoutMeasurement(request(),'cs_live_direct','live');
 assert.deepEqual(creates,[true]);assert.equal(writes.length,2);
 assert.equal(writes[0].body.p_action,'automatic');assert.equal(writes[0].body.p_automatic_eligible,true);
 assert.equal(writes[0].body.p_metadata.fbp,'fb.1.123.browser');assert.match(writes[0].body.p_metadata.fbc,/click_fixture$/);
 assert.equal(writes[0].body.p_metadata.client_ip_address,'203.0.113.4');assert.deepEqual(writes[1].body,{p_checkout:'cs_live_direct',p_visitor:'visitor'});
 for(const headers of [{'sec-gpc':'1'},{'x-icash-measurement':'deny'}]){
  writes=[];await bindCheckoutMeasurement(request(headers),'cs_live_direct','live');
  assert.equal(creates.at(-1),false);assert.equal(writes[0].body.p_action,'deny');assert.deepEqual(writes[0].body.p_metadata,{});
 }
 writes=[];exists=false;await bindCheckoutMeasurement(request({'x-icash-measurement':'deny'}),'cs_live_direct','live');assert.equal(writes.length,0,'Opted-out checkout cannot create an ad identity');
 writes=[];await bindCheckoutMeasurement(request({'x-vercel-ip-country':'GB'}),'cs_live_direct','live');assert.equal(writes[0].body.p_automatic_eligible,false);
 process.env.VERCEL='';writes=[];await bindCheckoutMeasurement(request(),'cs_live_direct','live');assert.equal(writes[0].body.p_automatic_eligible,false);assert.equal(writes[0].body.p_metadata.client_ip_address,undefined);
 process.env.VERCEL='1';writes=[];await bindCheckoutMeasurement(request(),'cs_test_fixture','test');assert.equal(writes.length,0);
 process.env.VERCEL_ENV='preview';await bindCheckoutMeasurement(request(),'cs_live_direct','live');assert.equal(writes.length,0);
 process.env.VERCEL_ENV='production';enabled=false;await bindCheckoutMeasurement(request(),'cs_live_direct','live');assert.equal(writes.length,0);assert.equal(reminderBindings.at(-1)[1],'cs_live_direct','Internal reminder tracking is independent of the Meta enable setting');
 enabled=true;unavailable=true;await assert.doesNotReject(()=>bindCheckoutMeasurement(request(),'cs_live_direct','live'),'Measurement failure must not interrupt payment');
 const globals=Object.fromEntries(['location','document','localStorage','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 try{
  let denied=false,checkout=true,gpc=false;
  Object.defineProperties(globalThis,{
   location:{value:{pathname:'/',search:'?fbclid=click_fixture'},configurable:true},
   document:{value:{querySelector:()=>checkout?{}:null},configurable:true},
   localStorage:{value:{getItem:()=>denied?'deny':null},configurable:true},
   navigator:{value:{get globalPrivacyControl(){return gpc;}},configurable:true}
  });
  assert.deepEqual(checkoutMeasurementHeaders(),{'x-icash-measurement':'automatic','x-icash-fbclid':'click_fixture'});
  checkout=false;assert.deepEqual(checkoutMeasurementHeaders(),{});
  denied=true;assert.deepEqual(checkoutMeasurementHeaders(),{'x-icash-measurement':'deny'});
  denied=false;gpc=true;assert.deepEqual(checkoutMeasurementHeaders(),{'x-icash-measurement':'deny'});
  gpc=false;checkout=true;location.search='?preview=fixture';assert.deepEqual(checkoutMeasurementHeaders(),{});
 }finally{for(const [key,descriptor] of Object.entries(globals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 console.log('PASS checkout identity: privacy/click context captured before payment, trusted geography, opt-out/GPC, test/preview exclusions, and fail-open analytics.');
}finally{for(const [key,value] of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;delete globalThis.__checkoutMeasurement;}
