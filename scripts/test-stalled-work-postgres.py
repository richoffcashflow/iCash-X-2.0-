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
assert sql("select icash_work_private.activate_continuation_fairness(repeat('a',40))") == 't'
started = time.monotonic()
with ThreadPoolExecutor(max_workers=9) as pool:
    results = list(pool.map(lambda _: sql('set role service_role;select icash_next_acquisition()'), range(9)))
assert all(results)
assert time.monotonic()-started < 10, 'Bounded 1,006-account selection exceeds performance budget'
assert sql('select string_agg(continuation::text,\',\' order by turn) from icash_work_private.continuation_decisions') == 'true,true,false,true,true,false,true,true,false'
assert sql('select count(distinct ticket_id) from icash_work_private.continuation_decisions') == '9'
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
assert sql('select count(*) from icash_work_private.continuation_decisions') == '9'
print('PASS PostgreSQL 17: exact monitor boundary, 36 concurrent service-role reads, 1,006-account fair selection with 9 competing workers, immutable originals, unchanged financial ledgers, ACLs and rollback.')
