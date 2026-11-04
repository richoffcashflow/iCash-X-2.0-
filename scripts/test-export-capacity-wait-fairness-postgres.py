"""Native scheduler contention on a fixed disposable localhost database. No providers."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
from threading import Barrier
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "preflight_native", ROOT / "scripts/test-owner-preflight-priority-postgres.py")
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
sql, CMD, ENV = native.sql, native.CMD, native.ENV
FINANCIAL_EVIDENCE = {}
ISSUE = ("set role service_role;set application_name='export-wait-fairness-contender';"
         "select coalesce(public.icash_next_acquisition()::text,'null');")


def read(path):
    return (ROOT / path).read_text()


def setup():
    assert sql("select current_database();") == "icash_reliability"
    sql("drop schema if exists icash_work_private cascade;"
        "drop schema if exists icash_research_private cascade;"
        "drop schema if exists icash_owner_review_private cascade;"
        "drop schema if exists icash_private cascade;"
        "drop schema public cascade;create schema public;")
    sql(read("tests/fixtures/export-capacity-wait-foundation.sql"))
    definitions = json.loads(read("tests/fixtures/export-capacity-wait-before.json"))
    for signature, definition in definitions.items():
        sql(definition)
        expected = hashlib.md5(definition.encode()).hexdigest()
        assert sql(f"select md5(pg_get_functiondef('{signature}'::regprocedure));") == expected, signature
    sql(read("config/export-capacity-wait-fairness.sql"))
    assert sql("select rolbypassrls from pg_roles where rolname='service_role';") == 't'
    for table in ('icash_operation_spend', 'icash_credit_reservations'):
        FINANCIAL_EVIDENCE[table] = sql(
            f"select jsonb_agg(to_jsonb(e) order by to_jsonb(e)::text) from public.{table} e;")
        assert FINANCIAL_EVIDENCE[table] not in ('', 'null', '[]'), 'Fixture must retain original uncertain money evidence'


def seed(n, contacts=True, overdue="11 minutes"):
    # Disable old fixture accounts; preserve their original tickets and receipts.
    sql("update public.icash_discovery_configs set enabled=false;")
    return json.loads(sql(
        "select public.fixture_export_wait_seed("
        f"{n},{str(contacts).lower()},interval '{overdue}');"))


def snapshot(case):
    account = case['account']
    return json.loads(sql(f"""select jsonb_build_object(
      'next_run_at',(select next_run_at from public.icash_discovery_configs where account_id='{account}'),
      'wait',(select to_jsonb(w) from icash_work_private.acquisition_export_waits w where account_id='{account}'),
      'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)
        from public.icash_automation_tickets t where account_id='{account}'),
      'wallet',(select to_jsonb(w) from public.icash_wallets w where account_id='{account}'));
    """))


def assert_no_paid_work():
    for table, evidence in FINANCIAL_EVIDENCE.items():
        assert sql(f"select jsonb_agg(to_jsonb(e) order by to_jsonb(e)::text) from public.{table} e;") == evidence, table


def concurrent_claims(count=24):
    barrier = Barrier(count)

    def claim(_):
        barrier.wait(timeout=10)
        return json.loads(sql(ISSUE))

    with ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(claim, range(count)))


def wait_for_marker(process, marker):
    # Keep this harness independent of the older shared helper's TextIO buffer
    # race: read and frame all bytes returned by the OS, including batched rows.
    deadline = time.monotonic()+5
    pending = b''
    expected = marker.encode()
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(process.stderr.read())
        if select.select([process.stdout], [], [], 0.1)[0]:
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                continue
            pending += chunk
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                if line.strip() == expected:
                    return
    raise AssertionError('Export-wait budget-lock holder did not become ready')


def claim_after_commit(mutation):
    """Prove that a real blocked issuer observes the preceding committed change."""
    holder = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        # DO and UPDATE produce no query rows: the marker is the only stdout
        # line, including on branches predating the shared reader's buffer fix.
        holder.stdin.write("begin;set local statement_timeout='8s';"
            "do $$begin perform 1 from public.icash_operating_budget where id=1 for update;end$$;"
            + mutation + "select 'export_wait_budget_locked';\n")
        holder.stdin.flush()
        wait_for_marker(holder, 'export_wait_budget_locked')
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, ISSUE)
            deadline = time.monotonic()+5
            waiting = False
            while time.monotonic() < deadline:
                waiting = sql("select exists(select 1 from pg_stat_activity "
                    "where application_name='export-wait-fairness-contender' "
                    "and wait_event_type='Lock' and query like '%icash_next_acquisition%');") == 't'
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, 'Issuer never reached the original operating-budget lock'
            holder.stdin.write("commit;\n\\q\n")
            holder.stdin.flush()
            holder.wait(timeout=5)
            assert holder.returncode == 0, holder.stderr.read()
            return json.loads(future.result())
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)


def run():
    setup()
    sql("update public.fixture_export_wait_policy set export_capacity='export_busy';")
    case = seed(1)
    before = snapshot(case)
    results = concurrent_claims()
    assert results == [None]*24, results
    blocked = snapshot(case)
    assert blocked['wait']['waiting_since'] == before['next_run_at']
    assert blocked['tickets'] == before['tickets']
    assert blocked['wallet'] == before['wallet']
    assert sql(f"select next_run_at>now() from public.icash_discovery_configs where account_id='{case['account']}';") == 't'
    assert sql("select count(*) from icash_work_private.acquisition_export_waits;") == '1'
    assert_no_paid_work()

    # Advance only the synthetic polling deadline, not the preserved waiting age.
    sql(f"update public.icash_discovery_configs set next_run_at=now()-interval '1 second' where account_id='{case['account']}';")
    results = concurrent_claims()
    assert results == [None]*24
    repeated = snapshot(case)
    assert repeated['wait']['waiting_since'] == blocked['wait']['waiting_since']
    assert repeated['tickets'] == before['tickets']
    assert repeated['wallet'] == before['wallet']

    # An export release committed before the waiting claim is observed, and the
    # original one-use issuer clears only this account's scheduling marker.
    sql(f"update public.icash_discovery_configs set next_run_at=now()-interval '1 second' where account_id='{case['account']}';")
    issued = claim_after_commit(
        "update public.fixture_export_wait_policy set export_capacity='ready';")
    assert issued is not None and issued.get('token'), issued
    after = snapshot(case)
    assert after['wait'] is None
    assert len(after['tickets']) == len(before['tickets'])+1
    assert len([ticket for ticket in after['tickets'] if ticket['state'] == 'issued']) == 1
    assert after['wallet'] == before['wallet']
    assert_no_paid_work()

    # Many simultaneous claimers retain the original account exclusion and
    # budget serialization: one capability, not one capability per worker.
    ready = seed(2)
    ready_before = snapshot(ready)
    results = concurrent_claims()
    issued = [result for result in results if result is not None]
    assert len(issued) == 1 and results.count(None) == 23, results
    ready_after = snapshot(ready)
    assert len(ready_after['tickets']) == len(ready_before['tickets'])+1
    assert len([ticket for ticket in ready_after['tickets'] if ticket['token'] == issued[0]['token']]) == 1
    assert ready_after['wait'] is None
    assert ready_after['wallet'] == ready_before['wallet']

    # Capacity can become occupied while the issuer waits for the budget lock.
    capacity = seed(3)
    capacity_before = snapshot(capacity)
    assert claim_after_commit(
        "update public.fixture_export_wait_policy set export_capacity='export_busy';") is None
    capacity_after = snapshot(capacity)
    assert capacity_after['wait']['waiting_since'] == capacity_before['next_run_at']
    assert capacity_after['tickets'] == capacity_before['tickets']
    assert capacity_after['wallet'] == capacity_before['wallet']

    # A late customer Pause or fully reserved wallet still wins admission even
    # when an older wait marker would otherwise give this account top priority.
    for number, mutation in [
        (4, "update public.icash_accounts set bot_paused=true where id='{account}';"),
        (5, "update public.icash_wallets set reserved_cents=balance_cents where account_id='{account}';"),
    ]:
        guarded = seed(number)
        assert json.loads(sql(ISSUE)) is None
        saved = snapshot(guarded)
        assert saved['wait'] is not None
        sql(f"update public.icash_discovery_configs set next_run_at=now()-interval '1 second' where account_id='{guarded['account']}';")
        assert claim_after_commit(
            "update public.fixture_export_wait_policy set export_capacity='ready';"
            + mutation.format(account=guarded['account'])) is None
        stopped = snapshot(guarded)
        assert stopped['wait'] == saved['wait']
        assert stopped['tickets'] == saved['tickets']
        sql("update public.fixture_export_wait_policy set export_capacity='export_busy';")
    assert_no_paid_work()
    print('PASS native export-wait fairness: 24 busy claimers preserve original age and cooldown; '
          '24 ready claimers issue one capability; committed capacity, Pause and wallet changes '
          'win the original budget lock; original uncertain money evidence unchanged; no providers or paid operations.')


if __name__ == '__main__':
    run()
