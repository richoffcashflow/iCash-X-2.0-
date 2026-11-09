"""Receipt ranking isolation on disposable PostgreSQL; no providers or paid work."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from threading import Barrier
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('indexing', ROOT / 'scripts/test-owner-preflight-indexing-postgres.py')
indexing = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(indexing)
fixture = indexing.fixture
fixture.CMD[fixture.CMD.index('-p')+1] = os.environ.get('ICASH_TEST_PG_PORT', '55443')
sql, read = fixture.sql, fixture.read


def query(c, old=False, screening=None):
    suffix = '_before' if old else ''
    argument = 'null' if screening is None else "'"+screening+"'"
    return f"select coalesce(public.icash_owner_preflight_due_at{suffix}('{c['account']}',{argument})::text,'none');"


def start(query_text):
    process = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    process.stdin.write("set timezone='UTC';"+query_text+'\n')
    process.stdin.flush()
    return process


def finish(process):
    process.stdin.write('\\q\n')
    process.stdin.flush()
    process.wait(timeout=10)
    assert process.returncode == 0, process.stderr.read()
    return process.stdout.read().strip()


def wait_for_lock(name):
    deadline = time.monotonic()+5
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event_type='Lock';") == '1':
            return
        time.sleep(.05)
    raise AssertionError(name+' did not reach the actual receipt dependency')


def run():
    indexing.setup()
    sql("create function public.icash_dealmachine_capacity_available(integer,uuid) returns boolean language sql stable set search_path='' as $$select public.icash_dealmachine_capacity_available($1)$$;")
    before = json.loads(read('tests/fixtures/preflight-receipt-ranking-before.json'))
    sql(before['definition'])
    assert sql(f"select md5(pg_get_functiondef('{before['signature']}'::regprocedure));") == before['checksum']
    sql(before['definition'].replace('public.icash_owner_preflight_due_at(', 'public.icash_owner_preflight_due_at_before('))
    sql('create table public.receipt_validation_dependency(id int);insert into public.receipt_validation_dependency values(1);create sequence public.fixture_receipt_reads;')
    proof = sql("select pg_get_functiondef('icash_research_private.owner_preflight_list_known(uuid,boolean)'::regprocedure);")
    assert 'begin\n select * into p' in proof
    sql(proof.replace('begin\n select * into p', "begin\n perform nextval('public.fixture_receipt_reads');\n perform id from public.receipt_validation_dependency;\n select * into p"))
    ordinary = json.loads(sql('select fixture_preflight_seed(31001);'))
    waiting = json.loads(sql('select fixture_preflight_seed(31002);'))
    ready = json.loads(sql('select fixture_ready_seed(31003);'))
    future = json.loads(sql('select fixture_preflight_seed(31004);'))
    sql(f"update icash_automation_tickets set state='complete',outcome='fixture_complete' where id='{ordinary['ticket']}';")
    sql(f"update icash_automation_tickets set owner_preview_retry_after=now()+interval '1 minute' where id='{future['ticket']}';")
    cases = [ordinary, waiting, ready, future]
    saved = [fixture.evidence(c) for c in cases]
    assert sql(query(ordinary, True)) == 'none'
    expected = [sql(query(c, True)) for c in (waiting, ready)]
    assert all(v != 'none' for v in expected)
    sql(read('config/preflight-receipt-ranking.sql'))
    for c in cases:
        assert sql(query(c)) == sql(query(c, True))
    sql('alter sequence public.fixture_receipt_reads restart;')
    blocker = start("begin;set local statement_timeout='30s';lock table public.receipt_validation_dependency in access exclusive mode;select 'receipt_locked';")
    processes = []
    try:
        fixture.wait_for_marker(blocker, 'receipt_locked')
        old = start("set statement_timeout='20s';set application_name='ranking-old';"+query(ordinary, True))
        processes.append(old)
        wait_for_lock('ranking-old')
        barrier = Barrier(32)

        def contender(n):
            barrier.wait(timeout=5)
            c = ordinary if n % 3 == 0 else future if n % 3 == 1 else waiting
            screening = c['screening'] if n % 3 != 2 else ordinary['screening']
            mode = 'force_generic_plan' if n % 2 else 'force_custom_plan'
            return sql(f"set role service_role;set lock_timeout='500ms';set plan_cache_mode='{mode}';"
                       "prepare rank(uuid,uuid) as select coalesce(public.icash_owner_preflight_due_at($1,$2)::text,'none');"
                       f"execute rank('{c['account']}','{screening}');")

        with ThreadPoolExecutor(max_workers=32) as pool:
            assert list(pool.map(contender, range(32))) == ['none']*32
        assert sql('select last_value from public.fixture_receipt_reads;') == '1', 'Unrelated selection must never enter receipt validation, even if its exception handler could hide a timeout'
        for n, c in enumerate((waiting, ready)):
            name = 'ranking-eligible-'+str(n)
            processes.append(start(f"set statement_timeout='20s';set application_name='{name}';"+query(c)))
            wait_for_lock(name)
        # Unrelated callers finish while predecessor and genuine proof users wait.
        assert old.poll() is None
        blocker.stdin.write('commit;\n')
        blocker.stdin.flush()
        finish(blocker)
        assert finish(old) == 'none'
        actual = [finish(p) for p in processes[1:]]
        assert actual == expected, (actual, expected)
    finally:
        for process in [blocker, *processes]:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
    assert [fixture.evidence(c) for c in cases] == saved
    fixture.assert_no_paid_work()
    print('PASS native receipt ranking: 32 generic/custom-plan callers finish across unrelated, future and mismatched retries while real receipt dependency is locked; predecessor blocks; eligible waiting/ready proofs remain mandatory; original evidence unchanged.')


if __name__ == '__main__':
    run()
