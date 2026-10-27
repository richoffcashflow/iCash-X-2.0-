import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
let context={notify:true},failure=null,ack=true;const calls=[],signals=[];
process.env.ICASH_ATTENTION_EMAIL_ENABLED='true';
const db=async(path,method,body,signal)=>{
 calls.push({path,body,signal});assert(signal instanceof AbortSignal);
 if(path==='rpc/icash_account_followup_context')return context;
 if(path==='rpc/icash_finish_account_followup')return ack;
 if(path==='rpc/icash_settle_pending_estimates'){if(failure==='estimates')throw Error('temporary');return 0;}
 throw Error('Unexpected fixture path');
};
const {processAutomationFollowup}=await loadService('lib/automation-followup-service.ts',{
 readVoiceUsagePolicies:()=>[],reconcileLiveConversation:async()=>assert.fail('No actual provider calls'),
 settlePendingVoiceUsage:async(database,account,_policies,_reconcile,signal)=>{
  assert.equal(account,'account');signals.push(signal);if(failure==='voice')throw new DOMException('Timeout','TimeoutError');
  return {settled:0,held:1,reviewRequired:failure==='review'?1:0};
 },
 dispatchCustomerUpdate:async(account,{signal})=>{assert.equal(account,'account');signals.push(signal);if(failure==='update')throw Error('temporary');return {status:'updates_idle'};},
 dispatchAttentionNotification:async(account,{signal})=>{assert.equal(account,'account');signals.push(signal);if(failure==='attention')throw Error('temporary');return {status:'attention_held'};},
});
for(failure of [null,'estimates','voice','review','update','attention']){
 calls.length=0;signals.length=0;
 const result=await processAutomationFollowup(db,'account','ticket');
 assert.equal(result.status,failure?'reconciliation_retry_due':'account_reconciled');
 const final=calls.at(-1);assert.equal(final.path,'rpc/icash_finish_account_followup');
 assert.deepEqual(final.body,{p_account:'account',p_ticket:'ticket',p_success:!failure});
 assert.notEqual(final.signal,signals[0],'the durable acknowledgment has an independent deadline');
 assert(signals.every(s=>s===signals[0]),'bounded provider work shares one deadline');
 assert.equal(calls.filter(c=>c.path==='rpc/icash_finish_account_followup').length,1);
}
failure=null;context={notify:false};signals.length=0;await processAutomationFollowup(db,'account','ticket');assert.equal(signals.length,1,'receipt-only recovery never sends optional notices');
context={notify:true};process.env.ICASH_ATTENTION_EMAIL_ENABLED='false';signals.length=0;await processAutomationFollowup(db,'account','ticket');assert.equal(signals.length,2);
context=null;calls.length=0;await assert.rejects(processAutomationFollowup(db,'other','ticket'),/LEASE_CHANGED/);assert.equal(calls.length,1,'stale or mismatched claims cannot reach settlement or notifications');
context={notify:false};ack=false;await assert.rejects(processAutomationFollowup(db,'account','stale'),/LEASE_CHANGED/);
console.log('Account follow-up: exact lease, bounded independent recovery, durable failure cooldown, original held receipts, optional notifications and stale-worker rejection passed. Offline only.');
