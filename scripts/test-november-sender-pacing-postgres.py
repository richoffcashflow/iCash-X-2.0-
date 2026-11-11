"""Concurrent cold admissions share one physical-number pacing lock, offline."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import importlib.util

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', root / 'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql

def race(queries):
    barrier = Barrier(len(queries))
    def run(query):
        barrier.wait(timeout=20)
        return sql(query)
    with ThreadPoolExecutor(max_workers=len(queries)) as threads:
        return list(threads.map(run, queries))

def main():
    assert sql('select current_database()') == 'icash_reliability'
    sql('drop schema if exists icash_sender_private cascade;drop schema if exists icash_text_receipt_private cascade;'
        'drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
    sql((root / 'tests/fixtures/contiguity-volume-predecessors.sql').read_text())
    sql((root / 'tests/fixtures/contiguity-volume-admission.sql').read_text())
    migration, = (root / 'supabase/migrations').glob('*_contiguity_sender_volume.sql')
    sql(migration.read_text())
    sql((root / 'config/november-sender-pacing.sql').read_text())
    sql((root / 'config/november-sender-200.sql').read_text())
    sql((root / 'config/november-additional-sender-pacing.sql').read_text())
    sql((root / 'config/november-11-sender-pacing.sql').read_text())
    sql('grant usage on schema public to service_role;')
    # Freeze only clock reads in the real admission functions. Run at a fixed
    # daytime instant regardless of the CI runner's clock; retain original locks.
    sql("create function public.fixture_clock() returns timestamptz language sql stable as $$select '2026-11-08T17:00:00Z'::timestamptz$$;")
    for name in ['icash_sender_private.room(text,boolean,uuid,text)',
                 'icash_sender_private.take(text,uuid,text,boolean,uuid,uuid,text,boolean)']:
        definition = sql(f"select pg_get_functiondef('{name}'::regprocedure)")
        sql(definition.replace('statement_timestamp()', 'public.fixture_clock()').replace('clock_timestamp()', 'public.fixture_clock()'))
    line = "'+16027722055'"
    def contenders(prefix):
        return [f"set role service_role;select icash_sender_private.take('cold-{i}',md5('{prefix}{i}')::uuid,{line},true)" for i in range(8)]
    assert race(contenders('empty')).count('t') == 1, 'Only one concurrent send may start in three minutes'
    assert sql(f"select icash_sender_private.take('reply',md5('reply')::uuid,{line},false)") == 't'
    for phone in ['+14357242174', '+15056019451', '+15055072937', '+15127791343', '+18623812530']:
        assert sql(f"select icash_sender_private.take('independent',md5('{phone}')::uuid,'{phone}',true)") == 't'
    sql('truncate icash_sender_private.uses;')
    sql(f"insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'history',md5(i::text)::uuid,{line},true,public.fixture_clock()-interval '30 minutes' from generate_series(1,19)i;")
    assert race(contenders('hour')).count('t') == 1, 'Last hourly slot is atomic across accounts/channels'
    sql('truncate icash_sender_private.uses;')
    sql(f"insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'history',md5(i::text)::uuid,{line},true,public.fixture_clock()-interval '2 hours' from generate_series(1,199)i;")
    assert race(contenders('day')).count('t') == 1, 'Last daily slot is atomic'
    assert sql(f'select count(*) from icash_sender_private.uses where sender={line}') == '200'
    print('PASS native November pacing: one cold admission under contention, independent lines, transactional headroom, atomic hourly/daily limits')

if __name__ == '__main__':
    main()
