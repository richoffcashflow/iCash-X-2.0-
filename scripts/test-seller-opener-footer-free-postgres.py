"""Footer-copy migration versus real queue locks in disposable localhost PG."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('opener_fixture', ROOT/'scripts/test-seller-opener-bounded-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql
data = json.loads(subprocess.check_output(['node', str(ROOT/'tests/helpers/seller-opener-footer-free-fixture.mjs')], text=True))
PATCH = data['migration'].replace('\nbegin;\n', '\n', 1).removesuffix('commit;\n')
QUEUE = "set role service_role;set application_name='footer-queue-contender';"+data['queueSql']+';'
MIGRATE = "set application_name='footer-migration-contender';"+data['migration']


def setup(queued=False):
    for flag, expected in [('-h', '127.0.0.1'), ('-p', '55443'), ('-U', 'postgres'), ('-d', 'icash_reliability')]:
        assert fixture.fixture.CMD[fixture.fixture.CMD.index(flag)+1] == expected
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
    sql(data['setupSql']+data['seedSql'])
    sql('alter role service_role bypassrls;')
    if queued:
        assert sql(QUEUE)
        assert sql('select body from icash_text_messages;') == data['original']
    return sql('select to_jsonb(w) from icash_wallets w;')


def wait_for_lock(application):
    deadline = time.monotonic()+4
    while sql("select exists(select 1 from pg_stat_activity where application_name='"+application+"' and wait_event_type='Lock');") != 't':
        assert time.monotonic() < deadline, application+' did not wait for its original lock'
        time.sleep(.025)


def assert_new_copy(wallet):
    assert sql('select count(*) from icash_text_messages;') == '1'
    assert sql('select body from icash_text_messages;') == data['expected']
    assert sql('select body from icash_seller_opener_assignments;') == data['expected']
    assert sql("select variant='identity-v4' and learning_context='identity-v4' from icash_seller_opener_assignments;") == 't'
    assert sql("select a.message_id=m.id and a.account_id=m.account_id and a.thread_id=m.thread_id and o.owner_question_id=m.id from icash_seller_opener_assignments a join icash_text_messages m on m.id=a.message_id join icash_sms_seller_openings o on o.thread_id=a.thread_id;") == 't'
    assert sql("select state='ready' and provider_id is null and event_id is null and customer_price_micros=20800 and route_revision=1 from icash_text_messages;") == 't'
    assert sql('select count(*) from icash_operation_spend;') == '0'
    assert sql('select to_jsonb(w) from icash_wallets w;') == wallet


# A queue that began before migration committed waits at its original budget
# lock, then uses the new helper/assignment version together. No dispatch occurs.
wallet = setup()
holder = fixture.holder(PATCH, 'footer_migration_ready')
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(sql, QUEUE)
        wait_for_lock('footer-queue-contender')
        fixture.release(holder)
        assert future.result()
    assert_new_copy(wallet)
finally:
    fixture.stop(holder)

# Conversely, an original queue can finish first. Migration must see its
# committed exact v3 pair and update both, retaining IDs, price and route.
wallet = setup()
holder = fixture.holder('set local role service_role;'+data['queueSql']+';', 'footer_original_queue_ready')
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(sql, MIGRATE)
        wait_for_lock('footer-migration-contender')
        fixture.release(holder)
        future.result()
    assert_new_copy(wallet)
finally:
    fixture.stop(holder)
print('PASS native migration/real queue in both lock orders: one exact v4 message/assignment, original route/price and no provider operation or wallet change.')

# Ticket consumption does not take the budget lock. Exercise its actual atomic
# state-transition predicate while migration waits; active/consumed work must
# remain unchanged. This isolated transition does not invoke a worker/provider.
wallet = setup(queued=True)
sql("insert into icash_automation_tickets(account_id,kind,opener_message_id,state,expires_at) select account_id,'seller_opener',id,'issued',now()+interval '5 minutes' from icash_text_messages;")
old_message = sql('select to_jsonb(m) from icash_text_messages m;')
old_assignment = sql('select to_jsonb(a) from icash_seller_opener_assignments a;')
holder = fixture.holder('select 1 from icash_operating_budget where id=1 for update;', 'footer_budget_ready')
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(sql, MIGRATE)
        wait_for_lock('footer-migration-contender')
        assert sql("update icash_automation_tickets set state='consumed' where state='issued' and expires_at>now() returning state;") == 'consumed'
        fixture.release(holder)
        future.result()
    assert sql('select to_jsonb(m) from icash_text_messages m;') == old_message
    assert sql('select to_jsonb(a) from icash_seller_opener_assignments a;') == old_assignment
    assert sql('select state from icash_automation_tickets;') == 'consumed'
    assert sql('select count(*) from icash_operation_spend;') == '0'
    assert sql('select to_jsonb(w) from icash_wallets w;') == wallet
finally:
    fixture.stop(holder)
print('PASS native active-ticket consumption ahead of migration: original v3 body/version and consumed capability remain immutable; no sends or money changes.')
