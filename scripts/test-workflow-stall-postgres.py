"""Verify shared scheduler reads survive unrelated locked dependencies on local PG."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, 'PGPASSWORD': 'isolated-fixture-only', 'PGCONNECT_TIMEOUT': '5'}
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
       '-p', os.environ.get('ICASH_TEST_PG_PORT', '55443'), '-U', 'postgres', '-d', 'icash_reliability']
A = '00000000-0000-4000-8000-000000000001'
T = '00000000-0000-4000-8000-000000000005'

def run(query):
    return subprocess.run(CMD, input="set statement_timeout='3s';set lock_timeout='250ms';\n"+query,
                          text=True, capture_output=True, env=ENV, timeout=8)

def sql(query):
    result = run(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def hold(table):
    process = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env=ENV)
    process.stdin.write(f"begin;set local lock_timeout='2s';lock table {table} in access exclusive mode;select 'LOCKED';\n")
    process.stdin.flush()
    assert process.stdout.readline().strip() == 'LOCKED'
    return process

def release(process):
    process.stdin.write('rollback;\n'); process.stdin.close(); process.wait(timeout=5)
    assert process.returncode == 0, process.stderr.read()

assert sql('select current_database()') == 'icash_reliability'
sql('drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
sql("do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role;end if;end$$;")
sql((ROOT/'tests/fixtures/workflow-stall-schema.sql').read_text())
hours = (ROOT/'config/first-contact-hours.sql').read_text()
start = hours.index('create function public.icash_outreach_timezone')
end = hours.index('-- A submitted form')
sql(hours[start:end])
before = json.loads((ROOT/'tests/fixtures/workflow-stall-before.json').read_text())
for row in before:
    sql(row['definition'])
    sql(row['definition'].replace('icash_work_private.warm_seller_due(', 'icash_work_private.warm_before(')
        .replace('public.icash_sms_outreach_window_current(', 'public.hours_before('))
sql("create table capacity_dependency(allowed boolean);insert into capacity_dependency values(true);"
    "create table history_dependency(allowed boolean);insert into history_dependency values(true);"
    "create or replace function public.icash_outgoing_voice_capacity_open() returns boolean language plpgsql stable set search_path='' as $$begin return (select allowed from public.capacity_dependency);end$$;"
    "create or replace function public.icash_outreach_active_conversation(uuid,uuid,text,timestamptz) returns boolean language sql stable set search_path='' as $$select allowed from public.history_dependency$$;")
sql((ROOT/'config/workflow-stall-isolation.sql').read_text())
sql(f"insert into icash_screening_jobs values('{A}','{A}','{{\"propertyId\":\"fixture\"}}');"
    f"insert into icash_deal_files values('{A}','{A}','{A}','{{}}');"
    f"insert into icash_text_threads values('{T}','{A}','{A}','seller','+12145550123','auto',false,false,null,now()+interval '1 day',null,'America/Chicago',null);")

for mode in ['force_generic_plan', 'force_custom_plan']:
    capacity = hold('public.capacity_dependency')
    history = hold('public.history_dependency')
    try:
        # Demonstrate that both actual predecessors fail on unrelated dependencies.
        for statement in [f"select icash_work_private.warm_before('{A}')",
                          f"select public.hours_before('{A}','{T}','2026-11-09T18:00:00Z')"]:
            result = run(f'set plan_cache_mode={mode};'+statement)
            assert result.returncode != 0 and 'lock timeout' in result.stderr, result.stderr
        warm = f"set plan_cache_mode={mode};prepare warm(uuid) as select icash_work_private.warm_seller_due($1);execute warm('{A}');"
        daytime = f"set plan_cache_mode={mode};prepare daytime(uuid,uuid,timestamptz) as select public.icash_sms_outreach_window_current($1,$2,$3);execute daytime('{A}','{T}','2026-11-09T18:00:00Z');"
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(sql, [warm, daytime]*8))
        assert results == ['f', 't']*8, results
        # Overnight still needs the original history dependency; no blanket bypass.
        result = run(f"select public.icash_sms_outreach_window_current('{A}','{T}','2026-11-10T04:00:00Z')")
        assert result.returncode != 0 and 'lock timeout' in result.stderr
        sql(f"insert into icash_voice_contact_targets values('{A}','{A}','{A}','seller','+12145550123','fixture',null,now()+interval '1 day',true);"
            f"insert into icash_voice_jobs values('{A}','{A}','{A}',null,'ready',now(),'{A}',null,null,null);")
        result = run(f"select icash_work_private.warm_seller_due('{A}')")
        assert result.returncode != 0 and 'lock timeout' in result.stderr, 'A real callback must still check capacity'
        sql('delete from icash_voice_jobs;delete from icash_voice_contact_targets;')
    finally:
        release(history);release(capacity)
print('PASS native workflow isolation: both predecessor failures reproduced; 32 concurrent generic/custom reads progress under locked unrelated dependencies; overnight history and callback capacity remain required.')
