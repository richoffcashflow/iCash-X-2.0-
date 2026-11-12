import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),v=async s=>Object.values((await pg.query(s)).rows[0]??{})[0];
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;create schema icash_learning_private;
 create table icash_operation_spend(operation_key text,account_id uuid,charge_cap_cents bigint,state text,created_at timestamptz,dispatched_at timestamptz);
 create table icash_learning_private.improvement_proposals(id bigserial primary key,category text,version int default 1,status text default 'observed',observations int default 1,last_observed_at timestamptz default now(),last_reviewed_at timestamptz default now(),evidence jsonb);
 create table icash_learning_private.proposal_events(id bigserial primary key,proposal_id bigint,status text,evidence jsonb);
 create table icash_learning_private.components(component text,last_error_at timestamptz,last_error_code text);
 create function icash_review_operations_before_cohorts() returns jsonb language sql as $$select '{"reviewed":true}'::jsonb$$;
 create function icash_review_policy_cohorts() returns jsonb language sql as $$select '{"errors":0}'::jsonb$$;
 insert into icash_operation_spend values
 ('owners:old','00000000-0000-4000-8000-000000000001',105,'dispatched',now()-interval '3 days',now()-interval '2 days'),
 ('voice:reserved','00000000-0000-4000-8000-000000000002',300,'reserved',now()-interval '2 days',null),
 ('text:fresh','00000000-0000-4000-8000-000000000001',5,'dispatched',now()-interval '2 days',now()-interval '1 hour'),
 ('voice:settled','00000000-0000-4000-8000-000000000001',500,'settled',now()-interval '3 days',now()-interval '2 days');`);
 await pg.exec(read('tests/fixtures/completion-review-before.sql'));
 await pg.exec(read('config/completion-reliability.sql').split('-- BEGIN receipt deadlines')[1].split('-- END receipt deadlines')[0]);
 const original=await v('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o');
 const result=await v('select icash_review_learning_operations()');assert.equal(result.reviewed,true);assert.deepEqual(result.policyCohorts,{errors:0});
 const evidence=await v('select evidence from icash_learning_private.improvement_proposals');
 assert.equal(evidence.operations,2);assert.equal(evidence.accounts,2);assert.equal(evidence.moneyReleased,false);assert.equal(evidence.action,'reconcile_original_receipt_only');
 assert.deepEqual(evidence.groups.map(g=>[g.kind,g.operations,g.held_cap_cents]),[['owners',1,105],['voice',1,300]]);
 await v('select icash_review_learning_operations()');assert.equal(await v('select count(*)::int from icash_learning_private.proposal_events'),1,'A 15-second scheduler creates at most one deadline observation hourly');
 assert.deepEqual(await v('select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o'),original,'A deadline does not settle, release or replay uncertain work');
 await pg.exec("update icash_operation_spend set state='settled';update icash_learning_private.improvement_proposals set last_reviewed_at=now()-interval '61 minutes'");
 await v('select icash_review_learning_operations()');assert.equal((await v('select evidence from icash_learning_private.improvement_proposals')).operations,0);
 assert.equal(await v('select count(*)::int from icash_learning_private.proposal_events'),2,'Old evidence is preserved after receipts settle independently');
 for(const role of ['anon','authenticated'])assert.equal(await v(`select has_function_privilege('${role}','icash_review_operation_deadlines()','execute')`),false);
 console.log('PASS receipt deadlines: original 24-hour clocks, provider/account aggregates, hourly durable review, late resolution history, unchanged spend and existing policy review.');
}finally{await pg.close();}
