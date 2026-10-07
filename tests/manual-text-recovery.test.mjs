import assert from 'node:assert/strict';
import {reconcileTextAttempt,textStateLabel} from '../lib/text-send-state.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

const attempt={key:'same-request',body:'Hello',busy:false,held:true,retryable:true,status:''};
assert.equal(reconcileTextAttempt(attempt,{request_key:'another-request',state:'delivered'}),false);
assert.equal(attempt.held,true,'another message never releases an uncertain send');
assert.equal(reconcileTextAttempt(attempt,{request_key:attempt.key,state:'ready'}),false);
assert.equal(attempt.held,false,'a pre-dispatch failure unlocks the saved draft');
assert.equal(attempt.retryable,true,'retry keeps the existing request key');
attempt.held=true;
assert.equal(reconcileTextAttempt(attempt,{request_key:attempt.key,state:'needs_review'}),false);
assert.equal(attempt.held,true,'an uncertain provider result is never resent');
assert.equal(reconcileTextAttempt(attempt,{request_key:attempt.key,state:'delivered'}),true);
assert.equal(attempt.held,false);
assert.equal(reconcileTextAttempt(attempt,{request_key:attempt.key,state:'delivered'}),false,'later polls cannot erase a new identical draft');
assert.equal(textStateLabel('ready'),'Not sent');

let state='ready',reason='Spending allowance reached. Your draft is saved.';
const {customerTextStatus}=await loadService('lib/customer-text-status.ts',{
 db:async(path,method,args)=>{
  if(path.startsWith('icash_text_messages?')){assert(path.includes('account_id=eq.owned')&&path.includes('thread_id=eq.thread'));return [{state}];}
  assert.equal(path,'rpc/icash_manual_text_reason');assert.equal(args.p_exclude,'message');return reason;
 }
});
assert.deepEqual(await customerTextStatus('owned','message','thread'),{status:'message_not_sent',state:'ready',notSent:true,error:reason});
state='dispatching';assert.equal((await customerTextStatus('owned','message','thread')).notSent,undefined);
state='needs_review';assert.equal((await customerTextStatus('owned','message','thread')).status,'message_delivery_needs_review');
state='delivered';assert.equal((await customerTextStatus('owned','message','thread')).status,'message_accepted','lost HTTP acceptance is recovered from durable state');
state='ready';reason=null;assert.match((await customerTextStatus('owned','message','thread','business_number_mismatch')).error,/number is unavailable/);
console.log('PASS manual text recovery: exact-key reconciliation, safe retry, uncertain delivery hold, lost-response recovery and preserved new drafts.');
