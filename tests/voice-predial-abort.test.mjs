import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {finishVoicePredialAbort} from '../lib/voice-predial-abort.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration='supabase/migrations/20261103041152_voice_predial_abort.sql';
assert.equal(read(migration),read('config/voice-predial-abort.sql'));
let writes=[];
const input={accountId:'a',jobId:'j',automation:{ticketId:'t',token:'cap'},dispatchedAt:new Date().toISOString(),result:{status:'recording_review_required',dispatchBoundary:'before_recording_create_v1'}};
const db=async(path,method,body,signal)=>{writes.push({path,method,body});assert(signal instanceof AbortSignal);return true;};
assert.equal(await finishVoicePredialAbort(db,input),true);assert.equal(writes.length,1);
for(const patch of [{automation:undefined},{dispatchedAt:null},{result:{status:'recording_review_required'}},{result:{status:'recording_dial_unknown_no_retry',dispatchBoundary:'before_recording_create_v1'}},{result:{status:'recording_admission_held',dispatchBoundary:'before_recording_create_v1'}}]){
 writes=[];assert.equal(await finishVoicePredialAbort(db,{...input,...patch}),false);assert.equal(writes.length,0);
}
assert.equal(await finishVoicePredialAbort(async()=>{throw Error('lost response');},input),false);
const pg=new PGlite();await pg.exec(read('tests/fixtures/voice-predial-foundation.sql'));
await pg.exec(read('tests/fixtures/voice-predial-settle-baseline.sql'));
await pg.exec(read('tests/fixtures/voice-predial-create-baseline.sql'));
await pg.exec(read('config/voice-predial-abort.sql'));
const seed=async n=>(await pg.query('select fixture_predial_seed($1) as row',[n])).rows[0].row;
const finish=async(f,patch={})=>(await pg.query('select icash_finish_voice_predial_abort($1,$2,$3,$4,$5,$6,$7) as ok',Object.values({...{account:f.account,job:f.job,ticket:f.ticket,token:f.token,dispatchedAt:f.dispatchedAt,reason:'recording_review_required',boundary:'before_recording_create_v1'},...patch}))).rows[0].ok;
const callArgs=f=>[f.account,f.operation,'AC'+'a'.repeat(32),null,'b'.repeat(64),'c'.repeat(64),'fixture-disclosure',JSON.stringify({version:'required-audio-30d-speech-v1',retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true}),JSON.stringify({fromPhone:'+12025550101',branchId:'agtbrch_fixture',versionId:'agtvrsn_fixture',maxTotalSeconds:600})];
const create=async f=>(await pg.query('select icash_create_direct_recorded_call($1,$2,$3,$4,$5,$6,$7,$8,$9) as row',callArgs(f))).rows[0].row;
let f=await seed(1);assert.equal(await finish(f),true);assert.equal(await finish(f),true);assert.equal(await finish(f,{reason:'recording_release_required'}),false);
assert.equal((await pg.query('select count(*)::int n from fixture_credit_finishes')).rows[0].n,1);
assert.equal((await pg.query('select status from icash_credit_reservations where id=$1',[f.reservation])).rows[0].status,'released');
assert.equal(await create(f),null,'A late original create cannot dial after the atomic abort');
await assert.rejects(pg.exec('delete from icash_recording_private.predial_aborts'),/Immutable/);
f=await seed(2);assert(await create(f));assert.equal(await finish(f),false,'A created record retains its cap before dial is known');
for(const [n,change] of [[3,"update icash_automation_tickets set expires_at=now()-interval '1 second' where id=$1"],[4,"update icash_automation_tickets set state='held' where id=$1"],[5,"update icash_automation_tickets set completed_at=now() where id=$1"],[6,"update icash_automation_tickets set outcome='held_for_reconciliation' where id=$1"]]){
 f=await seed(n);await pg.query(change,[f.ticket]);assert.equal(await finish(f),false);
}
for(const [n,change] of [[7,"insert into icash_live_conversations(operation_key) values($1)"],[8,"insert into icash_cost_observations(source_ref) values($1)"],[9,"insert into icash_cost_observations(source_ref) values($1||':late')"],[10,"insert into icash_recording_private.capacity_quarantines values($1)"]]){
 f=await seed(n);await pg.query(change,[f.operation]);assert.equal(await finish(f),false);
}
f=await seed(11);await pg.query("update icash_voice_jobs set provider_call_sid='CA'||repeat('d',32) where id=$1",[f.job]);assert.equal(await finish(f),false);
f=await seed(12);await pg.query("update icash_voice_jobs set conversation_id='conv_late' where id=$1",[f.job]);assert.equal(await finish(f),false);
f=await seed(13);for(const patch of [{token:'0'.repeat(72)},{job:f.ticket},{dispatchedAt:new Date(0).toISOString()},{reason:'provider_outcome_unknown_no_retry'},{boundary:'after_claim_dial'}])assert.equal(await finish(f,patch),false);
for(const [n,change] of [[14,"insert into icash_cost_manifests values($1)"],[15,"insert into icash_private.provider_costs values($1)"],[16,"insert into icash_cost_observations(event_key) values($1||':late')"]]){f=await seed(n);await pg.query(change,[f.operation]);assert.equal(await finish(f),false);}
f=await seed(17);assert.equal(await finish(f),true);await pg.query('insert into icash_private.provider_costs values($1)',[f.operation]);assert.equal(await finish(f),false,'Idempotent acknowledgment does not hide contradictory later evidence');
f=await seed(18);await pg.exec('update fixture_margin set allowed=false');assert.equal(await finish(f),true);assert.equal((await pg.query('select bot_paused from icash_accounts where id=$1',[f.account])).rows[0].bot_paused,true,'Current account-margin policy is preserved by abort settlement');
for(const role of ['anon','authenticated'])assert.equal((await pg.query("select has_function_privilege($1,'public.icash_finish_voice_predial_abort(uuid,uuid,uuid,text,timestamptz,text,text)','execute') allowed",[role])).rows[0].allowed,false);
await pg.close();
console.log('PASS prospective pre-dial abort: exact current handler/source, immutable proof, original credit release once, late real recording create excluded, stale/missing/unknown provider evidence retains holds.');
