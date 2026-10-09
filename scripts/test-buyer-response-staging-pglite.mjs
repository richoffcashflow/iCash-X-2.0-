// Local candidate-staging transaction and role grants; no provider or live data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.argv[2]),db=new PGlite();
const conversation=process.argv[3]==='conversation',turn=conversation||process.argv[3]==='turn',policy=conversation?'automatic_offer_v15':turn?'automatic_offer_v14':'automatic_offer_v13',fn=conversation?'icash_stage_buyer_conversation_policy':turn?'icash_stage_buyer_turn_policy':'icash_stage_buyer_response_policy',marker=conversation?'buyer_scenario_audit_20261009_v5':turn?'buyer_scenario_audit_20261009_v4':'buyer_scenario_audit_20261009_v3';
const sql=await readFile(new URL(conversation?'../config/buyer-conversation-policy.sql':turn?'../config/buyer-turn-policy.sql':'../config/buyer-response-policy.sql',import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema icash_recorded_reception_private;
create table public.icash_integration_checks(provider text primary key,result jsonb);
create table icash_recorded_reception_private.configs(id uuid primary key,account_id uuid,owner_user_id uuid,called_number text,agent_id text,branch_id text,version_id text,config_hash text,context_policy text,context_policy_hash text,enabled boolean,reviewed_until timestamptz,version int,entry_policy text,agreement_tool_id text,stop_tool_id text,context_approval_reference text,approved_at timestamptz,created_at timestamptz,approval_reference text,
constraint configs_context_policy_check check(context_policy in ('automatic_offer_v11','automatic_offer_v12')),
constraint configs_context_binding_check check(context_policy in ('automatic_offer_v11','automatic_offer_v12')));
create table icash_recorded_reception_private.sessions(config_id uuid,account_id uuid,stop_token_hash text,conversation_id text);
create table fixture_scope(value jsonb);insert into fixture_scope values('{"party":"buyer"}');
create function public.icash_call_offer_context(text,text) returns jsonb language sql as $$select value from public.fixture_scope$$;
create unique index one_enabled on icash_recorded_reception_private.configs(called_number) where enabled;`);
for(const [name,args] of [['icash_reception_context_before_agreement','uuid,text'],['icash_reception_context_before_payoff','uuid,text'],['icash_seller_agreement_recording','text'],['icash_seller_agreement_call_context','text,text']])await db.exec(`create function public.${name}(${args}) returns jsonb language sql as $$select '{}'::jsonb from icash_recorded_reception_private.configs c where context_policy in ('automatic_offer_v11','automatic_offer_v12'${conversation?",'automatic_offer_v13','automatic_offer_v14'":turn?",'automatic_offer_v13'":''})$$;`);
await db.exec(sql);
const source='11111111-1111-4111-8111-111111111111',sourceHash='a'.repeat(64),hash='b'.repeat(64);
const audit={status:'failed',fixtureHash:conversation?'d1012080ea3ac92001d5467ed78c4c5e81f929131f2671b3e41ba30658a1b1ea':turn?'34dfeb72b8671468924faf1612acaac07d9dce2b773c25552c4444216ed44254':'dff51ba4cd44652a7bef34791293d79a41a0bc25e181095c1e9c2ffc4935f1b9',code:'BUYER_SCENARIO_FAILURES_REQUIRE_FIX',count:30,tests:Array(30).fill({}),branchId:'agtbrch_source',version:'agtvrsn_source',sourceBranchId:'agtbrch_source',sourceVersion:'agtvrsn_source',sourceConfigHash:sourceHash};
await db.query(`insert into icash_recorded_reception_private.configs(id,account_id,owner_user_id,called_number,agent_id,branch_id,version_id,config_hash,context_policy,context_policy_hash,enabled,reviewed_until,version,entry_policy,agreement_tool_id,stop_tool_id,context_approval_reference) values($1,$1,$1,'fixture','agent_fixture','agtbrch_source','agtvrsn_source',$2,'automatic_offer_v11','2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a',true,now()+interval '1 day',18,'direct_recorded_v1','tool_agreement','tool_stop','Source approval')`,[source,sourceHash]);
const stage=(branch='agtbrch_candidate',version='agtvrsn_candidate',configHash=hash)=>db.query(`select ${fn}($1,$2,$3,$4) id`,[source,branch,version,configHash]);
const evidence=async result=>db.query('insert into icash_integration_checks values($1,$2) on conflict(provider) do update set result=excluded.result',[marker,result]);
await assert.rejects(stage());
for(const change of [{status:'passed'},{fixtureHash:'wrong'},{count:29},{tests:[]},...(turn?[{sourceBranchId:'agtbrch_changed'},{sourceVersion:'agtvrsn_changed'},{sourceConfigHash:'wrong'}]:[{branchId:'agtbrch_changed'},{version:'agtvrsn_changed'}])]){await evidence({...audit,...change});await assert.rejects(stage());}
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
assert.deepEqual(rows,[{context_policy:'automatic_offer_v11',enabled:true,branch_id:'agtbrch_source',config_hash:sourceHash},{context_policy:policy,enabled:false,branch_id:'agtbrch_candidate',config_hash:hash}]);
for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query(`select has_function_privilege($1,'public.${fn}(uuid,text,text,text)','execute') allowed`,[role])).rows[0].allowed,role==='service_role');
if(conversation){
 const context=async(hash='fixture',id='conv_fixture')=>(await db.query('select icash_call_offer_context($1,$2) value',[hash,id])).rows[0].value;
 assert.deepEqual(await context(),{party:'buyer'});
 await db.query('insert into icash_recorded_reception_private.sessions values($1,$2,$3,$4)',[source,source,'fixture','conv_fixture']);
 assert.deepEqual(await context(),{party:'buyer'},'Legacy sessions retain their data');
 await db.query('update icash_recorded_reception_private.sessions set config_id=$1',[made]);
 assert.deepEqual(await context(),{party:'buyer',contextPolicy:'automatic_offer_v15'});
 assert.deepEqual(await context('wrong'),{party:'buyer'},'Unmatched capability does not select new policy');
 await db.exec("update fixture_scope set value='null'::jsonb");assert.equal(await context(),null);
 await db.exec("update fixture_scope set value='{\"party\":\"seller\"}'::jsonb");assert.deepEqual(await context(),{party:'seller'});
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.icash_call_offer_context(text,text)','execute') allowed",[role])).rows[0].allowed,role==='service_role');
}
await db.close();
console.log('PASS candidate staging: exact failed evidence, immutable source, new branch fingerprint, disabled/idempotent candidate and service-only access.');
