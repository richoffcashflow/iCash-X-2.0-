import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {setup,fixture,migration} from './helpers/seller-call-source-fixture.mjs';
import {sellerCallSource} from '../lib/seller-call-source.ts';
import {liveConversationResult} from '../lib/deal-conversation.ts';
import {sellerMemoryInboundTurns} from '../lib/seller-memory.ts';
import {object} from '../lib/required-call-recording.ts';
import {RecordingProviderError} from '../lib/required-call-recording-provider.ts';
globalThis.fetch=async()=>{throw Error('NO NETWORK: original-provider fixtures');};
const pg=await PGlite.create();await setup(pg);await pg.exec(migration);const f=await fixture(pg);await f.activate();
const long='Talk to a person. '+('Keep every original word. '.repeat(600));
const original=await f.outbound([{role:'agent',message:'Anything else?',time_in_call_secs:1},{role:'user',message:long,time_in_call_secs:2}],{state:'waiting'});
original.raw.analysis={};original.raw.metadata.call_duration_secs=3;original.raw.metadata.cost_fiat=.01234;
const events=[],usage=[];let gets=0,prepared=0,settles=0;
const live=await loadService('lib/live-conversation-service.ts',{
 sellerCallSource,liveConversationResult,readVoiceUsagePolicies:()=>[],
 database:async(path,method,body)=>{
  if(path.startsWith('icash_live_conversations?'))return (await f.query('select conversation_id,agent_id,party,state,operation_key from public.icash_live_conversations where id=$1 and account_id=$2',[original.id,f.account])).rows;
  if(path==='rpc/icash_record_cost_observation'){usage.push(structuredClone(body));events.push('usage:'+body.p_provider);return true;}
  if(path==='rpc/icash_save_live_result_with_source'){events.push('save-source');return f.rpc(path.slice(4),body);}
  throw Error('UNEXPECTED_DATABASE_PATH '+path);
 },
 elevenRequest:async(path,options)=>{assert.equal(path,'/v1/convai/conversations/'+original.raw.conversation_id);assert.equal(options,undefined);gets++;return structuredClone(original.raw);},
 prepareCompletedSellerDraft:async()=>{prepared++;assert.equal((await f.query('select state from public.icash_live_conversations where id=$1',[original.id])).rows[0].state,'complete');return {status:'draft_unchanged'};},
 settleBoundVoiceUsage:async()=>{settles++;events.push('settle');assert(usage.some(x=>x.p_provider==='elevenlabs'&&x.p_amount===.01234));return {status:'held',reason:'fixture_original_cost_review'};},
});
await pg.exec("create function icash_seller_call_source_private.fail_capture_fixture() returns trigger language plpgsql as $$begin raise exception 'capture fixture unavailable';end $$;create trigger fail_capture before insert on icash_seller_call_source_private.sources for each row execute function icash_seller_call_source_private.fail_capture_fixture()");
await assert.rejects(live.reconcileLiveConversation(f.account,original.id),/capture fixture unavailable/);
assert.equal(prepared,0);assert.equal(settles,1);assert.equal(gets,1);assert.equal(events.at(-1),'settle');
assert.deepEqual(usage.map(x=>[x.p_provider,x.p_event,x.p_source,x.p_amount]),[
 ['elevenlabs_duration',original.raw.conversation_id,'voice:'+original.id,3],['elevenlabs',original.raw.conversation_id,'voice:'+original.id,.01234],
]);
assert.equal((await f.query('select state from public.icash_live_conversations where id=$1',[original.id])).rows[0].state,'waiting','source failure cannot leave completed transcript without its evidence');
await pg.exec('drop trigger fail_capture on icash_seller_call_source_private.sources');
assert.equal((await live.reconcileLiveConversation(f.account,original.id)).billing.reason,'fixture_original_cost_review');
assert.equal(gets,2,'ordinary retry GET reads the same original, not a new provider operation');assert.equal(prepared,1);
assert.equal((await f.context()).conversations.find(c=>c.sourceId==='call:'+original.id).transcript[1].message,long);
await live.reconcileLiveConversation(f.account,original.id);assert.equal(gets,2,'completed original does not add a raw-source backfill GET');

const incoming=await f.inbound([{role:'user',message:long,time_in_call_secs:1}]);const row={id:incoming.id,account_id:f.account,operation_key:'fixture-original',provider_account_sid:'ACfixture',
 call_sid:'CAfixture',recording_sid:'REfixture',conversation_id:incoming.raw.conversation_id,agent_id:'agent_fixture',state:'deleted',row_version:1,
 register_claimed_at:'2026-01-01T00:00:00Z',call_ended_at:'2026-01-01T00:01:00Z',end_requested_at:'2026-01-01T00:01:00Z',reconcile_lease_token:'fixture-lease'};
let incomingReads=0,failCapture=false;const order=[];
const reception=await loadService('lib/recorded-reception-maintenance.ts',{
 object,RecordingProviderError,sellerMemoryInboundTurns,sellerCallSource,recordingAuthorized:()=>true,
 incomingCallIdentityMatches:()=>true,receptionRecordingMatches:()=>true,receptionConversationMatches:()=>true,
 getRecordedReception:async()=>row,bindRecordedReceptionCallStart:async()=>row,
 transitionRecordedReception:async()=>{throw Error('UNEXPECTED_ORIGINAL_TRANSITION');},endRecordedReception:async()=>{throw Error('NO_PROVIDER_WRITES');},
 finalRecordingPayload:()=>{throw Error('UNEXPECTED_RECORDING_READ');},
 settleRecordedReception:async()=>{order.push('settle');return {settled:true};},
});
const rpc=async(name,body)=>{
 if(name==='icash_claim_recorded_reception_work')return body.p_kind==='reconcile'?[row]:[];
 if(name==='icash_capture_seller_call_source'){order.push('capture');assert.equal(body.p_source,incoming.id);assert.equal(JSON.parse(body.p_evidence.rawJson)[0].message,long);return failCapture?false:f.rpc(name,body);}
 if(name==='icash_finish_recorded_reception_work'){order.push('finish:'+body.p_outcome);return row;}
 throw Error('UNEXPECTED_RECEPTION_RPC '+name);
};
const provider={getCall:async()=>({status:'completed'}),conversation:async id=>{assert.equal(id,incoming.raw.conversation_id);incomingReads++;return incoming.raw;}};
let result=await reception.maintainRecordedReception(rpc,provider,{TWILIO_ACCOUNT_SID:'ACfixture'});
assert.equal(result.settled,1);assert.equal(result.reconciled,1);assert.equal(result.held,0);assert.deepEqual(order,['settle','capture','finish:checked']);
assert.equal((await f.context()).conversations.find(c=>c.sourceId==='reception:'+incoming.id).transcript[0].message,long,'all-long incoming quote survives even when legacy filtered history is empty');
order.length=0;failCapture=true;result=await reception.maintainRecordedReception(rpc,provider,{TWILIO_ACCOUNT_SID:'ACfixture'});
assert.equal(result.settled,1);assert.equal(result.held,1);assert.deepEqual(order,['settle','capture','finish:retry']);assert.equal(incomingReads,2);
await pg.close();console.log('seller-call-source-maintenance passed: actual service→SQL original save, preserved usage observations/settlement attempt, same-call retry and inbound whole-source capture after settlement.');
