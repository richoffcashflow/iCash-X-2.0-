"""Exact financial admission races, on the fixed disposable localhost DB only."""
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
DATA = json.loads(subprocess.check_output(['node', '--experimental-strip-types', str(ROOT/'tests/helpers/financial-prequalification-fixture.mjs')], text=True))


def literal(value):
    return "'"+json.dumps(value, separators=(',', ':')).replace("'", "''")+"'::jsonb"


def args(account=None):
    account = account or DATA['account']
    scope = {**DATA['scope'], 'p_revision': DATA['revision'] if account == DATA['account'] else DATA['other']}
    return "'"+account+"',"+literal(scope)+","+literal(DATA['plan'])+","+literal(DATA['policy'])


def reserve(account=None):
    return 'select public.icash_reserve_research_discovery('+args(account)+');'


def estimate(account=None, empty=False):
    account = account or DATA['account']
    result = json.loads(sql('select public.icash_claim_discovery_estimate('+args(account)+','+literal(DATA['query'])+');'))
    if result['status'] == 'request':
        assert sql("select public.icash_finish_discovery_estimate('"+account+"','"+result['token']+"',"+literal(DATA['empty' if empty else 'positive'])+');') == 't'
    else:
        assert result['status'] == 'cached', result


def setup():
    for flag, expected in [('-h','127.0.0.1'),('-p','55443'),('-U','postgres'),('-d','icash_reliability')]:
        assert fixture.fixture.CMD[fixture.fixture.CMD.index(flag)+1] == expected
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_research_private cascade;drop schema if exists icash_call_offer_private cascade;drop schema public cascade;create schema public;')
    for key in ['setupSql', 'migration', 'seedSql', 'activateSql']:
        sql(DATA[key])


def waiting(name):
    deadline = time.monotonic()+5
    while sql("select exists(select 1 from pg_stat_activity where application_name='"+name+"' and wait_event_type='Lock');") != 't':
        assert time.monotonic()<deadline, name+' did not reach a lock'
        time.sleep(.025)


for mutation in ['update public.icash_accounts set bot_paused=true;',
                 'update icash_research_private.financial_settings set enabled=false;',
                 "update icash_research_private.exclusions set state='pending';"]:
    setup()
    estimate()
    holder = fixture.holder(mutation, 'financial_control_locked')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(sql, "set application_name='financial-admission-waits';"+reserve())
            waiting('financial-admission-waits')
            fixture.release(holder)
            assert pending.result() == 'f', mutation
        assert sql('select count(*) from public.icash_operation_spend;') == '0'
    finally:
        fixture.stop(holder)

setup()
estimate()
estimate(DATA['other'])
barrier = Barrier(2)
def contender(account):
    barrier.wait(timeout=5)
    return sql(reserve(account))
with ThreadPoolExecutor(max_workers=2) as pool:
    assert sorted(pool.map(contender, [DATA['account'], DATA['other']])) == ['f', 't']
assert sql('select count(*) from public.icash_operation_spend;') == '1'
assert sql('select count(*) from icash_research_private.query_claims;') == '1'

# Once a paid claim wins, Pause preserves that original one-use receipt.
setup()
estimate()
holder = fixture.holder(reserve(), 'financial_claimed')
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(sql, "set application_name='financial-pause-waits';update icash_accounts set bot_paused=true;")
        waiting('financial-pause-waits')
        fixture.release(holder)
        pending.result()
    assert sql("select state from icash_operation_spend;") == 'dispatched'
    assert sql(reserve()) == 'f'
finally:
    fixture.stop(holder)

setup()
estimate(empty=True)
barrier = Barrier(2)
def widen(_):
    barrier.wait(timeout=5)
    return sql('select public.icash_widen_financial_query('+args()+');')
with ThreadPoolExecutor(max_workers=2) as pool:
    assert sorted(pool.map(widen, range(2))) == ['f', 't']
assert sql('select count(*) from icash_research_private.financial_widenings;') == '1'
assert sql('select count(*) from public.icash_operation_spend;') == '0'
print('PASS native financial prequalification: concurrent paid claims, Pause and policy fences, original receipt preservation, and one free-only widening. No provider requests.')
