import assert from 'node:assert/strict';
import vm from 'node:vm';
import {sellerPixelBootstrap,sellerPixelId} from '../lib/seller-pixel.ts';
import {sellerMeasurement,recordSellerMeasurement} from '../lib/seller-measurement.ts';
import {sellerMetaEvent,deliverSellerEvent} from '../lib/seller-conversions.ts';

function browser(url,gpc=false){
 const scripts=[],storage=new Map();
 const w={location:new URL(url),navigator:{globalPrivacyControl:gpc},crypto:{randomUUID:()=>crypto.randomUUID()},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};
 const d={createElement:()=>({}),getElementsByTagName:()=>[{parentNode:{insertBefore:node=>scripts.push(node)}}]};
 const run=()=>vm.runInNewContext(sellerPixelBootstrap,{window:w,document:d,URLSearchParams});run();return {w,scripts,run};
}
for(const url of ['https://homeoffernetwork.com/','https://www.homeoffernetwork.com/','https://www.geticashx.com/sell']){
 const b=browser(url);b.run();b.w.homeOfferPixel.start();
 const calls=b.w.fbq.queue;assert.equal(b.scripts.length,1);assert.equal(calls.filter(c=>c[2]==='PageView').length,1);
 const id='keypath:12345678-1234-4234-8234-123456789abc';
 b.w.homeOfferPixel.registration(id);b.w.homeOfferPixel.registration(id);
 assert.equal(calls.filter(c=>c[2]==='CompleteRegistration').length,1);
 assert.deepEqual(Array.from(calls.at(-1)).slice(0,3),['trackSingle',sellerPixelId,'CompleteRegistration']);
 assert.equal(calls.at(-1)[4].eventID,id);
 const addressId='keypath:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 b.w.homeOfferPixel.address(addressId);b.w.homeOfferPixel.address(addressId);
 assert.equal(calls.filter(c=>c[2]==='PropertyAddressConfirmed').length,1);
 assert.deepEqual(Array.from(calls.at(-1)).slice(0,3),['trackSingleCustom',sellerPixelId,'PropertyAddressConfirmed']);
 assert.equal(calls.at(-1)[4].eventID,addressId);
 b.w.navigator.globalPrivacyControl=true;b.w.homeOfferPixel.registration('keypath:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.equal(calls.filter(c=>c[2]==='CompleteRegistration').length,1);
 b.w.homeOfferPixel.address('keypath:cccccccc-cccc-4ccc-8ccc-cccccccccccc');assert.equal(calls.filter(c=>c[2]==='PropertyAddressConfirmed').length,1);
}
for(const url of ['https://www.geticashx.com/','https://homeoffernetwork.com/sell/privacy','https://www.geticashx.com/workspace','https://homeoffernetwork.com/?preview=1','https://preview.vercel.app/sell','http://localhost:3000/sell'])assert.equal(browser(url).scripts.length,0);
assert.equal(browser('https://homeoffernetwork.com/',true).scripts.length,0);
const req=new Request('https://homeoffernetwork.com/api/seller/intake',{headers:{'user-agent':'fixture-browser'}});
const cookie={get:key=>({value:key==='_fbp'?'fb.1.1792198000000.12345':'malformed'})};
const m=sellerMeasurement(req,cookie,{source:'meta',clickId:'valid-click'},1792198000000);
assert.equal(m.fbc,'fb.1.1792198000000.valid-click');assert.equal(m.fbp,'fb.1.1792198000000.12345');assert.equal(m.client_user_agent,'fixture-browser');
assert(!sellerMeasurement(req,{get:()=>undefined},{source:'google',clickId:'gclid'}).fbc);
const now=Date.now(),event={id:'fixture-event',leadId:'fixture-lead',token:'claim',name:'CompleteRegistration',phone:'+12145550123',occurredAt:new Date(now).toISOString(),measurement:{...m,address:'PRIVATE',equity:'PRIVATE'}};
const payload=sellerMetaEvent(event,now);assert.equal(payload.action_source,'website');assert.equal(payload.event_source_url,'https://homeoffernetwork.com/');assert.equal(payload.event_id,'keypath:fixture-event');assert.equal(payload.user_data.fbc,m.fbc);assert(!JSON.stringify(payload).includes('PRIVATE'));assert(!JSON.stringify(payload).includes(event.phone));
assert.equal(sellerMetaEvent({...event,name:'Contact'},now).action_source,'phone_call');assert.equal(sellerMetaEvent({...event,name:'SubmitApplication'},now).action_source,'system_generated');
const addressPayload=sellerMetaEvent({...event,name:'PropertyAddressConfirmed',id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},now);
assert.equal(addressPayload.action_source,'website');assert.equal(addressPayload.event_id,'keypath:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');assert.equal(addressPayload.event_source_url,'https://homeoffernetwork.com/');assert(!JSON.stringify(addressPayload).includes('PRIVATE'));
const calls=[],db=async(path,_method,body)=>{calls.push({path,body});return path==='rpc/icash_claim_seller_event'?event:true;};
const env={VERCEL_ENV:'production',META_SELLER_EVENTS_ENABLED:'true',META_SELLER_DATASET_ID:sellerPixelId,META_CAPI_ACCESS_TOKEN:'fixture',META_GRAPH_VERSION:'v26.0'};
let requestBody;
assert.equal((await deliverSellerEvent(db,env,async(url,options)=>{assert.equal(url,`https://graph.facebook.com/v26.0/${sellerPixelId}/events`);requestBody=JSON.parse(options.body);return Response.json({events_received:1});})).status,'delivered');
assert.equal(requestBody.data[0].event_id,payload.event_id);assert.equal(calls.at(-1).body.p_delivered,true);
const before=calls.length;assert.equal((await deliverSellerEvent(db,{...env,VERCEL_ENV:'preview'})).status,'measurement_disabled_outside_production');assert.equal(calls.length,before);
assert.equal(await recordSellerMeasurement(async()=>{throw Error('offline');},'lead','guest',m,false),null,'Analytics outage must never invalidate a saved request');
console.log('PASS HON pixel scope, successful registration deduplication, GPC, attribution, CAPI privacy, production gate and graceful measurement failure.');
