// Local-only transaction tests. No production credentials or external effects.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.argv[2]);
const db=new PGlite();
const sql=await readFile(new URL('../config/buyer-scenario-activation.sql',import.meta.url),'utf8');
await db.exec(`create schema icash_recorded_reception_private;
create table public.icash_integration_checks(provider text primary key,checked_at timestamptz,result jsonb);
create table icash_recorded_reception_private.configs(id uuid primary key,account_id uuid,owner_user_id uuid,called_number text,agent_id text,branch_id text,version_id text,config_hash text,context_policy text,context_policy_hash text,enabled boolean,reviewed_until timestamptz);
create unique index one_enabled on icash_recorded_reception_private.configs(called_number) where enabled;
create table icash_recorded_reception_private.sessions(config_id uuid,call_ended_at timestamptz,call_deadline_at timestamptz);`);
const source='11111111-1111-4111-8111-111111111111',candidate='22222222-2222-4222-8222-222222222222';
const policyHash='6fbbe513d434227c54d2b9eff0561d5739bca233dd69e87ca8fd489b057db803';
const audit={status:'passed',count:30,passedCount:30,fixtureHash:'34dfeb72b8671468924faf1612acaac07d9dce2b773c25552c4444216ed44254',policyHash,sourceConfigId:source,sourceBranchId:'agtbrch_source',sourceVersion:'agtvrsn_source',sourceConfigHash:'sourceHash',stagedConfigId:candidate,branchId:'agtbrch_fixture',version:'agtvrsn_fixture',configHash:'fixtureHash',commit:'fixtureCommit',tests:Array.from({length:30},(_,i)=>({name:'case-'+i,status:'passed',branch:'agtbrch_fixture',version:'agtvrsn_fixture'}))};
const ready={state:'READY',commit:audit.commit,deploymentId:'dpl_fixture',pricingPrivacyVerified:true};
await db.query(`insert into icash_recorded_reception_private.configs values
($1,$1,$1,'fixture-number','agent_fixture','agtbrch_source','agtvrsn_source','sourceHash','automatic_offer_v11','2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a',true,now()+interval '1 day'),
($2,$1,$1,'fixture-number','agent_fixture','agtbrch_fixture','agtvrsn_fixture','fixtureHash','automatic_offer_v13',$3,false,now()+interval '1 day')`,[source,candidate,policyHash]);
const evidence=async(a=audit,r=ready)=>{
 for(const [provider,result] of [['buyer_scenario_audit_20261009_v4',a],['buyer_scenario_application_ready_20261009_v1',r]])await db.query('insert into icash_integration_checks(provider,result) values($1,$2) on conflict(provider) do update set result=excluded.result',[provider,result]);
};
const held=async()=>{
 await assert.rejects(db.exec(sql));await db.exec('rollback;');
 assert.deepEqual((await db.query('select enabled from icash_recorded_reception_private.configs order by id')).rows.map(r=>r.enabled),[true,false]);
 assert.equal((await db.query("select count(*)::int n from icash_integration_checks where provider='buyer_scenario_policy_activation_20261009_v1'")).rows[0].n,0);
};
for(const patch of [{status:'failed'},{count:29},{passedCount:29},{fixtureHash:'wrong'},{policyHash:'wrong'},{sourceBranchId:'wrong'},{sourceVersion:'wrong'},{sourceConfigHash:'wrong'},{tests:[...audit.tests.slice(0,29),{status:'failed'}]}]){await evidence({...audit,...patch});await held();}
for(const patch of [{state:'BUILDING'},{commit:'wrong'},{pricingPrivacyVerified:false}]){await evidence(audit,{...ready,...patch});await held();}
await evidence();
await db.query('update icash_recorded_reception_private.configs set config_hash=$1 where id=$2',['changed',candidate]);await held();
await db.query('update icash_recorded_reception_private.configs set config_hash=$1 where id=$2',[audit.configHash,candidate]);
await db.query("insert into icash_recorded_reception_private.sessions values($1,null,now()+interval '5 minutes')",[source]);await held();
await db.exec('delete from icash_recorded_reception_private.sessions;');
await db.exec(sql);
assert.deepEqual((await db.query('select enabled from icash_recorded_reception_private.configs order by id')).rows.map(r=>r.enabled),[false,true]);
const activation=(await db.query("select result from icash_integration_checks where provider='buyer_scenario_policy_activation_20261009_v1'")).rows[0].result;
assert.equal(activation.status,'activated');assert.equal(activation.configId,candidate);assert.equal(activation.outreach,false);
await assert.rejects(db.exec(sql));await db.exec('rollback;');
assert.deepEqual((await db.query('select enabled from icash_recorded_reception_private.configs order by id')).rows.map(r=>r.enabled),[false,true]);
await db.close();
console.log('PASS scenario activation transaction: failed/mismatched audits, missing privacy, unready app, changed provider config and current calls cannot switch policy; exact evidence activates once. Local fixtures only.');
