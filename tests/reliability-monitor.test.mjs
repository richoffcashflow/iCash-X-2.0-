import assert from 'node:assert/strict';
import {refreshReliability} from '../lib/reliability-monitor.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {maintenanceBatch} from '../lib/maintenance-batch.ts';
import {pruneUsageLoopObservations} from '../lib/usage-loop-tracking.ts';
const original=console.error;const logs=[];console.error=v=>logs.push(v);
try{
 let calls=[];
 const db=async(path,method,body)=>{calls.push({path,body});return path.endsWith('snapshot')?{issueCount:2}:null;};
 assert.equal(await refreshReliability(db,false),true);assert.equal(calls[0].body.p_status,'degraded');assert.equal(logs.length,1);
 assert.equal(calls[1].path,'rpc/icash_refresh_outreach_reliability_snapshot','the deployed app activates the expanded workflow monitor');
 assert.equal(await refreshReliability(async()=>{throw Error('secret')},true),false);assert(!logs.join('').includes('secret'));
 let authorized=false,ran=0,recovered=0;
 const route=await loadService('app/api/internal/maintenance/route.ts',{processSupportCustomerNotifications:async()=>{ran++;return {state:'ready',failed:0};},recoverAccessHelpReplies:async()=>{recovered++;return 0;},processSupportOwnerNotifications:async()=>{ran++;return {state:'ready',failed:0};},processPurchaseAccessEmails:async()=>{ran++;return {ready:true,failed:0};},processPurchaseAccessFollowups:async()=>{ran++;return {ready:true,failed:0};},authorizeOutboundBilling:()=>authorized,process:{env:{}},maintenanceBatch,refreshReliability,pruneUsageLoopObservations,db,
  outbound:async()=>{ran++;throw Error('Temporary outage');},recording:async()=>{ran++;return new Response();},ownerRecording:async()=>{ran++;return new Response();},reception:async()=>{ran++;return new Response();}});
 assert.equal((await route.GET(new Request('https://fixture.test'))).status,401);assert.equal(ran,0);assert.equal(recovered,0);
 authorized=true;calls=[];const result=await route.GET(new Request('https://fixture.test'));assert.equal(result.status,503);assert.equal(ran,8,'One failed lane cannot suppress other maintenance');assert.equal(recovered,1,'Authorized maintenance recovers unanswered support');
 assert.equal(calls.find(call=>call.path==='rpc/icash_record_service_heartbeat').body.p_status,'degraded');
 assert.equal(calls.filter(call=>call.path==='rpc/icash_prune_usage_loop_observations').length,1,'Authorized maintenance includes optional retention cleanup');
 console.log('PASS maintenance authorization, independent lanes, persisted status, bounded snapshot and safe logs.');
}finally{console.error=original;}
