"""Bystander continuation under real concurrent controls; fixed localhost fixture only."""
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
DATA = json.loads(subprocess.check_output(['node', str(ROOT/'tests/helpers/market-hold-continuation-fixture.mjs')], text=True))


def setup():
    for flag, expected in [('-h', '127.0.0.1'), ('-p', '55443'), ('-U', 'postgres'), ('-d', 'icash_reliability')]:
        assert fixture.fixture.CMD[fixture.fixture.CMD.index(flag)+1] == expected
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_research_private cascade;drop schema if exists icash_call_offer_private cascade;drop schema public cascade;create schema public;')
    for key in ['setupSql', 'seedSql']:
        sql(DATA[key])
    sql('begin;'+DATA['migration']+'commit;')
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
    holder = fixture.holder(mutation, 'market_control_locked')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(sql, "set application_name='market-continuation-waits';"+DATA['claimSql'])
            waiting('market-continuation-waits')
            fixture.release(holder)
            assert pending.result() == 'f', mutation
        assert sql('select count(*) from icash_research_private.market_hold_continuations;') == '0'
        assert sql("select zip from icash_discovery_configs where account_id='"+DATA['account']+"';") == '75217'
    finally:
        fixture.stop(holder)


for mutation in [
    'update public.icash_accounts set bot_paused=true;',
    'update icash_research_private.market_hold_continuation_settings set enabled=false;',
    'update icash_research_private.financial_settings set enabled=false;',
    "update icash_research_private.exclusions set state='pending';",
    "update icash_research_private.targeting_query_settings set list_id='different';",
    "update public.icash_bot_setups set profile=jsonb_build_object('marketMode','city','market','75217');",
    "select 1 from public.icash_operating_budget where id=1 for update;insert into public.icash_operation_spend(operation_key,account_id,state) values('discovery:late-unscoped','"+DATA['other']+"','dispatched');",
    "select 1 from public.icash_operating_budget where id=1 for update;insert into public.icash_operation_spend(operation_key,account_id,state) values('discovery:own-late','"+DATA['account']+"','reserved');",
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
assert sql('select count(*) from icash_research_private.market_hold_continuations;') == '1'
assert snapshot() == before
# A late admission against the original worker snapshot cannot buy after rotation.
def literal(value):
    return "'"+json.dumps(value, separators=(',', ':')).replace("'", "''")+"'::jsonb"
assert sql("select public.icash_reserve_research_discovery('"+DATA['account']+"',"+literal({**DATA['scope'], 'p_market_mode':'nationwide', 'p_market':None})+","+literal(DATA['plan'])+","+literal(DATA['policy'])+");") == 'f'
# A new conflicting operation in the selected ZIP keeps the exact final context held.
selected = sql("select zip from icash_discovery_configs where account_id='"+DATA['account']+"';")
sql("insert into public.icash_operation_spend(operation_key,account_id,state) values('discovery:new-selected-hold','"+DATA['other']+"','dispatched');insert into icash_research_private.estimates(operation_key,account_id,query) values('discovery:new-selected-hold','"+DATA['other']+"',jsonb_build_object('locations',jsonb_build_array(jsonb_build_object('type','zip_code','code','"+selected+"'))));")
assert sql("select (public.icash_targeting_query_context(account_id,revision,next_page)->>'ready') from public.icash_discovery_configs where account_id='"+DATA['account']+"';") == 'false'
# Late schema drift rolls back all changes with the caller-owned receipt transaction.
setup()
sql('drop function public.icash_continue_held_inventory(uuid,uuid,integer);drop table icash_research_private.market_hold_continuations;drop table icash_research_private.market_hold_continuation_settings;')
for definition in json.loads((ROOT/'tests/fixtures/market-hold-continuation-before.json').read_text()):
    sql(definition['definition'])
sql("create or replace function public.icash_inventory_scope_allowed(p_account uuid,p_zip text) returns boolean language sql stable set search_path='' as $$select false$$;")
try:
    sql('begin;'+DATA['migration']+'commit;')
    raise AssertionError('Predecessor drift did not abort')
except AssertionError as error:
    assert 'Market hold continuation prerequisite changed' in str(error), str(error)
assert sql("select to_regclass('icash_research_private.market_hold_continuations') is null;") == 't'
print('PASS native market hold continuation: concurrent settings/Pause/source changes, 12-way original-scope claim, immutable unknowns, exact stale/new-conflict gates and atomic drift rollback.')
