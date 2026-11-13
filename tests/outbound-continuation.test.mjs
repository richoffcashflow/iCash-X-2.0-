import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {processSellerResponses} from '../lib/seller-response-service.ts';

await test('5,832 seller batch fault combinations preserve independent progress and one attempt per channel',async()=>{
 // Three sellers, each with independent SMS/call accepted, held or thrown
 // results, crossed with every subset of failed bookkeeping receipts.
 // These are fault combinations, not 5,832 different bugs or live contacts.
 let checked=0;
 for(let channels=0;channels<3**6;channels++)for(let receipts=0;receipts<2**3;receipts++){
  const dispatched=[],notes=[];
  const work=[1,2,3].map(n=>({leadId:'lead-'+n,accountId:'account-'+n,smsMessageId:'sms-'+n,voiceJobId:'voice-'+n,status:'queued'}));
  const outcome=(channel,lead)=>Math.floor(channels/3**((lead-1)*2+(channel==='voice'?1:0)))%3;
  const status=(channel,mode)=>mode===2?'dispatch_requires_review':mode===1?(channel==='sms'?'message_delivery_needs_review':'provider_outcome_unknown_no_retry'):channel==='sms'?'message_accepted':'call_started';
  const db=async(path,_method,body)=>{
   if(path==='rpc/icash_prepare_seller_responses')return work;
   notes.push({...body,path});
   const lead=Number(body.p_lead.split('-')[1]);
   if(receipts&(1<<(lead-1)))throw Error('Fixture bookkeeping failure');
  };
  const dispatch=channel=>async(account,id)=>{dispatched.push({account,id});const mode=outcome(channel,Number(id.split('-')[1]));if(mode===2)throw Error('Fixture unknown provider outcome');return {status:status(channel,mode)};};
  const pending=processSellerResponses(db,dispatch('sms'),dispatch('voice'));
  if(receipts)await assert.rejects(pending,/SELLER_RESPONSE_RECEIPT_PENDING/);
  else{const result=await pending;assert.equal(result.length,3);for(let i=0;i<3;i++)assert.deepEqual(result[i],{leadId:work[i].leadId,status:'queued',...notes[i].p_outcome});}
  assert.equal(dispatched.length,6);assert.equal(new Set(dispatched.map(x=>x.id)).size,6);
  assert.deepEqual(notes.map(n=>n.p_lead),['lead-1','lead-2','lead-3']);
  for(let lead=1;lead<=3;lead++){
   assert.equal(notes[lead-1].path,'rpc/icash_note_seller_response');
   assert.equal(notes[lead-1].p_account,'account-'+lead);
   assert.deepEqual(notes[lead-1].p_outcome,{sms:status('sms',outcome('sms',lead)),voice:status('voice',outcome('voice',lead))});
  }
  assert(dispatched.every(x=>x.account==='account-'+x.id.split('-')[1]));
  checked++;
 }
 assert.equal(checked,5832);
});

await test('buyer network uses its full bounded batch after failures and keeps remaining work due',async()=>{
 const oldReady=process.env.ICASH_LIVE_WORK_READY;process.env.ICASH_LIVE_WORK_READY='true';
 try{
  for(const failure of ['queue','dispatch','held','null'])for(const position of [0,1,2]){
   const queued=[],sent=[];const targets=Array.from({length:5},(_,n)=>({id:'match-'+n}));
   const service=await loadService('lib/buyer-network-service.ts',{
    dealEmailConfigured:()=>true,
    db:async(path,_method,body)=>{
     if(path==='rpc/icash_vip_features_active')return true;
     if(path==='rpc/icash_network_match_deal')return 5;
     if(path==='rpc/icash_network_email_targets')return targets;
     assert.equal(path,'rpc/icash_network_queue_email');assert.equal(body.p_account,'account');queued.push(body.p_match);
     if(body.p_match==='match-'+position){if(failure==='queue')throw Error('Fixture queue unavailable');if(failure==='null')return null;}
     return body.p_match;
    },
    dispatchDealEmail:async(account,id)=>{assert.equal(account,'account');sent.push(id);if(id==='match-'+position){if(failure==='dispatch')throw Error('Fixture unknown send');if(failure==='held')return {status:'email_held'};}return {status:'email_accepted'};},
   });
   const result=await service.processBuyerNetwork('account','deal');
   assert.deepEqual(queued,['match-0','match-1','match-2']);assert.equal(result.accepted,2);
   assert.equal(result.canContinue,true,'Remaining independent buyers must get another scheduled pass');
   assert.equal(new Set(sent).size,sent.length);assert(sent.length<=3);
  }
 }finally{if(oldReady===undefined)delete process.env.ICASH_LIVE_WORK_READY;else process.env.ICASH_LIVE_WORK_READY=oldReady;}
});

await test('returned notification failures cannot mark account recovery complete',async()=>{
 const oldAttention=process.env.ICASH_ATTENTION_EMAIL_ENABLED;process.env.ICASH_ATTENTION_EMAIL_ENABLED='true';
 try{
  for(const failed of ['updates','attention']){
   const finishes=[],calls=[];
   const service=await loadService('lib/automation-followup-service.ts',{
    readVoiceUsagePolicies:()=>[],reconcileLiveConversation:()=>assert.fail('No provider calls'),
    settlePendingVoiceUsage:async()=>({settled:0,held:0,reviewRequired:0}),
    dispatchCustomerUpdate:async()=>{calls.push('updates');return {status:failed==='updates'?'updates_needs_review':'updates_accepted'};},
    dispatchAttentionNotification:async()=>{calls.push('attention');return {status:failed==='attention'?'attention_needs_review':'attention_accepted'};},
   });
   const db=async(path,_method,body)=>{
    if(path==='rpc/icash_account_followup_context')return {notify:true};
    if(path==='rpc/icash_settle_pending_estimates')return 0;
    assert.equal(path,'rpc/icash_finish_account_followup');finishes.push(body);return true;
   };
   assert.equal((await service.processAutomationFollowup(db,'account','ticket')).status,'reconciliation_retry_due');
   assert.deepEqual(calls,['updates','attention']);assert.equal(finishes.length,1);assert.equal(finishes[0].p_success,false);
  }
 }finally{if(oldAttention===undefined)delete process.env.ICASH_ATTENTION_EMAIL_ENABLED;else process.env.ICASH_ATTENTION_EMAIL_ENABLED=oldAttention;}
});
