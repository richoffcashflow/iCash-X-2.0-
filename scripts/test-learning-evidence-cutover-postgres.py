"""Old training receipts versus evidence cutover on fixed disposable localhost PG."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import re
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('opener_fixture', ROOT/'scripts/test-seller-opener-bounded-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql
CUTOVER = (ROOT/'config/learning-evidence-refresh-cutover.sql').read_text()
PATCH = CUTOVER.replace('\nbegin;\n', '\n', 1).removesuffix('commit;\n')
FINISH = "select public.icash_finish_ranker_training('00000000-0000-4000-8000-000000000001','{\"status\":\"collecting\",\"model\":null}',10);"


def setup():
    for flag, expected in [('-h', '127.0.0.1'), ('-p', '55443'), ('-U', 'postgres'), ('-d', 'icash_reliability')]:
        assert fixture.fixture.CMD[fixture.fixture.CMD.index(flag)+1] == expected
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_learning_policy_private cascade;drop schema if exists icash_ranker_private cascade;drop schema public cascade;create schema public;')
    sql((ROOT/'tests/fixtures/learning-evidence-cutover.sql').read_text())
    original = (ROOT/'supabase/migrations/20261027035912_outcome_ranker.sql').read_text()
    sql(re.search(r'create function public\.icash_finish_ranker_training[\s\S]*?end \$\$;', original).group())
    return sql('select to_jsonb(e) from public.original_provider_evidence e;')


def waiting(application):
    deadline = time.monotonic()+4
    while sql("select exists(select 1 from pg_stat_activity where application_name='"+application+"' and wait_event_type='Lock');") != 't':
        assert time.monotonic() < deadline, application+' did not reach original lock'
        time.sleep(.025)


before = setup()
holder = fixture.holder(PATCH, 'learning_cutover_locked')
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(sql, "set application_name='training-finish-after-cutover';"+FINISH)
        waiting('training-finish-after-cutover')
        fixture.release(holder)
        assert pending.result() == 'f'
    assert sql('select count(*) from icash_ranker_private.runs;') == '0'
    assert sql('select to_jsonb(e) from public.original_provider_evidence e;') == before
finally:
    fixture.stop(holder)

before = setup()
holder = fixture.holder(FINISH, 'training_finish_locked')
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(sql, "set application_name='cutover-after-training-finish';"+CUTOVER)
        waiting('cutover-after-training-finish')
        fixture.release(holder)
        pending.result()
    assert sql('select count(*) from icash_ranker_private.runs;') == '1', 'Original completed run receipt must remain'
    assert sql("select lease_token is null and active_model is null from icash_ranker_private.settings;") == 't'
    assert sql("select refreshed_at='-infinity' from icash_ranker_private.samples;") == 't'
    assert sql('select generation=43 and due_at<=now() from icash_learning_queue;') == 't'
    assert sql('select to_jsonb(e) from public.original_provider_evidence e;') == before
finally:
    fixture.stop(holder)
print('PASS native learning cutover: both training-finish lock orders, original completed receipts, stale-label invalidation and generation wakeups.')
