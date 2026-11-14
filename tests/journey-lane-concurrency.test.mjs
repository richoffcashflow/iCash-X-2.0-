import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const delayed of ['supervisor','owner','journey'])for(const throws of [false,true]){
 const started=[],finished=[];let authorized=false,release;
 const wait=new Promise(resolve=>{release=resolve;});
 const run=(name,result)=>async()=>{started.push(name);if(name===delayed)await wait;finished.push(name);if(name===delayed&&throws)throw Error('PRIVATE uncertain operation');return result;};
 const route=await loadService('app/api/internal/journeys/route.ts',{
  db:async()=>assert.fail('Only existing service boundaries'),authorizeOutboundBilling:()=>authorized,process:{env:{}},
  processDealSupervisor:run('supervisor',{status:'checked',processed:0,repaired:0,errors:0}),
  processOwnerBuyerDelivery:run('owner',{status:'owner_delivery_idle'}),
  processDealJourneys:run('journey',{status:'journey_processed',messages:0}),
  sendForSignatures:()=>assert.fail(),textPendingContract:()=>assert.fail(),dispatchTextMessage:()=>assert.fail(),coordinateTitleOpening:()=>assert.fail(),
 });
 assert.equal((await route.GET(new Request('https://fixture.invalid'))).status,401);assert.deepEqual(started,[]);
 authorized=true;let returned=false;
 const pending=route.GET(new Request('https://fixture.invalid')).then(response=>{returned=true;return response;});
 await flush();const launched=[...started];assert.equal(returned,false,'Every launched task must finish before returning');
 release();const response=await pending;
 assert.deepEqual(launched,['supervisor','owner','journey'],'Independent customer work starts before the slow '+delayed+' branch finishes');
 assert.deepEqual(started,['supervisor','owner','journey'],'One execution per existing claim boundary');
 assert.equal(finished.length,3);assert.equal(response.status,throws?503:200);
 assert.equal(response.headers.get('cache-control'),'no-store');assert(!JSON.stringify(await response.json()).includes('PRIVATE'));
}
for(const status of ['message_accepted','message_delivered','owner_delivery_idle','owner_delivery_disabled','message_held','live_work_not_ready','business_number_mismatch','message_delivery_needs_review','messaging_configuration_required','business_number_verification_required','inbound_invitation_not_ready']){
 let calls=0;
 const route=await loadService('app/api/internal/journeys/route.ts',{
  db:async()=>assert.fail('Only existing service boundaries'),authorizeOutboundBilling:()=>true,process:{env:{}},
  processDealSupervisor:async()=>({status:'checked',processed:0,repaired:0,errors:0}),
  processOwnerBuyerDelivery:async()=>{calls++;return {status};},
  processDealJourneys:async()=>({status:'journey_processed',messages:0}),
  sendForSignatures:()=>assert.fail(),textPendingContract:()=>assert.fail(),dispatchTextMessage:()=>assert.fail(),coordinateTitleOpening:()=>assert.fail(),
 });
 const response=await route.GET(new Request('https://fixture.invalid'));
 assert.equal(calls,1);
 assert.equal(response.status,['message_delivery_needs_review','messaging_configuration_required','business_number_verification_required','inbound_invitation_not_ready'].includes(status)?503:200,status);
 assert.equal((await response.json()).ownerDelivery.status,status,'Original dispatch outcome is retained');
}
console.log('PASS independent supervisor, owner delivery and customer journeys start together, settle once and retain failure visibility.');
