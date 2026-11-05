"""Bounded opener scans and real races in a disposable localhost DB; no providers."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
from threading import Barrier
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('priority_fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql
ISSUE = "set role service_role;set application_name='opener-scan-contender';select coalesce(public.icash_issue_ready_seller_text()::text,'null');"


def thread(n):
    return f'20000000-0000-4000-8000-{n:012d}'


def setup():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
    fixture_sql = json.loads(subprocess.check_output(['node', str(ROOT/'tests/helpers/seller-dispatch-fixture.mjs')], text=True))
    sql(fixture_sql['bounded'])
    sql('alter role service_role bypassrls;')


def concurrent_issue(workers):
    barrier = Barrier(workers)

    def issue(_):
        barrier.wait(timeout=10)
        return json.loads(sql(ISSUE))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(issue, range(workers)))


def holder(statement, marker):
    process = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write("begin;set local statement_timeout='8s';"+statement+f"select '{marker}';\n")
    process.stdin.flush()
    fixture.wait_for_marker(process, marker)
    return process


def release(process):
    process.stdin.write('commit;\n\\q\n')
    process.stdin.flush()
    process.wait(timeout=5)
    assert process.returncode == 0, process.stderr.read()


def stop(process):
    if process.poll() is None:
        process.kill()
        process.wait(timeout=5)


def late_guard(mutation, label):
    setup()
    sql('select fixture_seed(1,1,true);')
    # Pause the check after cheap selection, before the unchanged final queue.
    # The blocker has no customer or budget row locks of its own.
    sql("""create or replace function public.icash_sms_outreach_window_current(p_account uuid,p_thread uuid)
      returns boolean language plpgsql volatile set search_path='' as $$begin
      perform pg_advisory_xact_lock(987010);
      insert into public.fixture_checks(thread_id,phase) values(p_thread,'hours');
      return (select hours_allowed from public.icash_text_threads where id=p_thread and account_id=p_account);
      end$$;""")
    blocker = holder('do $$begin perform pg_advisory_xact_lock(987010);end$$;', 'hours_locked')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, ISSUE)
            deadline = time.monotonic()+5
            waiting = False
            while time.monotonic() < deadline:
                waiting = sql("select exists(select 1 from pg_stat_activity where application_name='opener-scan-contender' and wait_event_type='Lock');") == 't'
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, 'Issuer never reached the recipient-hour check'
            sql(mutation)
            release(blocker)
            assert json.loads(future.result()) is None, label
        assert sql('select count(*) from icash_text_messages;') == '0', label
        assert sql('select count(*) from icash_automation_tickets;') == '0', label
        assert sql('select last_thread_id from icash_work_private.seller_opener_scan;') == thread(1)
    finally:
        stop(blocker)


def setup_current(bounded):
    """Exact captured queues/triggers; source review remains an explicit fixture."""
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
    fixture_sql = json.loads(subprocess.check_output(
        ['node', str(ROOT/'tests/helpers/seller-dispatch-fixture.mjs')], text=True))
    sql(fixture_sql['actual' if bounded else 'actualOriginal'])
    sql('alter role service_role bypassrls;')
    captured = json.loads((ROOT/'tests/fixtures/seller-opener-bounded-current-admission.json').read_text())
    for function in captured['functions']:
        assert sql("select md5(pg_get_functiondef('"+function['signature']+"'::regprocedure));") == function['hash']


def current_late_guard(bounded, mutation, paused):
    setup_current(bounded)
    sql('select fixture_seed_admission(1,1);')
    sql("""create or replace function public.icash_sms_outreach_window_current(p_account uuid,p_thread uuid)
      returns boolean language plpgsql volatile set search_path='' as $$begin
      perform pg_advisory_xact_lock(987010);
      return (select hours_allowed from public.icash_text_threads where id=p_thread and account_id=p_account);
      end$$;""")
    blocker = holder('do $$begin perform pg_advisory_xact_lock(987010);end$$;', 'current_hours_locked')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, ISSUE)
            deadline = time.monotonic()+5
            while sql("select exists(select 1 from pg_stat_activity where application_name='opener-scan-contender' and wait_event_type='Lock');") != 't':
                assert time.monotonic() < deadline, 'Current queue scenario never reached source boundary'
                time.sleep(.025)
            sql(mutation)
            saved_wallet = sql('select to_jsonb(w) from icash_wallets w;')
            release(blocker)
            result = json.loads(future.result())
        # The pre-existing selector may create a ready draft from its earlier
        # statement snapshot. Never mistake a queued draft for paid dispatch.
        count = sql('select count(*) from icash_text_messages;')
        assert count in ('0', '1')
        assert sql('select count(*) from icash_operation_spend;') == '0'
        assert sql('select to_jsonb(w) from icash_wallets w;') == saved_wallet
        if count == '1':
            assert sql("select state='ready' and provider_id is null and customer_price_micros=20800 and route_revision=1 from icash_text_messages;") == 't'
            assert sql('select a.message_id=m.id from icash_seller_opener_assignments a join icash_text_messages m on m.thread_id=a.thread_id;') == 't'
            if paused:
                assert sql("set role service_role;select icash_claim_text_before_owner_question(account_id,id,'+17205550100') from icash_text_messages;") == ''
                assert sql("select state from icash_text_messages;") == 'ready'
        return {'queued': int(count), 'ticket': bool(result), 'money_rows': 0}
    finally:
        stop(blocker)


def run():
    setup()
    sql('select fixture_seed(n,1+n%7,false) from generate_series(1,2048)n;')
    # Fresh bulk-loaded tables otherwise depend on when autovacuum happens to
    # analyze them. Use the existing production screening index with measured
    # cardinalities before 24 callers share the unchanged eight-second limit.
    sql('analyze public.icash_accounts;analyze public.icash_wallets;'
        'analyze public.icash_screening_jobs;analyze public.icash_deal_files;'
        'analyze public.icash_text_threads;analyze public.icash_timezone_names;')
    wallet_before = sql("select md5(string_agg(to_jsonb(w)::text,',' order by account_id)) from icash_wallets w;")
    assert concurrent_issue(24) == [None]*24
    assert sql("select count(*) from fixture_checks where phase='hours';") == '768'
    assert sql("select count(distinct thread_id) from fixture_checks where phase='hours';") == '768'
    assert sql("select max(n) from(select count(*)n from fixture_checks where phase='hours' group by backend_pid)s;") == '32'
    assert sql('select last_thread_id from icash_work_private.seller_opener_scan;') == thread(768)
    assert sql("select md5(string_agg(to_jsonb(w)::text,',' order by account_id)) from icash_wallets w;") == wallet_before
    assert sql('select count(*) from icash_automation_tickets;') == '0'

    # A held thread is skipped, then revisited after the cursor wraps.
    setup()
    sql('select fixture_seed(1,1,true);select fixture_seed(2,2,true);select fixture_seed(3,3,false);')
    blocker = holder(f"do $$begin perform 1 from icash_text_threads where id='{thread(1)}' for update;end$$;", 'thread_locked')
    try:
        assert json.loads(sql(ISSUE))['token']
        assert sql('select thread_id from icash_text_messages;') == thread(2)
        release(blocker)
    finally:
        stop(blocker)
    sql("update icash_automation_tickets set created_at=now()-interval '2 seconds';")
    assert json.loads(sql(ISSUE)) is None  # Last blocked row in the upper range.
    assert json.loads(sql(ISSUE)) is None  # Empty upper range resets cursor.
    assert sql('select last_thread_id is null from icash_work_private.seller_opener_scan;') == 't'
    results = concurrent_issue(12)
    assert len([r for r in results if r]) == 1
    assert sql('select count(distinct thread_id) from icash_text_messages;') == '2'
    assert sql('select count(distinct opener_message_id) from icash_automation_tickets;') == '2'
    assert sql('select count(*) from icash_text_messages;') == '2'
    assert sql("select has_function_privilege('anon','public.icash_issue_ready_seller_text()','execute');") == 'f'
    assert sql("select has_table_privilege('service_role','icash_work_private.seller_opener_scan','delete');") == 'f'

    late_guard('update icash_accounts set bot_paused=true;', 'late customer Pause must stop the final queue')
    late_guard('update icash_wallets set reserved_cents=balance_cents;', 'late reservation must stop the final queue')
    print('PASS native dispatch selectors: 24 workers advance 768 distinct candidates in bounded pages; locked threads return after wrap; concurrent workers create no duplicate messages/tickets; synthetic final source gates retain late Pause/reservation cases. No providers.')

    for mutation, paused in [('update icash_accounts set bot_paused=true;', True),
                             ('update icash_wallets set reserved_cents=balance_cents;', False)]:
        original = current_late_guard(False, mutation, paused)
        bounded = current_late_guard(True, mutation, paused)
        assert bounded == original, (original, bounded)
    setup_current(True)
    sql('select fixture_seed_admission(1,1);')
    results = concurrent_issue(12)
    assert sum(bool(result) for result in results) == 1
    assert sql('select count(*) from icash_text_messages;') == '1'
    assert sql('select count(*) from icash_seller_opener_assignments;') == '1'
    assert sql('select count(*) from icash_operation_spend;') == '0'
    print('PASS actual current opener/text queues and routing/price/opener triggers: old/new late-Pause and reserved-balance queue behavior is equal; real early final-send Pause guard refuses any raced draft; 12 workers queue one draft without money/provider writes. Source review is isolated; complete financial dispatch is covered separately.')


if __name__ == '__main__':
    run()
