"""Exact production observers/selectors on the fixed isolated CI PostgreSQL 17.

No configurable database URL, provider requests, real customer data or secrets.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]

def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='12s';set timezone='UTC';\n"+query,
                            env=ENV, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()

def read(path):
    return (ROOT/path).read_text()

def reset():
    assert sql("select current_database()||':'||inet_server_port()") == 'icash_reliability:5432'
    sql("drop schema if exists icash_work_private cascade;drop schema if exists icash_reliability_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema if exists icash_private cascade;drop schema public cascade;create schema public;")

reset()
sql(read('tests/fixtures/account-work-repair.sql'))
sql(read('tests/fixtures/stalled-work-boundary.sql'))
sql('grant usage on schema public to anon,authenticated,service_role;')
defs = json.loads(read('tests/fixtures/stalled-work-production-20261114.json'))
sql(defs['observations'])
sql('revoke all on function icash_account_work_observations() from public,anon,authenticated;grant execute on function icash_account_work_observations() to service_role;')
assert sql('select count(*) from icash_account_work_observations()') == '0'
original = sql('select fixture_work_evidence()')
sql(read('config/stalled-work-boundary.sql'))
sql(read('tests/fixtures/stalled-work-boundary-assertions.sql'))
with ThreadPoolExecutor(max_workers=12) as pool:
    assert set(pool.map(lambda _: sql('set role service_role;select reason from icash_account_work_observations()'), range(36))) == {'pending_work'}
assert sql('select fixture_work_evidence()') == original
for role in ('anon', 'authenticated'):
    assert sql(f"select has_function_privilege('{role}','icash_account_work_observations()','execute')") == 'f'
# A transactional rehearsal/rollback restores the exact predecessor and ACLs.
sql('begin;'+defs['observations']+';rollback;')
assert sql('select reason from icash_account_work_observations()') == 'pending_work'

reset()
setup = subprocess.run(['node','--input-type=module','-e',
    "import {continuationSetup} from './tests/helpers/stalled-work-fixture.mjs';process.stdout.write(continuationSetup());"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout
sql(setup)
cases = [json.loads(sql(f"select fixture_preflight_seed({n},true,interval '2 minutes')")) for n in range(1,7)]
sql("select fixture_preflight_seed(n,false,interval '20 minutes') from generate_series(100,1099) n")
before = sql('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from icash_research_private.owner_export_preflights p')
sql(read('config/preflight-continuation-fairness.sql'))
assert sql('select enabled from icash_work_private.continuation_policy') == 'f'
issuance = read('config/preflight-continuation-issuance.sql')
sql('create table fixture_migration_ledger(version text primary key,name text not null)')
before_policy = sql('select to_jsonb(p) from icash_work_private.continuation_policy p')
before_recorder = sql("select pg_get_functiondef('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)'::regprocedure)")
before_activation = sql("select pg_get_functiondef('icash_work_private.activate_continuation_fairness(text)'::regprocedure)")
try:
    sql('begin;'+issuance+"insert into fixture_migration_ledger(version) values('20261114170728');commit;")
except AssertionError as error:
    assert 'null value in column "name"' in str(error), 'Expected enclosing ledger failure'
else:
    raise AssertionError('Missing migration ledger name unexpectedly committed')
# ON_ERROR_STOP exits that connection, rolling back its failed outer transaction.
assert sql('select to_jsonb(p) from icash_work_private.continuation_policy p') == before_policy
assert sql("select pg_get_functiondef('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)'::regprocedure)") == before_recorder
assert sql("select pg_get_functiondef('icash_work_private.activate_continuation_fairness(text)'::regprocedure)") == before_activation
assert sql('select count(*) from icash_work_private.continuation_decisions') == '0'
assert sql("select count(*) from information_schema.columns where table_schema='icash_work_private' and ((table_name='continuation_decisions' and column_name='issue_token_hash') or (table_name='continuation_policy' and column_name='recorder_hash'))") == '0'
assert sql('select count(*) from fixture_migration_ledger') == '0'
sql('begin;'+issuance+"insert into fixture_migration_ledger values('20261114170728','preflight_continuation_issuance');commit;")
assert sql('select count(*) from fixture_migration_ledger') == '1'
assert sql("select icash_work_private.activate_continuation_fairness(repeat('a',40))") == 't'
started = time.monotonic()
with ThreadPoolExecutor(max_workers=9) as pool:
    results = list(pool.map(lambda _: sql('set role service_role;select icash_next_acquisition()'), range(9)))
assert all(results)
assert time.monotonic()-started < 10, 'Bounded 1,006-account selection exceeds performance budget'
assert sql('select string_agg(continuation::text,\',\' order by turn) from icash_work_private.continuation_decisions') == 'true,true,false,true,true,false,true,true,false'
assert sql('select count(distinct ticket_id) from icash_work_private.continuation_decisions') == '9'
# Subsequent valid preflight steps reuse the SAME contacts ticket. Concurrent
# workers must admit each fresh issuance once and preserve every earlier turn.
target=cases[0]
first_issuance=sql(f"select to_jsonb(d) from icash_work_private.continuation_decisions d where ticket_id='{target['ticket']}';")
for expected_count in (2,3):
    sql(f"""update icash_automation_tickets set state='held',outcome='owner_preview_rate_limited',completed_at=now(),
     owner_preview_deferrals=owner_preview_deferrals+1,owner_preview_retry_after=now()-interval '1 second' where id='{target['ticket']}';
     update icash_discovery_configs set next_run_at=now()-interval '1 second' where account_id='{target['account']}';""")
    with ThreadPoolExecutor(max_workers=9) as pool:
        repeated=list(pool.map(lambda _:sql('set role service_role;select icash_next_acquisition();'),range(9)))
    assert all(repeated)
    assert sql(f"select count(*) from icash_work_private.continuation_decisions where ticket_id='{target['ticket']}';")==str(expected_count)
    assert sql(f"select count(distinct issue_token_hash) from icash_work_private.continuation_decisions where ticket_id='{target['ticket']}';")==str(expected_count)
    assert sql(f"select to_jsonb(d) from icash_work_private.continuation_decisions d where ticket_id='{target['ticket']}' order by turn limit 1;")==first_issuance
    assert sql(f"select bool_and(preflight_id='{target['preflight']}') from icash_work_private.continuation_decisions where ticket_id='{target['ticket']}';")=='t'
before_ack=sql('select issued from icash_work_private.continuation_policy;')
with ThreadPoolExecutor(max_workers=9) as pool:
    list(pool.map(lambda _:sql(f"set role service_role;select icash_work_private.record_continuation_decision('{target['ticket']}','{target['account']}','{target['screening']}',true);"),range(9)))
assert sql('select issued from icash_work_private.continuation_policy;')==before_ack
assert sql('select count(*) from icash_work_private.continuation_decisions') == '27'
assert sql('select md5(jsonb_agg(to_jsonb(p) order by id)::text) from icash_research_private.owner_export_preflights p') == before
for table in ('icash_operation_spend','icash_credit_reservations','icash_credit_ledger','icash_cost_manifests'):
    assert sql(f'select count(*) from {table}') == '0', 'Selection created paid work: '+table
for role in ('anon','authenticated','service_role'):
    assert sql(f"select has_function_privilege('{role}','icash_work_private.activate_continuation_fairness(text)','execute')") == 'f'
    assert sql(f"select has_table_privilege('{role}','icash_work_private.continuation_decisions','update,delete,truncate')") == 'f'
# Failed downstream SQL rolls back the ticket AND its fair turn/evidence.
before_issue = sql('select issued from icash_work_private.continuation_policy')
before_tickets = sql('select count(*) from icash_automation_tickets')
sql('begin;select icash_next_acquisition();rollback;')
assert sql('select issued from icash_work_private.continuation_policy') == before_issue
assert sql('select count(*) from icash_automation_tickets') == before_tickets
# Rollback affects future ordering only, preserving all durable evidence.
sql('begin;select 1 from icash_operating_budget where id=1 for update;update icash_work_private.continuation_policy set enabled=false;commit;')
sql('set role service_role;select icash_next_acquisition();')
assert sql('select count(*) from icash_work_private.continuation_decisions') == '27'
print('PASS PostgreSQL 17: exact monitor boundary, 36 concurrent service-role reads, atomic correction and migration-ledger failure rollback, 1,006-account fair selection, same-original-ticket multi-step continuation and identical acknowledgment with 9 competing workers, immutable originals, unchanged financial ledgers, ACLs and rollback.')

reset()
setup = subprocess.run(['node','--input-type=module','-e',
    "import {followupCheckpointSetup} from './tests/helpers/followup-checkpoint-fixture.mjs';process.stdout.write(followupCheckpointSetup());"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout
sql(setup)
sql(read('config/followup-step-checkpoints.sql'))
account='00000000-0000-4000-8000-000000000001'
ticket='00000000-0000-4000-8000-000000000002'
replacement='00000000-0000-4000-8000-000000000003'
sql(f"""insert into icash_accounts(id,owner_user_id) values('{account}','{account}');
 insert into icash_automation_tickets(id,account_id,kind,state) values('{ticket}','{account}','account_reconcile','consumed');
 insert into icash_work_private.account_followups(account_id,ticket_id,lease_until,claimed_version,claimed_notify_version,notify_version)
 values('{account}','{ticket}',now()+interval '5 minutes',1,1,1);""")
assert sql("select icash_work_private.activate_followup_steps(repeat('b',40))")=='t'
claim=f"set role service_role;select icash_claim_followup_step('{account}','{ticket}','voice_receipts');"
with ThreadPoolExecutor(max_workers=24) as pool:
    claims=[json.loads(x) for x in pool.map(lambda _: sql(claim),range(24))]
assert sum(x['status']=='claimed' for x in claims)==1
assert sum(x['status']=='busy' for x in claims)==23
attempt=next(x['id'] for x in claims if x['status']=='claimed')
# Simulate a crashed handler and its normal lease replacement. The old attempt
# remains pending evidence; a stale worker cannot finish the replacement.
sql(f"""insert into icash_automation_tickets(id,account_id,kind,state) values('{replacement}','{account}','account_reconcile','consumed');
 update icash_work_private.account_followups set ticket_id='{replacement}' where account_id='{account}';""")
assert sql(f"select icash_finish_followup_step('{account}','{ticket}','voice_receipts','{attempt}',true,'{{}}')")=='f'
second=json.loads(sql(f"set role service_role;select icash_claim_followup_step('{account}','{replacement}','voice_receipts')"))
assert second['status']=='claimed' and second['id']!=attempt
finish=f"set role service_role;select icash_finish_followup_step('{account}','{replacement}','voice_receipts','{second['id']}',true,'{{\"held\":0}}')"
with ThreadPoolExecutor(max_workers=12) as pool:
    assert set(pool.map(lambda _:sql(finish),range(24)))=={'t'}
assert sql('select count(*) from icash_work_private.followup_step_attempts where completed')=='1'
assert sql('select count(*) from icash_work_private.followup_step_attempts where finished_at is null')=='1'
assert json.loads(sql(f"set role service_role;select icash_claim_followup_step('{account}','{replacement}','voice_receipts')"))['status']=='completed'
for role in ('anon','authenticated','service_role'):
    assert sql(f"select has_function_privilege('{role}','icash_work_private.activate_followup_steps(text)','execute')")=='f'
    assert sql(f"select has_table_privilege('{role}','icash_work_private.followup_step_attempts','update,delete,truncate')")=='f'
sql('update icash_work_private.followup_step_policy set enabled=false')
assert sql(f"select icash_claim_followup_step('{account}','{replacement}','customer_updates') is null")=='t'
assert sql('select count(*) from icash_work_private.followup_step_attempts')=='2'
print('PASS PostgreSQL 17: 24 competing step claims, crash/replacement, stale-worker refusal, 24 identical finish acknowledgments, original history, private permissions and rollback.')
