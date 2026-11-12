import assert from 'node:assert/strict';
import {processDealSupervisor} from '../lib/deal-supervisor.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const env={VERCEL_ENV:'production',ICASH_LIVE_WORK_READY:'true',DOCUSEAL_MODE:'live'};
for(const override of [{VERCEL_ENV:'preview'},{ICASH_LIVE_WORK_READY:'false'},{DOCUSEAL_MODE:'test'}])assert.equal((await processDealSupervisor(()=>assert.fail('Held environment queried database'),{...env,...override})).status,'held');
for(const output of [{status:'checked',processed:3,repaired:1,errors:0},{status:'disabled',processed:0,repaired:0,errors:0},{status:'busy',processed:0,repaired:0,errors:0}]){
 let count=0;const result=await processDealSupervisor(async(path,method,body,signal)=>{count++;assert.equal(path,'rpc/icash_run_deal_supervisor');assert.equal(method,'POST');assert.deepEqual(body,{});assert(signal instanceof AbortSignal);return output;},env);
 assert.deepEqual(result,output);assert.equal(count,1);
}
for(const output of [null,{status:'checked',processed:26,repaired:0,errors:0},'throw']){
 let count=0;const result=await processDealSupervisor(async()=>{count++;if(output==='throw')throw Error('PRIVATE unknown response');return output;},env);
 assert.equal(result.status,'unavailable');assert.equal(result.errors,1);assert.equal(count,1,'Uncertain RPC is not retried');
}
for(const failure of ['none','supervisor','owner','journey']){
 const calls=[];let authorized=false;
 const route=await loadService('app/api/internal/journeys/route.ts',{
  db:async()=>null,authorizeOutboundBilling:()=>authorized,process:{env},
  processDealSupervisor:async()=>{calls.push('supervisor');return {status:'checked',errors:failure==='supervisor'?1:0};},
  processOwnerBuyerDelivery:async()=>{calls.push('owner');if(failure==='owner')throw Error('PRIVATE');return {status:'owner_delivery_idle'};},
  processDealJourneys:async()=>{calls.push('journey');if(failure==='journey')throw Error('PRIVATE');return {status:'journeys_processed'};},
  sendForSignatures:()=>assert.fail(),textPendingContract:()=>assert.fail(),dispatchTextMessage:()=>assert.fail(),coordinateTitleOpening:()=>assert.fail(),
 });
 assert.equal((await route.GET(new Request('https://fixture.invalid'))).status,401);assert.deepEqual(calls,[]);
 authorized=true;const response=await route.GET(new Request('https://fixture.invalid'));assert.equal(response.status,failure==='none'?200:503);
 assert.deepEqual(calls,['supervisor','owner','journey']);assert.equal(response.headers.get('cache-control'),'no-store');assert(!JSON.stringify(await response.json()).includes('PRIVATE'));
}
console.log('PASS supervisor service and actual cron route: release gates, bounded response, no retries, authorization, failure isolation and truthful health.');
