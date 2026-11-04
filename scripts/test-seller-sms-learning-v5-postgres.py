"""Prospective SMS allocation versus real queue locks in disposable localhost PG."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
from threading import Barrier
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('opener_fixture', ROOT/'scripts/test-seller-opener-bounded-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql
data = json.loads(subprocess.check_output(['node', str(ROOT/'tests/helpers/seller-sms-learning-v5-fixture.mjs')], text=True))
PATCH = data['migration'].replace('\nbegin;\n', '\n', 1).removesuffix('commit;\n')
QUEUE = "set role service_role;set application_name='sms-v5-queue';"+data['queueSql']+';'
MIGRATE = "set application_name='sms-v5-migration';"+data['migration']+data['enableSql']


def setup(migrated=True, enabled=True):
    for flag, expected in [('-h', '127.0.0.1'), ('-p', '55443'), ('-U', 'postgres'), ('-d', 'icash_reliability')]:
        assert fixture.fixture.CMD[fixture.fixture.CMD.index(flag)+1] == expected
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_learning_policy_private cascade;drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
    sql(data['setupSql']+data['seedSql'])
    sql('alter role service_role bypassrls;')
    if migrated:
        sql(data['migration'])
        if enabled:
            sql(data['enableSql'])
    return sql('select to_jsonb(w) from icash_wallets w;')


def wait_for_lock(application):
    deadline = time.monotonic()+4
    while sql("select exists(select 1 from pg_stat_activity where application_name='"+application+"' and wait_event_type='Lock');") != 't':
        assert time.monotonic() < deadline, application+' did not wait for its original lock'
        time.sleep(.025)


def assert_one_v5(wallet):
    assert sql('select count(*) from icash_text_messages;') == '1'
    assert sql('select count(*) from icash_seller_opener_assignments;') == '1'
    assert sql('select count(*) from icash_learning_policy_private.decisions;') == '1'
    assert sql("select a.learning_context='identity-v5' and a.learning_policy_version='evidence-v2' and a.message_id=m.id and a.account_id=m.account_id and a.thread_id=m.thread_id and a.body=m.body and o.owner_question_id=m.id and p.id=a.learning_decision_id from icash_seller_opener_assignments a join icash_text_messages m on m.id=a.message_id join icash_sms_seller_openings o on o.thread_id=a.thread_id join icash_learning_policy_private.decisions p on p.id=a.learning_decision_id;") == 't'
    assert sql("select state='ready' and provider_id is null and event_id is null and customer_price_micros=20800 and route_revision=1 and length(body)<=160 and position('STOP' in body)=0 from icash_text_messages;") == 't'
    assert sql('select count(*) from icash_operation_spend;') == '0'
    assert sql('select to_jsonb(w) from icash_wallets w;') == wallet


def assert_one_v4(wallet):
    assert sql('select count(*) from icash_text_messages;') == '1'
    assert sql('select count(*) from icash_seller_opener_assignments;') == '1'
    assert sql('select body from icash_text_messages;') == data['legacyBody']
    assert sql("select a.learning_context='identity-v4' and a.learning_decision_id is null and a.message_id=m.id and a.account_id=m.account_id and a.thread_id=m.thread_id and a.body=m.body and o.owner_question_id=m.id from icash_seller_opener_assignments a join icash_text_messages m on m.id=a.message_id join icash_sms_seller_openings o on o.thread_id=a.thread_id;") == 't'
    assert sql('select count(*) from icash_learning_policy_private.decisions;') == '0'
    assert sql('select count(*) from icash_operation_spend;') == '0'
    assert sql('select to_jsonb(w) from icash_wallets w;') == wallet


def run():
    # This invocation compiled the OLD queue before waiting on the budget lock.
    # It must finish with the unchanged legacy helper/copy after migration, not
    # mix an old v4 renderer with a newly created immutable v5 assignment.
    wallet = setup(migrated=False)
    holder = fixture.holder(PATCH+data['enableSql'], 'sms_v5_migration_ready')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, QUEUE)
            wait_for_lock('sms-v5-queue')
            fixture.release(holder)
            assert future.result()
        assert_one_v4(wallet)
        original_message = sql('select to_jsonb(m) from icash_text_messages m;')
        original_assignment = sql('select to_jsonb(a) from icash_seller_opener_assignments a;')
        sql('select fixture_seed_admission(2,2);')
        wallets = sql('select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w;')
        assert sql(QUEUE)
        assert sql('select count(*) from icash_text_messages;') == '2'
        assert sql('select count(*) from icash_seller_opener_assignments;') == '2'
        assert sql('select count(*) from icash_learning_policy_private.decisions;') == '1'
        assert sql("select a.learning_context='identity-v5' and a.learning_policy_version='evidence-v2' and a.message_id=m.id and a.account_id=m.account_id and a.thread_id=m.thread_id and a.body=m.body and o.owner_question_id=m.id and p.id=a.learning_decision_id from icash_seller_opener_assignments a join icash_text_messages m on m.id=a.message_id join icash_sms_seller_openings o on o.thread_id=a.thread_id join icash_learning_policy_private.decisions p on p.id=a.learning_decision_id where a.learning_context='identity-v5';") == 't'
        assert sql("select to_jsonb(m) from icash_text_messages m join icash_seller_opener_assignments a on a.message_id=m.id where a.learning_context='identity-v4';") == original_message
        assert sql("select to_jsonb(a) from icash_seller_opener_assignments a where a.learning_context='identity-v4';") == original_assignment
        assert sql('select count(*) from icash_operation_spend;') == '0'
        assert sql('select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w;') == wallets
    finally:
        fixture.stop(holder)

    # A queue that wins first is permanently v4. The prospective migration and
    # activation cannot rewrite its body or convert its original assignment.
    wallet = setup(migrated=False)
    holder = fixture.holder('set local role service_role;'+data['queueSql']+';', 'sms_v4_queue_ready')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, MIGRATE)
            wait_for_lock('sms-v5-migration')
            fixture.release(holder)
            future.result()
        assert_one_v4(wallet)
    finally:
        fixture.stop(holder)

    # Competing real queues serialize under their original locks. Preview does
    # not create an assignment or decision; the sole actual queue creates both.
    wallet = setup()
    assert sql(data['candidateSql'])
    assert sql('select count(*) from icash_learning_policy_private.decisions;') == '0'
    barrier = Barrier(2)
    def queue(_):
        barrier.wait(timeout=5)
        return sql(QUEUE)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(queue, range(2)))
    assert sum(bool(result) for result in results) == 1
    assert_one_v5(wallet)
    original_message = sql('select to_jsonb(m) from icash_text_messages m;')
    original_assignment = sql('select to_jsonb(a) from icash_seller_opener_assignments a;')
    sql('select icash_set_seller_sms_learning_enabled(false);')
    assert sql(QUEUE) == ''
    assert sql('select to_jsonb(m) from icash_text_messages m;') == original_message
    assert sql('select to_jsonb(a) from icash_seller_opener_assignments a;') == original_assignment

    # A thread Pause that commits while final queue selection waits is retained;
    # no assignment, decision, text or provider operation survives that race.
    wallet = setup()
    holder = fixture.holder('update icash_text_threads set paused=true;', 'sms_v5_pause_ready')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, QUEUE)
            wait_for_lock('sms-v5-queue')
            fixture.release(holder)
            assert future.result() == ''
        for table in ['icash_text_messages', 'icash_seller_opener_assignments', 'icash_learning_policy_private.decisions', 'icash_operation_spend']:
            assert sql('select count(*) from '+table+';') == '0', table
        assert sql('select to_jsonb(w) from icash_wallets w;') == wallet
    finally:
        fixture.stop(holder)
    print('PASS native SMS v5: old compiled queue finishes v4 across migration, future queue creates v5, both lock orders, immutable history, concurrent one-assignment/one-decision queue, deactivation and competing Pause; original price/route/wallet and no provider work.')


if __name__ == '__main__':
    run()
