"""Race original retries and fresh introductions on disposable localhost PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import importlib.util
import json
import os
import subprocess
import time

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', root / 'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
# A separate local port avoids touching another engineer's disposable fixture.
port = os.environ.get('ICASH_SENDER_FAIRNESS_TEST_PORT', '55443')
assert port in ('55443', '55449')
fixture.CMD[fixture.CMD.index('-p') + 1] = port
sql = fixture.sql


def race(queries):
    barrier = Barrier(len(queries))
    def run(query):
        barrier.wait(timeout=10)
        return sql('set role service_role;' + query)
    with ThreadPoolExecutor(max_workers=len(queries)) as workers:
        return list(workers.map(run, queries))


def main():
    assert sql('select current_database()') == 'icash_reliability'
    data = json.loads(subprocess.check_output(['node', str(root / 'tests/helpers/deferred-sender-fairness-fixture.mjs')], text=True))
    sql('drop schema if exists icash_sender_private cascade;drop schema if exists icash_text_receipt_private cascade;'
        'drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
    sql(data['setup'] + data['seedDelay'] + data['migration'] + data['ageAssignments'])
    original = sql("select row_to_json(o) from public.icash_operation_spend o")
    threads = [sql(f"select fixture_thread('race-{i}')") for i in range(12)]
    queues = [f"select public.icash_queue_seller_opener(md5('owner')::uuid,'{thread}')" for thread in threads]
    retry = 'select public.icash_next_sender_volume_retry()'
    # Cold queues cannot steal the turn while multiple retry workers select it.
    results = race(queues + [retry] * 8)
    assert results[:12] == [''] * 12, results
    selected = [json.loads(r) for r in results[12:] if r]
    assert len(selected) == 1, selected
    assert selected[0]['claimKind'] == 'automatic'
    message = selected[0]['messageId']
    assert sql("select row_to_json(o) from public.icash_operation_spend o") == original
    assert sql('select count(*) from public.icash_seller_opener_assignments') == '0'
    assert race(queues) == [''] * 12, 'selection-to-claim interval retains priority'
    claims = [f"select public.icash_claim_text(md5('owner')::uuid,'{message}','+14155550100') is not null"] * 8
    assert race(claims).count('t') == 1, 'one original dispatch under concurrent claims'
    assert sql('select count(*) from public.icash_operation_spend') == '2'
    assert sql('select count(*) from icash_sender_private.uses') == '1'
    assert sql('select count(*) from icash_sender_private.waiting') == '0'
    assert sql("select row_to_json(o) from public.icash_operation_spend o where operation_key='text:'||md5('messagedelay')::uuid") == original
    # Existing per-number delay serialization still admits one fresh opener.
    assert sum(bool(r) for r in race(queues)) == 1
    assert sql('select count(*) from public.icash_operation_spend') == '2'
    # Another physical number keeps progressing despite this number's wait.
    other = sql("select fixture_thread('other-line','+16195550101')")
    assert sql(f"set role service_role;select public.icash_queue_seller_opener(md5('owner')::uuid,'{other}')")
    # A new waiting entry committed while a queue waits on the pre-existing
    # budget lock must be visible to its subsequent fairness check.
    sql(data['ageAssignments'])
    fresh = sql("select fixture_thread('late-queue')")
    held = sql("select fixture_message('late-waiting',fixture_thread('late-waiting'))")
    blocker = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write("begin;set local statement_timeout='8s';do $$begin perform 1 from public.icash_operating_budget where id=1 for update;end$$;"
                            f"select icash_sender_private.defer(md5('owner')::uuid,'{held}','+14155550100','automatic');"
                            "update icash_sender_private.waiting set queued_at=now()-interval '20 minutes',next_check_at=now()-interval '1 second';"
                            "select 'budget_locked';\n")
        blocker.stdin.flush()
        fixture.wait_for_marker(blocker, 'budget_locked')
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(sql, "set role service_role;set application_name='sender-fairness-candidate';"
                                  f"select public.icash_queue_seller_opener(md5('owner')::uuid,'{fresh}')")
            deadline = time.monotonic() + 5
            waiting = False
            while time.monotonic() < deadline:
                waiting = sql("select exists(select 1 from pg_stat_activity where application_name='sender-fairness-candidate' and wait_event_type='Lock')") == 't'
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, 'queue did not reach the original budget lock'
            blocker.stdin.write('commit;\n\\q\n')
            blocker.stdin.flush()
            blocker.wait(timeout=5)
            assert blocker.returncode == 0, blocker.stderr.read()
            assert pending.result() == '', 'post-lock queue must see the newly committed original waiter'
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.wait(timeout=5)
    assert sql('select count(*) from public.icash_operation_spend') == '2'
    print('PASS native PostgreSQL: 12 fresh queues yield, 8 selectors choose one original, 8 claims dispatch once; post-lock fresh reads, existing pacing, separate numbers and original unknown money preserved')


if __name__ == '__main__':
    main()
