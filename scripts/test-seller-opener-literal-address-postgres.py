"""Literal address/identity and final-copy proof in disposable localhost PostgreSQL."""
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
data = json.loads(subprocess.check_output(['node', str(ROOT/'tests/helpers/seller-opener-literal-address-fixture.mjs')], text=True))
QUEUE = "set role service_role;set application_name='literal-address-contender';"+data['queueSql']+';'


def setup():
    for flag, expected in [('-h', '127.0.0.1'), ('-p', '55443'), ('-U', 'postgres'), ('-d', 'icash_reliability')]:
        assert fixture.fixture.CMD[fixture.fixture.CMD.index(flag)+1] == expected
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
    sql(data['setupSql']+data['seedSql'])
    sql('alter role service_role bypassrls;')


setup()
assert sql(QUEUE) == '', 'Original queue reproduces unsupported literal # / -'
assert sql('select count(*) from icash_text_messages;') == '0'
sql(data['migration'])
wallet = sql('select to_jsonb(w) from icash_wallets w;')
barrier = Barrier(24)


def queue_once(_):
    barrier.wait(timeout=10)
    return sql(QUEUE)


with ThreadPoolExecutor(max_workers=24) as pool:
    results = list(pool.map(queue_once, range(24)))
assert len([r for r in results if r]) == 1, results
assert sql('select count(*) from icash_text_messages;') == '1'
assert sql('select body from icash_text_messages;') == data['expected']
assert sql('select body from icash_seller_opener_assignments;') == data['expected']
assert sql("select customer_price_micros=20800 and route_revision=1 and provider_id is null and state='ready' from icash_text_messages;") == 't'
assert sql('select a.message_id=m.id and o.owner_question_id=m.id from icash_text_messages m join icash_seller_opener_assignments a on a.thread_id=m.thread_id join icash_sms_seller_openings o on o.thread_id=m.thread_id;') == 't'
assert sql('select count(*) from icash_operation_spend;') == '0'
assert sql('select to_jsonb(w) from icash_wallets w;') == wallet
sql('update icash_accounts set bot_paused=true;')
assert sql("select icash_claim_text_before_owner_question(account_id,id,'+17205550100') from icash_text_messages;") == ''
assert sql('select count(*) from icash_operation_spend;') == '0'
print('PASS 24 concurrent native issuers create one literal-identity draft, unchanged price/money, real routing/observer and final saved Pause')

# The original queue locks the budget before reading the current thread/source.
# A committed source restriction must win over a waiting opener preparation.
for label, mutation in [('thread Pause', 'update icash_text_threads set paused=true;'),
                        ('expired contact', "update icash_text_threads set permission_until=now()-interval '1 second';"),
                        ('source review', 'update icash_text_threads set review_allowed=false;')]:
    setup()
    sql(data['migration'])
    blocker = fixture.holder('select 1 from icash_operating_budget where id=1 for update;'+mutation, 'identity_guard_locked')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, QUEUE)
            deadline = time.monotonic()+5
            while sql("select exists(select 1 from pg_stat_activity where application_name='literal-address-contender' and wait_event_type='Lock');") != 't':
                assert time.monotonic() < deadline, 'Queue did not reach original admission lock'
                time.sleep(.025)
            fixture.release(blocker)
            assert future.result() == '', label+' must win at the existing locked queue read'
        assert sql('select count(*) from icash_text_messages;') == '0'
        assert sql('select count(*) from icash_operation_spend;') == '0'
    finally:
        fixture.stop(blocker)
print('PASS native late thread Pause, expired evidence and source review beat waiting copy preparation; no provider operations')

# Invalid copy must skip the expensive/locking proof, while valid copy still
# requires the final source review. Original candidate and queue are loaded above.
setup()
sql(data['migration'])
sql("""alter function public.icash_sms_thread_review_current(uuid,uuid,boolean) rename to fixture_original_copy_review;
create function public.icash_sms_thread_review_current(a uuid,t uuid,check_hour boolean default true)
returns boolean language plpgsql as $$begin raise exception 'Full proof reached';end$$;""")
sql("update icash_customer_identities set company_name='Unsupported—Name';")
assert sql("select icash_seller_opener_candidate_body(account_id,id) from icash_text_threads;") == ''
sql("update icash_customer_identities set company_name='A-B Homes';")
try:
    sql("select icash_seller_opener_candidate_body(account_id,id) from icash_text_threads;")
    raise AssertionError('Valid copy bypassed full contact proof')
except AssertionError as error:
    assert 'Full proof reached' in str(error), str(error)
assert sql("select count(*) from icash_operation_spend;") == '0'
print('PASS native impossible copy skips proof; valid copy cannot bypass proof')

# A final source proof sees an identity/source change while the cheap-copy
# preview waits. This boundary is synthetic; production review remains byte-for-
# byte unchanged and the real queue's separate lock/routing checks run above.
for label, mutation in [
    ('changed sending principal', "update icash_customer_identities set principal='Different current principal';"),
    ('changed source evidence', 'update icash_text_threads set review_allowed=false;')
]:
    setup()
    sql(data['migration'])
    sql("""create table fixture_copy_identity_binding as select account_id,principal from icash_customer_identities;
    grant select on fixture_copy_identity_binding to service_role;
    alter function public.icash_sms_thread_review_current(uuid,uuid,boolean) rename to fixture_original_copy_review;
    create function public.icash_sms_thread_review_current(a uuid,t uuid,check_hour boolean default true)
    returns boolean language plpgsql as $$begin
    perform pg_advisory_xact_lock(987031);
    return public.fixture_original_copy_review(a,t,check_hour)
     and exists(select 1 from public.icash_customer_identities i join public.fixture_copy_identity_binding b
      on b.account_id=i.account_id and b.principal=i.principal where i.account_id=a);
    end$$;
    grant execute on function icash_sms_thread_review_current(uuid,uuid,boolean) to service_role;""")
    blocker = fixture.holder('select pg_advisory_xact_lock(987031);', 'final_copy_proof_locked')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, "set role service_role;set application_name='literal-copy-proof-contender';select icash_seller_opener_candidate_body(account_id,id) from icash_text_threads;")
            deadline = time.monotonic()+5
            while sql("select exists(select 1 from pg_stat_activity where application_name='literal-copy-proof-contender' and wait_event_type='Lock');") != 't':
                assert time.monotonic() < deadline, 'Preview did not reach final mandatory contact proof'
                time.sleep(.025)
            sql(mutation)
            fixture.release(blocker)
            assert future.result() == '', label+' must reject the preview before returning copy'
        assert sql(QUEUE) == '', label+' must also reject the unchanged real queue; no prior candidate body can authorize it'
        assert sql('select count(*) from icash_text_messages;') == '0'
        assert sql('select count(*) from icash_operation_spend;') == '0'
    finally:
        fixture.stop(blocker)
print('PASS native final copy review rejects concurrent identity/source changes; no provider actions or billing')

# Candidate text is never an input to the actual queue. A current permitted
# display-name change is reconstructed under its original locks and price.
setup()
sql(data['migration'])
assert sql('select icash_seller_opener_candidate_body(account_id,id) from icash_text_threads;') == data['expected']
sql("update icash_customer_identities set company_name='C-D Homes';")
assert sql(QUEUE) != ''
assert sql('select body from icash_text_messages;') == data['expected'].replace('A-B Homes', 'C-D Homes')
assert sql('select customer_price_micros=20800 and provider_id is null from icash_text_messages;') == 't'
assert sql('select count(*) from icash_operation_spend;') == '0'
print('PASS native real queue reconstructs current literal identity; a stale preview is not dispatch authority')
