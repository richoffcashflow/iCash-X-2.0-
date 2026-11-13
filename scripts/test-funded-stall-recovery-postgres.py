"""Concurrent November 13 funded recovery on the fixed disposable localhost DB."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
from threading import Barrier

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_fixture', ROOT / 'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql, read = fixture.sql, fixture.read
assert sql('select current_database();') == 'icash_reliability'
sql('drop schema if exists icash_reliability_private cascade;drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
sql(read('tests/fixtures/opportunity-schema.sql'))
before = json.loads(read('tests/fixtures/reviewed-pending-work-before.json'))
sql('create table icash_prospecting_budgets(id bigint generated always as identity primary key,account_id uuid,baseline_cents bigint);')
sql(before['icash_prospecting_total_available'])
sql('drop table icash_prospecting_budgets cascade;')
sql(read('tests/fixtures/reviewed-pending-work-foundation.sql'))
for definition in before.values():
    sql(definition)
sql('create trigger fixture_final_guard before insert on icash_operation_spend for each row execute function icash_guard_prospecting_spend();')
sql(read('config/reviewed-pending-work-relief.sql'))
sql("select icash_reliability_private.activate_pending_work_relief(manifest,repeat('a',40)) from icash_reliability_private.pending_work_relief_policy;")
sql('begin;'+read('config/funded-stall-recovery-20261113.sql')+'commit;')
account = '10000000-0000-4000-8000-000000000001'
manifest = sql('select manifest from icash_reliability_private.pending_work_relief_policy_20261113;')
barrier = Barrier(16)

def activate(_):
    barrier.wait(timeout=10)
    return json.loads(sql(f"select icash_reliability_private.activate_pending_work_relief_20261113('{manifest}','{'b' * 40}');"))

with ThreadPoolExecutor(max_workers=16) as pool:
    results = list(pool.map(activate, range(16)))
assert sum(result['activated'] for result in results) == 1
assert sql('select reserved_micros from icash_operating_budget;') == '700000'
assert sql('select count(*) from icash_credit_ledger;') == '0'
assert sql(f"select icash_prospecting_total_available('{account}');") == '1000'
sql('grant usage on schema public,icash_work_private to service_role;grant select,insert,update on all tables in schema public to service_role;grant execute on all functions in schema public to service_role;')
barrier = Barrier(16)

def admit(n):
    barrier.wait(timeout=10)
    try:
        return sql(f"set role service_role;select fixture_relief_admit('{account}','concurrent-{n}',200);") == 't'
    except AssertionError as error:
        assert 'Prospecting budget reached' in str(error), str(error)
        return False

with ThreadPoolExecutor(max_workers=16) as pool:
    results = list(pool.map(admit, range(16)))
assert sum(results) == 5, 'Five real quotes fit; competing workers cannot overspend the released planning capacity'
assert sql(f"select icash_prospecting_total_available('{account}');") == '0'
assert sql("select count(*) from icash_operation_spend where operation_key like 'concurrent-%';") == '5'
assert sql("select count(*) from icash_credit_reservations where operation_key like 'concurrent-%';") == '5'
barrier = Barrier(8)

def settle(_):
    barrier.wait(timeout=10)
    return sql(f"select icash_finish_credit('{account}','old-call',250,'SYNTHETIC delayed original receipt');")

with ThreadPoolExecutor(max_workers=8) as pool:
    assert all(result == 'settled' for result in pool.map(settle, range(8)))
assert sql(f"select balance_cents from icash_wallets where account_id='{account}';") == '750'
assert sql('select count(*) from icash_credit_ledger;') == '1'
assert sql(f"select icash_prospecting_total_available('{account}');") == '0'
for role in ('anon', 'authenticated', 'service_role'):
    assert sql(f"select has_function_privilege('{role}','icash_reliability_private.activate_pending_work_relief_20261113(text,text)','execute');") == 'f'
sql('drop schema icash_reliability_private cascade;drop schema icash_work_private cascade;')
print('PASS native November 13 funded recovery: one activation, 16 competing final admissions bounded by funds, eight duplicate late settlements charged once, unchanged supplier reserves and private operator activation')
