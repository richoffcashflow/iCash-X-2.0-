import {processInstantLeadWork} from '../lib/meta-instant-lead-service.ts';
import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
let enabled=true,lookupFails=false,allocationFails=false,responseFails=false,assigned=false,authorized=true,emailFails=false;
let responses=[],research=0,recovery=0,measurement=0,emails=0;
const route=await loadService('app/api/internal/seller/route.ts',{processInstantLeadWork,
 processSellerEmails:async()=>{emails++;if(emailFails)throw Error('SIMULATION email queue outage');return {status:'seller_emails_idle'};},
 dealEmailConfigured:()=>true,dispatchDealEmail:()=>{throw Error('No network');},
 db:async path=>{
  if(path.startsWith('icash_seller_controls?'))return [{enabled}];
  if(path==='rpc/icash_collect_seller_milestones'){measurement++;return null;}
  if(path==='rpc/icash_assign_seller_lead'){if(allocationFails)throw Error('SIMULATION allocation outage');return assigned?{status:'assigned',leadId:'new-lead'}:null;}
  throw Error('Unexpected database call '+path);
 },
 authorizeOutboundBilling:()=>authorized,
 recoverAgreementDelivery:async()=>{recovery++;return {status:'recovery_idle'};},
 deliverSellerEvent:async()=>({status:'measurement_idle'}),
 processSellerIntake:async()=>{research++;if(lookupFails)throw Error('SIMULATION research outage');return {status:'idle'};},
 processSellerResearchRefresh:async()=>({status:'idle_or_setup_required'}),
 processSellerResponses:async(_db,_text,_voice,lead)=>{responses.push(lead??'existing');if(responseFails)throw Error('SIMULATION response outage');return [{leadId:lead??'existing',status:'queued'}];},
 dispatchTextMessage:()=>{throw Error('No network');},dispatchLiveVoice:()=>{throw Error('No network');},
 sendForSignatures:()=>{throw Error('No network');},textPendingContract:()=>{throw Error('No network');},
 process:{env:{}},
});
const run=()=>route.GET(new Request('https://fixture.invalid/api/internal/seller'));
authorized=false;assert.equal((await run()).status,401);assert.deepEqual(responses,[]);assert.equal(research,0);assert.equal(emails,0,'unauthorized requests do not start email work');
authorized=true;lookupFails=true;let result=await run();assert.equal(result.status,503);assert.deepEqual(responses,['existing']);
assert.equal((await result.json()).responses[0].leadId,'existing','lookup errors do not swallow existing response work');
responses=[];enabled=false;research=0;result=await run();assert.equal(result.status,200);assert.deepEqual(responses,['existing']);assert.equal(research,0,'disabled acquisition does not make a paid lookup');
responses=[];enabled=true;lookupFails=false;assigned=true;result=await run();assert.equal(result.status,200);assert.deepEqual(responses,['existing','new-lead'],'new assignments still get an immediate targeted response');
responses=[];allocationFails=true;assert.equal((await run()).status,503);assert.deepEqual(responses,['existing'],'allocation failure cannot cancel existing response work');
responses=[];allocationFails=false;assigned=false;responseFails=true;assert.equal((await run()).status,503);assert.deepEqual(responses,['existing'],'failed response work is not retried in the same tick');
responses=[];responseFails=false;assigned=true;emailFails=true;result=await run();assert.equal(result.status,200);
const emailFailure=await result.json();assert.equal(emailFailure.sellerEmails.status,'seller_email_retry_pending');
assert.deepEqual(responses,['existing','new-lead'],'an email outage cannot swallow existing or immediate seller responses');
assert.equal(emailFailure.agreementRecovery.status,'recovery_idle');assert.equal(emailFailure.measurement.status,'measurement_idle');
assert(recovery>0&&measurement>0&&emails>0,'independent agreement, measurement and email work still run');
console.log('PASS seller maintenance: existing responses survive lookup/allocation outages and disabled acquisition; new matches are immediate; no same-tick retry or provider requests.');
