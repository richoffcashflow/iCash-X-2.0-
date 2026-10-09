// Local candidate-staging transaction and role grants; no provider or live data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.argv[2]),db=new PGlite();
const sql=await readFile(new URL('../config/buyer-response-policy.sql',import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema icash_recorded_reception_private;
create table public.icash_integration_checks(provider text primary key,result jsonb);
create table icash_recorded_reception_private.configs(id uuid primary key,account_id uuid,owner_user_id uuid,called_number text,agent_id text,branch_id text,version_id text,config_hash text,context_policy text,context_policy_hash text,enabled boolean,reviewed_until timestamptz,version int,entry_policy text,agreement_tool_id text,stop_tool_id text,context_approval_reference text,approved_at timestamptz,created_at timestamptz,approval_reference text,
constraint configs_context_policy_check check(context_policy in ('automatic_offer_v11','automatic_offer_v12')),
constraint configs_context_binding_check check(context_policy in ('automatic_offer_v11','automatic_offer_v12')));
create unique index one_enabled on icash_recorded_reception_private.configs(called_number) where enabled;`);
for(const [name,args] of [['icash_reception_context_before_agreement','uuid,text'],['icash_reception_context_before_payoff','uuid,text'],['icash_seller_agreement_recording','text'],['icash_seller_agreement_call_context','text,text']])await db.exec(`create function public.${name}(${args}) returns jsonb language sql as $$select '{}'::jsonb from icash_recorded_reception_private.configs c where context_policy in ('automatic_offer_v11','automatic_offer_v12')$$;`);
await db.exec(sql);
const source='11111111-1111-4111-8111-111111111111',sourceHash='a'.repeat(64),hash='b'.repeat(64);
const audit={status:'failed',fixtureHash:'dff51ba4cd44652a7bef34791293d79a41a0bc25e181095c1e9c2ffc4935f1b9',code:'BUYER_SCENARIO_FAILURES_REQUIRE_FIX',count:30,tests:Array(30).fill({}),branchId:'agtbrch_source',version:'agtvrsn_source'};
await db.query(`insert into icash_recorded_reception_private.configs(id,account_id,owner_user_id,called_number,agent_id,branch_id,version_id,config_hash,context_policy,context_policy_hash,enabled,reviewed_until,version,entry_policy,agreement_tool_id,stop_tool_id,context_approval_reference) values($1,$1,$1,'fixture','agent_fixture','agtbrch_source','agtvrsn_source',$2,'automatic_offer_v11','2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a',true,now()+interval '1 day',18,'direct_recorded_v1','tool_agreement','tool_stop','Source approval')`,[source,sourceHash]);
const stage=(branch='agtbrch_candidate',version='agtvrsn_candidate',configHash=hash)=>db.query('select icash_stage_buyer_response_policy($1,$2,$3,$4) id',[source,branch,version,configHash]);
const evidence=async result=>db.query("insert into icash_integration_checks values('buyer_scenario_audit_20261009_v3',$1) on conflict(provider) do update set result=excluded.result",[result]);
await assert.rejects(stage());
for(const change of [{status:'passed'},{fixtureHash:'wrong'},{count:29},{tests:[]},{branchId:'agtbrch_changed'},{version:'agtvrsn_changed'}]){await evidence({...audit,...change});await assert.rejects(stage());}
await evidence(audit);
await assert.rejects(stage('agtbrch_source'));
await assert.rejects(stage('invalid'));
await assert.rejects(stage('agtbrch_candidate','invalid'));
await assert.rejects(stage('agtbrch_candidate','agtvrsn_candidate','wrong'));
const made=(await stage()).rows[0].id;
assert.equal((await stage()).rows[0].id,made,'Same reviewed candidate is idempotent');
await assert.rejects(stage('agtbrch_different'));
await assert.rejects(stage('agtbrch_candidate','agtvrsn_candidate','c'.repeat(64)));
const rows=(await db.query('select context_policy,enabled,branch_id,config_hash from icash_recorded_reception_private.configs order by version')).rows;
assert.deepEqual(rows,[{context_policy:'automatic_offer_v11',enabled:true,branch_id:'agtbrch_source',config_hash:sourceHash},{context_policy:'automatic_offer_v13',enabled:false,branch_id:'agtbrch_candidate',config_hash:hash}]);
for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.icash_stage_buyer_response_policy(uuid,text,text,text)','execute') allowed",[role])).rows[0].allowed,role==='service_role');
await db.close();
console.log('PASS candidate staging: exact failed evidence, immutable source, new branch fingerprint, disabled/idempotent candidate and service-only access.');
