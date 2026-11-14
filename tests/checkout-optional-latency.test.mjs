import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';

const timeout=AbortSignal.timeout,env=process.env.VERCEL_ENV,secret=process.env.ICASH_WEBINAR_SECRET;
let controller,signals=[],reads=[],writes=[];
AbortSignal.timeout=ms=>{assert.equal(ms,2000);controller=new AbortController();return controller.signal;};
const stalled=(path,method,body,signal)=>{assert(signal instanceof AbortSignal,'Optional checkout I/O must receive its deadline');reads.push(path);signals.push(signal);return new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
try{
 process.env.VERCEL_ENV='production';process.env.ICASH_WEBINAR_SECRET='fixture';
 const exclusions=await loadService('lib/legacy-launch-measurement.ts',{cookies:async()=>({get:()=>undefined}),legacyLaunchCookie:'icash_legacy_launch',launchTokenPattern:/^[a-f0-9]{64}$/,db:stalled});
 const tracking=await loadService('lib/checkout-measurement.ts',{cookies:async()=>({get:()=>undefined}),isIP:()=>0,automaticMeasurementEligible:()=>true,bindReminderCheckout:async()=>{},legacyAdMeasurementExcluded:exclusions.legacyAdMeasurementExcluded,webinarSettings:async()=>{writes.push('settings');return {meta:{enabled:true,pixelId:'fixture'}};},webinarVisitor:async()=>{writes.push('visitor');return {id:'visitor'};},db:async()=>writes.push('measurement')});
 const pending=tracking.bindCheckoutMeasurement(new Request('https://www.geticashx.com/api/billing/membership',{headers:{referer:'https://www.geticashx.com/live/123456','x-icash-measurement':'automatic'}}),'cs_live_original','live');
 await flush();assert.equal(reads.length,1);controller.abort(Error('Fixture deadline'));await pending;assert.deepEqual(writes,[],'An unknown private-campaign exclusion skips ad identity and writes; it cannot block the existing checkout');

 reads=[];signals=[];const cookie={get:key=>key==='icash_legacy_launch'?{value:'a'.repeat(64)}:undefined};
 const legacy=await loadService('lib/legacy-launch-server.ts',{cookies:async()=>cookie,db:stalled});
 const context=await loadService('lib/checkout-customer-context.ts',{cookies:async()=>cookie,legacyInviteContext:legacy.legacyInviteContext,readWebinarToken:()=>null,normalizeEmail:value=>value,db:stalled});
 const prefill=context.checkoutCustomerContext('guest','verified@example.invalid');await flush();controller.abort(Error('Fixture prefill deadline'));assert.deepEqual(await prefill,{email:'verified@example.invalid'},'Unavailable optional invitation prefill preserves the account email');assert.equal(reads.length,1);
 const binding=legacy.bindLegacyMembership('00000000-0000-4000-8000-000000000001','verified@example.invalid');const rejected=assert.rejects(binding,/Fixture binding deadline/);await flush();controller.abort(Error('Fixture binding deadline'));await rejected;assert.equal(reads.length,2,'A timed-out invitation lookup never starts membership binding');
 let savedSignal;
 const fastLegacy=await loadService('lib/legacy-launch-server.ts',{cookies:async()=>cookie,db:async(path,_method,_body,signal)=>{assert(signal instanceof AbortSignal);if(path.startsWith('icash_legacy_contacts')){savedSignal=signal;return [{id:'contact',email:'verified@example.invalid',name:'Casey',suppressed_reason:null,converted_at:null}];}assert.equal(signal,savedSignal,'Lookup and optional write share a single deadline');writes.push(path);}});
 await fastLegacy.bindLegacyMembership('00000000-0000-4000-8000-000000000001','verified@example.invalid');assert.deepEqual(writes,['rpc/icash_legacy_checkout_bind']);
 console.log('PASS optional checkout latency: bounded campaign checks, fail-closed ad privacy, safe prefill fallback and one deadline across legacy binding.');
}finally{AbortSignal.timeout=timeout;if(env===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=env;if(secret===undefined)delete process.env.ICASH_WEBINAR_SECRET;else process.env.ICASH_WEBINAR_SECRET=secret;}
