import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {validOwnerCostEvidence} from '../lib/owner-cost-evidence.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_funding_orders(account_id uuid,mode text,state text);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,actual_micros bigint,settled_at timestamptz default now()-interval '1 second');
 create table icash_cost_manifests(operation_key text primary key,actual_micros bigint,components jsonb);
 create table icash_cost_observations(provider text,event_key text,amount numeric,units text,primary key(provider,event_key));`);
 await pg.exec(read('config/owner-cost-evidence.sql'));
 assert.equal(read('config/owner-cost-evidence.sql'),read('supabase/migrations/20261101214850_owner_cost_evidence.sql'));
 await q('insert into icash_accounts values($1,$2),($3,$4),($5,$6)',[uid(1),uid(11),uid(2),owner,uid(3),uid(13)]);
 await q("insert into icash_funding_orders values($1,'test','paid')",[uid(3)]);
 for(const [key,account,state,cost,components] of [
  ['dm',uid(1),'settled',300,{dealmachine:{amountMicros:200,basis:'estimated'},vercel:{amountMicros:100}}],
  ['voice',uid(1),'settled',100,{elevenlabs:{amountMicros:100,basis:'verified'}}],
  ['pending',uid(1),'dispatched',900,{twilio:{amountMicros:900,basis:'verified'}}],
  ['owner',uid(2),'settled',800,{twilio:{amountMicros:800,basis:'verified'}}],
  ['test',uid(3),'settled',500,{llm:{amountMicros:500,basis:'verified'}}],
 ]){await q('insert into icash_operation_spend(operation_key,account_id,state,actual_micros) values($1,$2,$3,$4)',[key,account,state,cost]);await q('insert into icash_cost_manifests values($1,$2,$3)',[key,cost,components]);}
 for(const [key,amount] of [['dm',20],['dm:people',12],['dm:deduplicated',5],['pending',100],['test',500]])await q("insert into icash_cost_observations values('dealmachine',$1,$2,'provider_credits')",[key,amount]);
 const report=async(include=false)=>one('select icash_owner_cost_evidence($1,30,$2)',[owner,include]);
 let r=await report();assert(validOwnerCostEvidence(r,{days:30,includeOwner:false}));
 assert.equal(r.recordedCostMicros,400);assert.equal(r.verifiedMicros,100);assert.equal(r.estimatedMicros,200);assert.equal(r.unclassifiedMicros,100);assert.equal(r.dealmachineCredits,20,'only the canonical settled observation counts; people/duplicate subtotals and pending/test rows do not');assert.equal(r.completedCount,2);assert.equal(r.missingManifestCount,0);assert.equal(r.mismatchedManifestCount,0);
 assert.equal((await report(true)).verifiedMicros,900,'owner switch affects the exact account scope');
 await q("insert into icash_operation_spend(operation_key,account_id,state,actual_micros) values('missing',$1,'settled',45)",[uid(1)]);
 await pg.exec("update icash_cost_manifests set actual_micros=301 where operation_key='dm'");
 r=await report();assert.equal(r.missingManifestCount,1);assert.equal(r.mismatchedManifestCount,1);assert.equal(r.recordedCostMicros,445);assert(validOwnerCostEvidence(r,{days:30,includeOwner:false}),'incomplete evidence is shown explicitly, not silently relabeled verified');
 for(const patch of [{verifiedMicros:999},{dealmachineCredits:-1},{providers:[...r.providers,r.providers[0]]},{includeOwner:true},{mismatchedManifestCount:999},{providers:[{provider:'unknown',verifiedMicros:0,estimatedMicros:0,unclassifiedMicros:0}]}])assert.equal(validOwnerCostEvidence({...r,...patch},{days:30,includeOwner:false}),false);
 await assert.rejects(one('select icash_owner_cost_evidence($1,30,false)',[uid(11)]),/Owner required/);
 await assert.rejects(one('select icash_owner_cost_evidence($1,999,false)',[owner]),/Invalid report filters/);
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_owner_cost_evidence(uuid,integer,boolean)','execute')",[role]),false);
 // A zero-dollar settlement alone is not proof of no provider activity.
 await pg.exec(`create schema icash_recording_private;create schema icash_private;
 alter table icash_operation_spend add dispatched_at timestamptz,add charged_cents bigint,add settlement_evidence text;
 alter table icash_cost_observations add source_ref text;
 create table icash_recording_private.predial_aborts(operation_key text,account_id uuid,job_id uuid,ticket_id uuid,dispatched_at timestamptz,boundary text,created_at timestamptz,reason text);
 create table icash_voice_jobs(id uuid,account_id uuid,operation_key text,state text,outcome text,provider_call_sid text,conversation_id text);
 create table icash_call_recordings(operation_key text,voice_job_id uuid);
 create table icash_live_conversations(operation_key text);
 create table icash_private.provider_costs(operation_key text);`);
 await pg.exec(read('config/completion-reliability.sql').split('-- BEGIN no-dispatch cost evidence')[1].split('-- END no-dispatch cost evidence')[0]);
 const operation='voice:'+uid(100),ticket=uid(101),reason='business_number_verification_required';
 await q("insert into icash_operation_spend(operation_key,account_id,state,actual_micros,dispatched_at,charged_cents,settlement_evidence) values($1,$2,'settled',0,now()-interval '1 minute',0,$3)",[operation,uid(1),'voice-predial-abort-v1:'+ticket+':'+reason]);
 assert.equal((await report()).missingManifestCount,2,'A bare zero-dollar row remains missing evidence');
 await q("insert into icash_voice_jobs values($1,$2,$3,'held',$4,null,null)",[uid(100),uid(1),operation,reason]);
 await q("insert into icash_recording_private.predial_aborts select operation_key,account_id,$2,$3,dispatched_at,'before_recording_create_v1',now(),$4 from icash_operation_spend where operation_key=$1",[operation,uid(100),ticket,reason]);
 const ledger=await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o');
 r=await report();assert.equal(r.verifiedNoDispatchCount,1);assert.equal(r.missingManifestCount,1);assert(validOwnerCostEvidence(r,{days:30,includeOwner:false}));
 for(const mutation of [
  "update icash_recording_private.predial_aborts set account_id='"+uid(2)+"'",
  "update icash_recording_private.predial_aborts set dispatched_at=now()",
  "update icash_recording_private.predial_aborts set boundary='unknown'",
  "update icash_operation_spend set charged_cents=1 where operation_key='"+operation+"'",
  "update icash_voice_jobs set provider_call_sid='late-provider-call'",
  "insert into icash_call_recordings values('"+operation+"','"+uid(100)+"')",
  "insert into icash_live_conversations values('"+operation+"')",
  "insert into icash_private.provider_costs values('"+operation+"')",
  "insert into icash_cost_observations(provider,event_key,amount,units) values('twilio','"+operation+":late',1,'usd')",
 ]){await pg.exec('begin;'+mutation);assert.equal((await report()).verifiedNoDispatchCount,0,mutation);assert.equal((await report()).missingManifestCount,2);await pg.exec('rollback');}
 assert.deepEqual(await one('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o'),ledger,'Reporting never rewrites zero settlements or manufactures manifests');
 for(const role of ['anon','authenticated'])assert.equal(await one("select has_function_privilege($1,'icash_verified_predial_no_cost(text)','execute')",[role]),false);
 console.log('Owner cost evidence: canonical credits, receipt/estimate separation, scope, missing/mismatched costs and private access verified.');
}finally{await pg.close();}
