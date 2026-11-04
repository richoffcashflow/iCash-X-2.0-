"""Exact query admission and competing controls on disposable localhost PG only."""
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
DATA = json.loads(subprocess.check_output(['node', str(ROOT/'tests/helpers/targeting-query-binding-fixture.mjs')], text=True))


def literal(value):
    return "'"+json.dumps(value, separators=(',', ':')).replace("'", "''")+"'::jsonb"


def claim(account=None, scope=None, plan=None, policy=None):
    return "select public.icash_reserve_research_discovery('"+(account or DATA['account'])+"',"+literal(scope or DATA['scope'])+","+literal(plan or DATA['plan'])+","+literal(policy or DATA['policy'])+");"


def setup():
    for flag, expected in [('-h','127.0.0.1'),('-p','55443'),('-U','postgres'),('-d','icash_reliability')]:
        assert fixture.fixture.CMD[fixture.fixture.CMD.index(flag)+1] == expected
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_research_private cascade;drop schema if exists icash_call_offer_private cascade;drop schema public cascade;create schema public;')
    sql(DATA['setupSql'])
    sql(DATA['migration'])
    sql(DATA['seedSql'])
    sql(DATA['activateSql'])


def waiting(name):
    deadline = time.monotonic()+5
    while sql("select exists(select 1 from pg_stat_activity where application_name='"+name+"' and wait_event_type='Lock');") != 't':
        assert time.monotonic()<deadline, name+' did not reach a lock'
        time.sleep(.025)


def assert_empty():
    assert sql('select count(*) from public.icash_operation_spend;') == '0'
    assert sql('select count(*) from icash_research_private.query_claims;') == '0'
    assert sql('select count(*) from icash_research_private.targeting_query_admissions;') == '0'


def control_wins(mutation):
    setup()
    holder = fixture.holder(mutation, 'query_control_locked')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending=pool.submit(sql,"set application_name='query-admission-waits';"+claim())
            waiting('query-admission-waits')
            fixture.release(holder)
            assert pending.result() == 'f', mutation
        assert_empty()
    finally:
        fixture.stop(holder)


# Controls which do not take budget still serialize on the exact checked row.
control_wins('update icash_research_private.targeting_experiments set enabled=false;')
control_wins("update icash_research_private.exclusions set state='pending';")
control_wins("update icash_research_private.targeting_query_settings set list_id='another-list';")
control_wins("select 1 from public.icash_operating_budget where id=1 for update;insert into icash_research_private.exclusion_items values('new-pending',null);")
control_wins('update public.icash_accounts set bot_paused=true;')

# If paid admission wins, a later pause waits and preserves its original receipt.
setup()
holder=fixture.holder(claim(), 'query_admitted')
try:
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending=pool.submit(sql,"set application_name='query-disable-waits';update icash_research_private.targeting_experiments set enabled=false;")
        waiting('query-disable-waits')
        fixture.release(holder)
        pending.result()
    assert sql("select state from public.icash_operation_spend;") == 'dispatched'
    assert sql('select count(*) from icash_research_private.query_claims;') == '1'
    assert sql('select count(*) from icash_research_private.targeting_query_admissions;') == '0'
finally:
    fixture.stop(holder)

# Two original operations cannot acquire the same mutable list/ZIP concurrently.
setup()
barrier=Barrier(2)
def concurrent_claim(account):
    scope={**DATA['scope'],'p_revision':DATA['revision'] if account==DATA['account'] else DATA['other']}
    if account==DATA['other']:
        sql("insert into public.icash_discovery_filter_cursors(account_id,revision,zip,strategy,next_page,exhausted,pages) values('"+account+"','"+account+"','75217','"+DATA['plan']['strategy']+"',1,false,0);")
    barrier.wait(timeout=5)
    return sql(claim(account,scope))
with ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(concurrent_claim,[DATA['account'],DATA['other']]))
assert sorted(results)==['f','t'], results
assert sql('select count(*) from public.icash_operation_spend;')=='1'
assert sql('select count(*) from icash_research_private.query_claims;')=='1'
assert sql('select count(*) from icash_research_private.targeting_query_admissions;')=='0'

# The direct filtered API cannot mint its own transaction-bound list authority.
setup()
s=DATA['scope'];args=[DATA['account'],s['p_zip'],s['p_revision'],s['p_page'],s['p_per_page'],s['p_rate'],s['p_unit'],s['p_permission_until'],s['p_setup_revision'],s['p_market_mode'],s['p_market']]
query='select public.icash_reserve_and_claim_filtered_discovery('+','.join("'"+str(v).replace("'","''")+"'" for v in args)+','+literal(DATA['plan'])+');'
assert sql(query)=='f'
assert_empty()
print('PASS native targeting query binding: competing experiment/list/Pause controls, both lock orders, global overlapping admission, preserved original receipt and direct bypass denial.')
