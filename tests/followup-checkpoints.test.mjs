import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {processFollowupCheckpoints} from '../lib/followup-checkpoints.ts';
import {settlePendingVoiceUsage as realVoiceRecovery} from '../lib/voice-usage-service.ts';
import {followupCheckpointSetup} from './helpers/followup-checkpoint-fixture.mjs';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const account='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
let voiceHeld=true,voiceCrash=false,lostAck=false,notifyCalls=0,voiceCalls=0,estimateCalls=0,estimateResult={settled:0,held:0};const deadlines=[];
const nextTicket=async()=>{
 const id=await v("insert into icash_automation_tickets(account_id,kind,state,created_at,expires_at) values($1,'account_reconcile','consumed',now(),now()+interval '2 minutes') returning id",[account]);
 await q("update icash_work_private.account_followups set ticket_id=$1,lease_until=now()+interval '5 minutes',claimed_version=requested_version,claimed_notify_version=notify_version where account_id=$2",[id,account]);return id;
};
try{
 await pg.exec(followupCheckpointSetup());
 await q("insert into icash_accounts(id,owner_user_id,bot_paused,created_at) values($1,$1,false,now()-interval '2 days')",[account]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,300)',[account]);
 await q("insert into icash_operation_spend(operation_key,account_id,state,charge_cap_cents,created_at) values('voice:original-unknown',$1,'dispatched',300,now()-interval '1 day')",[account]);
 await q("insert into icash_operation_rates(id,operation) values($1,'seller_call')",[other]);
 await q('update icash_operation_spend set rate_id=$1',[other]);
 await q('insert into icash_work_private.account_followups(account_id,notify_version) values($1,1)',[account]);
 let ticket=await nextTicket();
 const ledger=await v('select jsonb_agg(to_jsonb(o)) from icash_operation_spend o');
 const migration=read('config/followup-step-checkpoints.sql');assert.equal(migration,read('supabase/migrations/20261114165219_followup_step_checkpoints.sql'));
 await pg.exec(migration);
 const pendingMigration=read('config/followup-pending-originals.sql');assert.equal(pendingMigration,read('supabase/migrations/20261114181243_followup_pending_originals.sql'));
 await pg.exec(pendingMigration);
 assert.deepEqual(await v('select icash_account_followup_context($1,$2)',[account,ticket]),{notify:true},'Inactive installation is compatible with the deployed handler');
 assert.equal(await v("select icash_claim_followup_step($1,$2,'estimates')",[account,ticket]),null);
 await pg.exec('update icash_work_private.followup_step_policy set enabled=true');
 const adapter=databaseAdapter(pg);
 const db=async(path,method,body,signal)=>{
  assert(signal instanceof AbortSignal);
  if(path==='rpc/icash_settle_pending_estimates'){estimateCalls++;deadlines.push(signal);return estimateResult;}
  const result=await adapter.db(path,method,body);
  if(path==='rpc/icash_finish_followup_step'&&body.p_step==='customer_updates'&&lostAck){lostAck=false;throw Error('Acknowledgment lost after durable commit');}
  return result;
 };
 const {processAutomationFollowup}=await loadService('lib/automation-followup-service.ts',{
  processFollowupCheckpoints,readVoiceUsagePolicies:()=>[],reconcileLiveConversation:async()=>assert.fail('No external call'),
  settlePendingVoiceUsage:async(_db,_account,_policies,_reconcile,signal)=>{voiceCalls++;deadlines.push(signal);if(voiceCrash)throw new DOMException('Timeout','TimeoutError');return {settled:0,held:voiceHeld?1:0,reviewRequired:0};},
  dispatchCustomerUpdate:async(_account,{signal})=>{notifyCalls++;deadlines.push(signal);return {status:'updates_idle'};},
  dispatchAttentionNotification:async()=>assert.fail('Not consented/enabled in this journey'),
 });
 process.env.ICASH_ATTENTION_EMAIL_ENABLED='false';
 lostAck=true;voiceCrash=true;
 assert.equal((await processAutomationFollowup(db,account,ticket)).status,'reconciliation_retry_due');
 assert.equal(notifyCalls,1,'A receipt-service failure does not block independent customer follow-up');
 assert.equal(new Set(deadlines).size,3,'Each service has its own bounded deadline');
 assert.equal(await v("select count(*) from icash_work_private.followup_step_attempts where completed"),2);
 const firstEvidence=await v('select jsonb_agg(to_jsonb(a) order by id) from icash_work_private.followup_step_attempts a');
 ticket=await nextTicket();voiceCrash=false;
 assert.equal((await processAutomationFollowup(db,account,ticket)).status,'reconciliation_retry_due');
 assert.equal(estimateCalls,1);assert.equal(notifyCalls,1,'Persisted successful step survives lost acknowledgment and process restart');
 assert.equal(voiceCalls,2,'Only safe original-receipt recovery is retried');
 ticket=await nextTicket();voiceHeld=false;
 assert.equal((await processAutomationFollowup(db,account,ticket)).status,'reconciliation_retry_due','Zero due voice reads cannot complete an unresolved original');
 assert.equal(await v("select count(*) from icash_work_private.followup_step_attempts where step='voice_receipts' and completed"),0);
 assert.deepEqual(await v('select jsonb_agg(to_jsonb(o)) from icash_operation_spend o'),ledger,'Cooldown retries preserve unknown original money');
 // A fixture terminal receipt closes the original separately; the checkpoint
 // observes that terminal state and never performs its financial transition.
 await q("update icash_operation_spend set state='settled' where operation_key='voice:original-unknown'");
 ticket=await nextTicket();
 assert.equal((await processAutomationFollowup(db,account,ticket)).status,'account_reconciled');
 assert.equal(voiceCalls,4);assert.equal(notifyCalls,1);
 assert.equal(await v('select reserved_cents from icash_wallets'),300);
 assert.equal(firstEvidence.length,3);
 for(const original of firstEvidence)assert.deepEqual(await v('select to_jsonb(a) from icash_work_private.followup_step_attempts a where id=$1',[original.id]),original,'History is append-only after completion');
 // New source work after a prior zero-pending observation cannot inherit the
 // prior completed version. This models the existing operation wake trigger.
 await q("insert into icash_operation_spend(operation_key,account_id,state,charge_cap_cents,created_at) values('research:new-original',$1,'dispatched',100,now())",[account]);
 await q('update icash_work_private.account_followups set requested_version=requested_version+1');
 ticket=await nextTicket();estimateResult={settled:25,held:0};
 assert.equal((await processAutomationFollowup(db,account,ticket)).status,'reconciliation_retry_due','A full successful batch does not prove remaining originals absent');
 assert.equal(estimateCalls,2,'New source version rechecks previously completed estimates');
 assert.equal(await v("select count(*) from icash_work_private.followup_step_attempts where step='estimates' and source_version=2 and completed"),0);
 for(const invalid of [null,{},0,{settled:0,held:1},{settled:-1,held:0},{settled:26,held:0}]){
  ticket=await nextTicket();estimateResult=invalid;
  assert.equal((await processAutomationFollowup(db,account,ticket)).status,'reconciliation_retry_due','Missing, malformed, held or unbounded estimate results remain incomplete');
 }
 assert.equal(await v("select state from icash_operation_spend where operation_key='research:new-original'"),'dispatched');
 assert.equal(await v('select reserved_cents from icash_wallets'),300);
 // Real helper behavior: a five-minute cooldown or missing completed
 // conversation returns zero reads. Neither is terminal proof.
 const idle=await realVoiceRecovery(async path=>{assert(path.startsWith('icash_operation_spend?'));assert(path.includes('estimate_checked_at.lte.'));return [];},account,[{enabled:true,rateId:other}],async()=>assert.fail('Not due; no provider request'));
 assert.deepEqual(idle,{settled:0,held:0,reviewRequired:0});
 await assert.rejects(pg.exec("update icash_work_private.followup_step_attempts set evidence='{}' where completed"),/immutable/);
 ticket=await nextTicket();
 assert.equal(await v("select icash_claim_followup_step($1,$2,'voice_receipts')",[other,ticket]),null,'Cross-account claim refused');
 await q("update icash_work_private.account_followups set lease_until=now()-interval '1 second'");
 assert.equal(await v("select icash_claim_followup_step($1,$2,'voice_receipts')",[account,ticket]),null,'Expired worker cannot resume');
 for(const role of ['anon','authenticated'])for(const signature of ['icash_claim_followup_step(uuid,uuid,text)','icash_account_followup_pending(uuid,uuid,text)'])assert.equal(await v("select has_function_privilege($1,$2,'execute')",[role,signature]),false);
 console.log('PASS customer recovery journey: captured SQL leases → durable per-step claim → interrupted receipt service → independent notification → lost acknowledgment → replacement ticket → safe original-receipt retry → confirmed checkpoint, with uncertain money unchanged. Synthetic providers only.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
