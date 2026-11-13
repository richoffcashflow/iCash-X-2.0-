import {processInstantLeadWork} from '../lib/meta-instant-lead-service.ts';
import {processSellerResponses as dispatchSellerResponses} from '../lib/seller-response-service.ts';
import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
let instantResult={status:"disabled"},instantThrows=false;
let enabled=true,lookupFails=false,allocationFails=false,responseFails=false,assigned=false,authorized=true,emailFails=false,rateLimited=false,demoFails=false,demoRecovered=false;
let responses=[],research=0,recovery=0,measurement=0,emails=0,contactChecks=0,contactFails=false;
let demoRecoveries=0,demoAssignments=[],allocationEvents=[],demoResponseAllowed=true,demoDispatches=[],lookupOrder=[];
const route=await loadService('app/api/internal/seller/route.ts',{processInstantLeadWork:async()=>{if(instantThrows)throw Error('fixture');return instantResult;},
 processSellerEmails:async()=>{emails++;if(emailFails)throw Error('SIMULATION email queue outage');return {status:'seller_emails_idle'};},
 dealEmailConfigured:()=>true,dispatchDealEmail:()=>{throw Error('No network');},
 db:async(path,method,body)=>{
  if(path.startsWith('icash_seller_controls?'))return [{enabled}];
  if(path==='rpc/icash_collect_seller_milestones'){measurement++;return null;}
  if(path==='rpc/icash_assign_seller_lead'){allocationEvents.push('generic');if(allocationFails)throw Error('SIMULATION allocation outage');return assigned?{status:'assigned',leadId:'new-lead'}:null;}
  if(path==='rpc/icash_assign_seller_lead_for'){assert.equal(method,'POST');assert.deepEqual(body,{p_lead:'owner-demo'});allocationEvents.push(body.p_lead);demoAssignments.push(body.p_lead);return null;}
  if(path==='rpc/icash_prepare_seller_responses'){assert.deepEqual(body,{p_lead:'owner-demo'});return demoResponseAllowed?[{leadId:'owner-demo',accountId:'owner-account',smsMessageId:'owner-text',voiceJobId:'owner-voice',status:'queued'}]:[];}
  if(path==='rpc/icash_note_seller_response')return null;
  throw Error('Unexpected database call '+path);
 },
 authorizeOutboundBilling:()=>authorized,
 recoverAgreementDelivery:async()=>{recovery++;return {status:'recovery_idle'};},
 deliverSellerEvent:async()=>({status:'measurement_idle'}),
 processSellerIntake:async()=>{lookupOrder.push('generic');research++;if(lookupFails)throw Error('SIMULATION research outage');return {status:rateLimited?'rate_limited':'idle'};},
 recoverPendingOwnerDemoLookup:async()=>{lookupOrder.push('owner');demoRecoveries++;if(demoFails)throw Error('SIMULATION demo recovery outage');return demoRecovered?{status:'property_checked',leadId:'owner-demo'}:{status:'owner_demo_recovery_idle'};},
 processSellerResearchRefresh:async()=>({status:'idle_or_setup_required'}),
 processSellerContactRefresh:async()=>{contactChecks++;if(contactFails)throw Error('SIMULATION contact check unavailable');return {status:'contact_refresh_idle'};},
 processSellerResponses:async(_db,_text,_voice,lead)=>{responses.push(lead??'existing');if(responseFails)throw Error('SIMULATION response outage');return lead==='owner-demo'?dispatchSellerResponses(_db,_text,_voice,lead):[{leadId:lead??'existing',status:'queued'}];},
 dispatchTextMessage:async(account,id)=>{assert.equal(account,'owner-account');assert.equal(id,'owner-text');demoDispatches.push('sms');return {status:'message_accepted'};},
 dispatchLiveVoice:async(account,id)=>{assert.equal(account,'owner-account');assert.equal(id,'owner-voice');demoDispatches.push('voice');return {status:'call_started'};},
 sendForSignatures:()=>{throw Error('No network');},textPendingContract:()=>{throw Error('No network');},
 process:{env:{}},
});
const run=()=>route.GET(new Request('https://fixture.invalid/api/internal/seller'));
authorized=false;assert.equal((await run()).status,401);assert.deepEqual(responses,[]);assert.equal(research,0);assert.equal(emails,0,'unauthorized requests do not start email work');assert.equal(contactChecks,0,'unauthorized requests do not start contact checks');assert.equal(demoRecoveries,0);
authorized=true;lookupFails=true;let result=await run();assert.equal(result.status,503);assert.deepEqual(responses,['existing']);
assert.equal((await result.json()).responses[0].leadId,'existing','lookup errors do not swallow existing response work');
responses=[];enabled=false;research=0;const beforeDisabled=demoRecoveries;result=await run();assert.equal(result.status,200);assert.deepEqual(responses,['existing']);assert.equal(research,0,'disabled acquisition does not make a paid lookup');assert.equal(demoRecoveries,beforeDisabled,'disabled acquisition does not recover owner research');
responses=[];enabled=true;lookupFails=false;assigned=true;result=await run();assert.equal(result.status,200);assert.deepEqual(responses,['existing','new-lead'],'new assignments still get an immediate targeted response');
responses=[];allocationFails=true;assert.equal((await run()).status,503);assert.deepEqual(responses,['existing'],'allocation failure cannot cancel existing response work');
responses=[];allocationFails=false;assigned=false;responseFails=true;assert.equal((await run()).status,503);assert.deepEqual(responses,['existing'],'failed response work is not retried in the same tick');
responses=[];responseFails=false;assigned=true;emailFails=true;result=await run();assert.equal(result.status,200);
const emailFailure=await result.json();assert.equal(emailFailure.sellerEmails.status,'seller_email_retry_pending');
assert.deepEqual(responses,['existing','new-lead'],'an email outage cannot swallow existing or immediate seller responses');
assert.equal(emailFailure.agreementRecovery.status,'recovery_idle');assert.equal(emailFailure.measurement.status,'measurement_idle');
assert(recovery>0&&measurement>0&&emails>0,'independent agreement, measurement and email work still run');
responses=[];emailFails=false;contactFails=true;result=await run();assert.equal(result.status,200);
assert.equal((await result.json()).contactRefresh.status,'contact_refresh_requires_review');
assert.deepEqual(responses,['existing','new-lead'],'contact refresh failure cannot swallow existing or immediate seller responses');
assert(demoRecoveries>0,'enabled maintenance checks for a still-fresh owner request before ordinary backlog');
responses=[];allocationEvents=[];lookupOrder=[];contactFails=false;rateLimited=true;demoRecovered=true;
result=await run();assert.equal(result.status,200);
assert.deepEqual(responses,['existing','owner-demo','new-lead'],'fresh owner assignment and response are targeted before generic allocation');
assert.deepEqual(allocationEvents,['owner-demo','generic']);
assert.deepEqual(lookupOrder,['owner','generic'],'fresh owner request gets the first lookup attempt before the backlog');
assert.deepEqual(demoAssignments,['owner-demo']);assert.equal((await result.json()).ownerDemo.leadId,'owner-demo');
assert.deepEqual(demoDispatches,['sms','voice'],'a concurrent assignment returning null still reaches original response claims');
responses=[];demoResponseAllowed=false;
result=await run();assert.equal(result.status,200);assert.deepEqual((await result.json()).ownerDemo.responses,[]);
assert.deepEqual(demoDispatches,['sms','voice'],'unassigned or refused lead has no response claim and cannot dispatch');
assert.deepEqual(responses,['existing','owner-demo','new-lead'],'refused owner work does not swallow generic work');
responses=[];demoFails=true;
result=await run();assert.equal(result.status,503);
assert.deepEqual(responses,['existing','new-lead'],'demo recovery failure does not swallow unrelated seller responses');
assert.equal((await result.json()).ownerDemo.status,'owner_demo_recovery_unavailable');
responses=[];demoFails=false;demoRecovered=false;
result=await run();assert.equal(result.status,200);assert.deepEqual(responses,['existing','new-lead']);
assert.deepEqual(demoAssignments,['owner-demo','owner-demo'],'empty/expired recovery cannot allocate or dispatch a demo');
for(const active of [false,true]){
 enabled=active;instantResult={status:'pending',failures:1};assert.equal((await run()).status,503,'Inbound failure is visible even when acquisition is disabled');
 instantResult={status:'processed',failures:0};assert.equal((await run()).status,200);
 instantThrows=true;assert.equal((await run()).status,503);instantThrows=false;
}
console.log('PASS seller maintenance: existing responses survive lookup/allocation outages and disabled acquisition; new matches are immediate; no same-tick retry or provider requests.');
