"""Exact independent-search recovery races in a fixed disposable localhost DB."""
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
DATA = json.loads(subprocess.check_output(['node', str(ROOT/'tests/helpers/independent-search-continuation-fixture.mjs')], text=True))


def setup():
    for flag, expected in [('-h', '127.0.0.1'), ('-p', '55443'), ('-U', 'postgres'), ('-d', 'icash_reliability')]:
        assert fixture.fixture.CMD[fixture.fixture.CMD.index(flag)+1] == expected
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_research_private cascade;drop schema if exists icash_call_offer_private cascade;drop schema public cascade;create schema public;')
    sql(DATA['setupSql'])
    sql(DATA['seedSql'])
    sql('begin;'+DATA['migration']+'commit;')
    assert sql(DATA['claimSql']) == 'f', 'Rollout must start disabled'
    sql(DATA['activateSql'])


def waiting(name):
    deadline = time.monotonic()+5
    while sql("select exists(select 1 from pg_stat_activity where application_name='"+name+"' and wait_event_type='Lock');") != 't':
        assert time.monotonic() < deadline, name+' did not reach a lock'
        time.sleep(.025)


def snapshot():
    return sql('select md5(jsonb_agg(to_jsonb(o) order by operation_key)::text) from public.icash_operation_spend o;')


def control_wins(mutation):
    setup()
    holder = fixture.holder(mutation, 'independent_control_locked')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(sql, "set application_name='independent-continuation-waits';"+DATA['claimSql'])
            waiting('independent-continuation-waits')
            fixture.release(holder)
            assert pending.result() == 'f', mutation
        assert sql('select count(*) from icash_research_private.stalled_searches;') == '0'
        assert sql("select zip from icash_discovery_configs where account_id='"+DATA['account']+"';") == '75217'
    finally:
        fixture.stop(holder)


for mutation in [
    'update public.icash_accounts set bot_paused=true;',
    'update icash_research_private.settings set independent_query_continuation_enabled=false;',
    'update icash_research_private.settings set enabled=false;',
    'update public.icash_discovery_configs set auto_enabled=false;',
    "update public.icash_bot_setups set profile=jsonb_build_object('marketMode','city','market','75217');",
    "select 1 from public.icash_operating_budget where id=1 for update;insert into public.icash_operation_spend(operation_key,account_id,state) values('discovery:late-unscoped','"+DATA['other']+"','dispatched');",
]:
    control_wins(mutation)

setup()
before = snapshot()
barrier = Barrier(12)
def contender(_):
    barrier.wait(timeout=10)
    return sql(DATA['claimSql'])
with ThreadPoolExecutor(max_workers=12) as pool:
    results = list(pool.map(contender, range(12)))
assert results.count('t') == 1, results
assert results.count('f') == 11, results
assert sql('select count(*) from icash_research_private.stalled_searches;') == '1'
assert snapshot() == before, 'Continuation cannot release or fabricate spending'
assert sql("select configuration->>'research_list_id' is null from icash_research_private.stalled_searches;") == 't'
def literal(value):
    return "'"+json.dumps(value, separators=(',', ':')).replace("'", "''")+"'::jsonb"
assert sql("select public.icash_reserve_research_discovery('"+DATA['account']+"',"+literal({**DATA['scope'], 'p_market_mode':'nationwide', 'p_market':None})+","+literal(DATA['plan'])+","+literal(DATA['policy'])+");") == 'f', 'An old worker cannot purchase after rotation'
context = json.loads(sql("select public.icash_targeting_query_context(account_id,revision,next_page) from icash_discovery_configs where account_id='"+DATA['account']+"';"))
assert context['ready'] is True, 'The fresh query context must actually become eligible'
assert context['policy']['version'] == 'financial-prefilter-v1', 'New work uses the current query policy'
# A late receipt writer owns the original spend row: skip, never deadlock.
setup()
holder = fixture.holder("select 1 from public.icash_operation_spend where operation_key='"+DATA['operation']+"' for update;", 'receipt_locked')
try:
    assert sql(DATA['claimSql']) == 'f'
    assert sql('select count(*) from icash_research_private.stalled_searches;') == '0'
finally:
    fixture.stop(holder)
# Fail the migration before any staged setting survives predecessor drift.
setup()
sql('alter table icash_research_private.settings drop column independent_query_continuation_enabled;')
try:
    sql('begin;'+DATA['migration']+'commit;')
    raise AssertionError('Predecessor drift did not abort')
except AssertionError as error:
    assert 'Independent search continuation prerequisite changed' in str(error), str(error)
assert sql("select count(*) from information_schema.columns where table_schema='icash_research_private' and table_name='settings' and column_name='independent_query_continuation_enabled';") == '0'
print('PASS native independent-query recovery: concurrent Pause/settings/scope/source changes, once-only 12-way recovery, immutable holds, stale-worker admission, late writer isolation and atomic drift rollback.')
