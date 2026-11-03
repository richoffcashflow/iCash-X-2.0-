"""Native immutable free-preview saves on the fixed disposable local database."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from threading import Barrier
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("native_fixture", ROOT / "scripts/test-owner-preflight-priority-postgres.py")
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
sql = fixture.sql


def setup():
    assert sql("select current_database();") == "icash_reliability"
    sql("drop schema if exists icash_research_private cascade;drop schema if exists icash_private cascade;drop schema public cascade;create schema public;")
    sql(fixture.read("tests/fixtures/owner-preview-empty.sql"))
    source = fixture.read("config/owner-enrichment-deferral.sql")
    sql(source[source.index("create function public.icash_owner_enrichment_unstarted"):source.index("-- Additional retry gates")])
    sql(fixture.read("config/owner-enrichment-evidence-indexes.sql"))
    sql(fixture.read("config/owner-preview-empty.sql"))


def literal(value):
    return "'"+json.dumps(value).replace("'", "''")+"'::jsonb"


def save_query(case):
    return ("set role service_role;set application_name='empty-preview-contender';"
            f"select public.icash_record_empty_owner_preview('{case['account']}'::uuid,'{case['batch']}'::uuid,'{case['request']}'::uuid,"
            f"{literal(case['items'])},{literal(case['preview'])});")


def seed(n):
    return json.loads(sql(f"select fixture_empty_preview_seed({n});"))


def evidence(case):
    return sql(f"select md5(to_jsonb(r)::text) from icash_research_private.requests r where id='{case['request']}';")


def late_guard(case, mutation):
    before = evidence(case)
    blocker = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write("begin;set local statement_timeout='8s';do $$begin perform 1 from icash_operating_budget where id=1 for update;end$$;"+mutation+"select 'budget_locked';\n")
        blocker.stdin.flush()
        fixture.wait_for_marker(blocker, "budget_locked")
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, save_query(case))
            deadline = time.monotonic()+5
            waiting = False
            while time.monotonic() < deadline:
                waiting = sql("select exists(select 1 from pg_stat_activity where application_name='empty-preview-contender' and wait_event_type='Lock');") == 't'
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, "Save never reached the shared paid-admission lock"
            blocker.stdin.write("commit;\n\\q\n")
            blocker.stdin.flush()
            blocker.wait(timeout=5)
            assert blocker.returncode == 0, blocker.stderr.read()
            assert future.result() == 'f', "Late original hold or Pause must reject the new exclusion"
        assert evidence(case) == before
        assert sql(f"select count(*) from icash_research_private.owner_empty_preview_receipts where request_id='{case['request']}';") == '0'
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.wait(timeout=5)


def run():
    setup()
    case = seed(1)
    before = evidence(case)
    barrier = Barrier(24)

    def save(_):
        barrier.wait(timeout=10)
        return sql(save_query(case))

    with ThreadPoolExecutor(max_workers=24) as pool:
        results = list(pool.map(save, range(24)))
    assert results == ['t']*24, results
    assert sql("select count(*) from icash_research_private.owner_empty_preview_receipts;") == '1'
    assert sql("select count(*) from icash_research_private.owner_empty_preview_items;") == '5'
    assert evidence(case) == before
    for item in case['items']:
        assert sql(f"set role service_role;select public.icash_owner_preflight_empty('{case['account']}'::uuid,'{item['screeningId']}'::uuid,{literal(item['snapshot'])});") == 't'
    conflicting = json.loads(json.dumps(case))
    conflicting['preview']['data'][0]['contacts'][0]['availability']['phones'] = 1
    assert sql(save_query(conflicting)) == 'f'
    paused = seed(2)
    late_guard(paused, f"update icash_accounts set bot_paused=true where id='{paused['account']}';")
    observed = seed(3)
    operation = f"owners:{observed['account']}:{observed['items'][0]['screeningId']}"
    late_guard(observed, f"insert into icash_cost_observations values('other','{operation}:original','original unknown receipt',null,'unknown');")
    assert sql(f"select count(*) from icash_cost_observations where event_key='{operation}:original' and amount is null;") == '1'
    paid = seed(4)
    operation = f"owners:{paid['account']}:{paid['items'][0]['screeningId']}"
    late_guard(paid, f"insert into icash_operation_spend(operation_key,account_id) values('{operation}','{paid['account']}');")
    for role in ('anon', 'authenticated', 'service_role'):
        assert sql(f"select has_schema_privilege('{role}','public','usage');") == 't'
        assert sql(f"select has_function_privilege('{role}','public.icash_record_empty_owner_preview(uuid,uuid,uuid,jsonb,jsonb)','execute');") == ('t' if role == 'service_role' else 'f')
        assert sql(f"select has_table_privilege('{role}','icash_research_private.owner_empty_preview_receipts','select');") == 'f'
    assert sql("select count(*) from icash_credit_reservations;") == '0'
    assert sql("select count(*) from icash_owner_contacts;") == '0'
    print('PASS native empty-preview retention: 24 competing acknowledgments save one original receipt/five exclusions; contradictory replay, late Pause, original unknown receipt and paid operation reject; original request evidence unchanged. No providers or financial writes.')


if __name__ == '__main__':
    run()
