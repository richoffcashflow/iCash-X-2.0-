"""Actual configuration recovery over the production contact UNION; localhost only."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import time
from threading import Barrier

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql
ORIGINAL = json.loads((ROOT/'tests/fixtures/voice-configuration-target-lookup-before.json').read_text())
SIGNATURE = 'public.icash_recover_voice_configuration(text,text,text,text,timestamptz)'
RECOVER = "set role service_role;select public.icash_recover_voice_configuration('agent_fixture',repeat('a',64),repeat('a',64),repeat('b',40),clock_timestamp());"


def candidate(definition):
    query = definition[definition.index('  with busy_contacts'):definition.index('\n loop\n')]
    query = query.replace('p_config_hash', "repeat('a',64)").replace('p_agent', "'agent_fixture'")
    return re.sub(r'\bchecked\b', 'now()', query.replace('p_checked_at', 'now()')).replace(' for update of v skip locked', '')


def plan(query):
    return json.loads(sql('explain(analyze,buffers,format json) '+query))[0]


def walk(node):
    yield node
    for child in node.get('Plans', []):
        yield from walk(child)


def evidence():
    return sql("""select jsonb_build_object(
      'tickets',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_automation_tickets t),
      'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from public.icash_wallets w),
      'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from public.icash_operation_spend o));""")


def recovered_state():
    return """select jsonb_build_object(
      'ready',(select jsonb_agg(id order by id) from public.icash_voice_jobs where state='ready'),
      'audit',(select jsonb_agg(to_jsonb(r)-'recovered_at'-'provider_checked_at' order by job_id) from icash_recording_private.configuration_recoveries r));"""


def metadata():
    return sql(f"select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'volatility',provolatile,'security_definer',prosecdef) from pg_proc where oid='{SIGNATURE}'::regprocedure;")


def setup():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_recording_private cascade;drop schema public cascade;create schema public;')
    sql((ROOT/'tests/fixtures/voice-configuration-recovery-foundation.sql').read_text())
    # Roles survive schema resets in the shared native job. Match the verified
    # production service-role attribute even if an earlier suite created it.
    sql('alter role service_role bypassrls;')
    assert sql("select rolbypassrls from pg_roles where rolname='service_role';") == 't'
    sql((ROOT/'tests/fixtures/voice-configuration-target-lookup-union.sql').read_text())
    sql('create view public.icash_voice_contact_targets as '+ORIGINAL['target_view'])
    for path in ['config/unstarted-voice-configuration-recovery.sql', 'config/voice-configuration-recovery-schema-access.sql', 'config/bounded-voice-configuration-recovery.sql']:
        sql((ROOT/path).read_text())
    assert sql(f"select md5(pg_get_functiondef('{SIGNATURE}'::regprocedure));") == 'c4787929d87e8562fb556bfb7e34e8f0'
    sql("""insert into public.icash_voice_production_template(id,agent_config_hash) values(1,repeat('a',64));
      grant usage on schema public to service_role;
      grant select on all tables in schema public to service_role;
      grant update on public.icash_operating_budget,public.icash_voice_jobs to service_role;
      select public.fixture_configuration_seed(a,n,n%2=0) from generate_series(1,6) a cross join generate_series(1,600) n;
      update public.icash_screening_jobs set snapshot=jsonb_build_object('fetchedAt',now()-interval '25 hours');
      update public.icash_screening_jobs set snapshot=jsonb_build_object('fetchedAt',now())
       where id in(select public.fixture_configuration_id(a,1) from generate_series(1,6) a);
      -- Busy jobs use both branches and shared contact keys, just as production.
      update public.icash_voice_jobs set state='ready' where id in(
       select public.fixture_configuration_id(a,n) from generate_series(1,6) a cross join generate_series(501,600) n);
      analyze public.icash_voice_jobs;analyze public.icash_automation_tickets;
      analyze public.icash_contact_permissions;analyze public.icash_operational_contacts;
      analyze public.icash_dnc_verification_receipts;analyze public.icash_screening_jobs;
      analyze public.icash_accounts;analyze public.icash_wallets;analyze public.icash_voice_configs;
    """)


def run():
    setup()
    before_evidence, before_metadata = evidence(), metadata()
    before_query = candidate(ORIGINAL['definition'])
    # One snapshot compares full candidate rows, including their multiplicity.
    patch = (ROOT/'config/voice-configuration-recovery-target-lookup.sql').read_text()
    versions = list((ROOT/'supabase/migrations').glob('*_voice_configuration_recovery_target_lookup.sql'))
    assert len(versions) == 1 and versions[0].read_text() == patch
    old_join,new_join = patch.split('$old$')[1],patch.split('$new$')[1]
    after_definition = ORIGINAL['definition'].replace(old_join,new_join)
    after_query = candidate(after_definition)
    assert sql(f"with old_rows as ({before_query}),new_rows as ({after_query}),difference as ((select * from old_rows except all select * from new_rows) union all (select * from new_rows except all select * from old_rows)) select (select count(*) from old_rows)||':'||(select count(*) from new_rows)||':'||(select count(*) from difference);") == '6:6:0'
    before_plan = plan(before_query)
    baseline = sql('begin;'+RECOVER+'reset role;'+recovered_state()+'rollback;').splitlines()
    assert baseline[0] == '6'
    sql(patch)
    assert sql(f"select pg_get_functiondef('{SIGNATURE}'::regprocedure);") == after_definition.strip()
    assert metadata() == before_metadata
    after_plan = plan(after_query)
    after = sql('begin;'+RECOVER+'reset role;'+recovered_state()+'rollback;').splitlines()
    assert after == baseline, 'Real recovery updates and original private audit must be equivalent'
    assert evidence() == before_evidence
    # Assert the production fix's parameterized primary-key lookups, not a fragile
    # wall-clock ratio. Print both measured plans for review on each native run.
    nodes = list(walk(after_plan['Plan']))
    for relation in ('icash_contact_permissions','icash_operational_contacts'):
        assert any(n.get('Relation Name') == relation and 'COALESCE(v.permission_id, v.operational_contact_id)' in n.get('Index Cond','') for n in nodes), after_plan
    fanout = lambda p: sum(n.get('Rows Removed by Join Filter',0)*n.get('Actual Loops',1) for n in walk(p['Plan']))
    print(f"Measured UNION candidate: {before_plan['Execution Time']}ms -> {after_plan['Execution Time']}ms; join-filter rows {fanout(before_plan)} -> {fanout(after_plan)}; shared hits {before_plan['Plan']['Shared Hit Blocks']} -> {after_plan['Plan']['Shared Hit Blocks']}.")
    # Retire fixture accounts to focus contention on one recipient across sources.
    sql("update public.icash_accounts set bot_paused=true;select public.fixture_configuration_seed(20,1,false,'shared-recipient');select public.fixture_configuration_seed(21,1,true,'shared-recipient');")
    race_evidence = evidence()
    barrier = Barrier(24)
    def contender(_):
        barrier.wait()
        return int(sql(RECOVER))
    with ThreadPoolExecutor(max_workers=24) as pool:
        results = list(pool.map(contender,range(24)))
    assert sum(results) == 1 and max(results) == 1, results
    assert sql('select count(*) from icash_recording_private.configuration_recoveries;') == '1'
    assert evidence() == race_evidence, 'Competing recovery must not alter tickets, wallet or original operations'
    assert sql(RECOVER) == '0'
    # A committed Pause while the existing global admission lock is held wins.
    sql('select public.fixture_configuration_seed(30,1);')
    locker = subprocess.Popen(fixture.CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1,env=fixture.ENV)
    locker.stdin.write("begin;do $$begin perform 1 from public.icash_operating_budget where id=1 for update;end$$;select 'configuration-pause-locked';\n")
    locker.stdin.flush();fixture.wait_for_marker(locker,'configuration-pause-locked')
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(sql, "set application_name='configuration-pause-contender';"+RECOVER)
        deadline = time.monotonic()+5
        while sql("select exists(select 1 from pg_stat_activity where application_name='configuration-pause-contender' and wait_event_type='Lock');") != 't':
            assert time.monotonic() < deadline, 'Recovery did not wait for the original admission lock'
            time.sleep(0.02)
        locker.stdin.write("update public.icash_accounts set bot_paused=true where id=public.fixture_configuration_id(30,0);commit;\\q\n")
        locker.stdin.flush();locker.wait(timeout=5)
        assert pending.result() == '0'
    assert sql('select state from public.icash_voice_jobs where id=public.fixture_configuration_id(30,1);') == 'held'
    # Preserve SKIP LOCKED: another holder of a candidate job cannot stall recovery.
    sql('select public.fixture_configuration_seed(40,1);')
    locker = subprocess.Popen(fixture.CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1,env=fixture.ENV)
    locker.stdin.write("begin;do $$begin perform 1 from public.icash_voice_jobs where id=public.fixture_configuration_id(40,1) for update;end$$;select 'configuration-job-locked';\n")
    locker.stdin.flush();fixture.wait_for_marker(locker,'configuration-job-locked')
    assert sql(RECOVER) == '0'
    locker.stdin.write('rollback;\\q\n');locker.stdin.flush();locker.wait(timeout=5)
    assert sql(RECOVER) == '1'
    print('PASS configuration target lookup: actual production function/UNION, 6 accounts/3,600 contacts+jobs+tickets, exact multiset and real update/audit equivalence; 24 competing claims, cross-source recipient exclusion, committed Pause and SKIP LOCKED; original tickets, wallets and money evidence unchanged. No providers.')


if __name__ == '__main__':
    run()
