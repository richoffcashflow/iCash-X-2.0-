"""Exact seller-opener SELECT with synthetic helper fixtures; no providers."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('priority_fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql


def walk(node):
    yield node
    for child in node.get('Plans', []):
        yield from walk(child)


def run():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema public cascade;create schema public;')
    sql((ROOT/'tests/fixtures/text-message-thread-index.sql').read_text())
    source = json.loads((ROOT/'tests/fixtures/text-message-thread-scheduler-before.json').read_text())['definition']
    sql(source)
    start = source.index(' with candidates as materialized (')
    end = source.index(' if not found', start)
    # Preserve both original global NOT EXISTS clauses, final eligibility,
    # ordered row locking, SKIP LOCKED and LIMIT; remove only PL/pgSQL INTO.
    selection = source[start:end].replace('select ordered.* into thread', 'select ordered.*').strip()
    definition_query = "select pg_get_functiondef('public.icash_next_before_sms_inbound_campaign()'::regprocedure);"
    definition = sql(definition_query)
    history = """select md5(string_agg(v,',' order by v)) from (
      select to_jsonb(m)::text v from public.icash_text_messages m union all
      select to_jsonb(t)::text from public.icash_text_threads t union all
      select to_jsonb(w)::text from public.icash_wallets w) h;"""
    before, before_hash = sql(selection), sql(history)
    assert before and len(before.splitlines()) == 1
    selected, account = before.split('|')[:2]
    migration = (ROOT/'config/text-message-thread-index.sql').read_text()
    versions = list((ROOT/'supabase/migrations').glob('*_text_message_thread_index.sql'))
    assert len(versions) == 1 and versions[0].read_text() == migration
    # Same live prepared plan on both sides of DDL/ANALYZE; no planner forcing.
    plans_text = sql('set plan_cache_mode=force_generic_plan;prepare original_selection as '+selection+
                    'explain(analyze,buffers,format json) execute original_selection;'+migration+
                    'analyze public.icash_text_messages;explain(analyze,buffers,format json) execute original_selection;')
    decoder = json.JSONDecoder()
    plans = []
    while plans_text.strip():
        plan, offset = decoder.raw_decode(plans_text.lstrip())
        plans.append(plan[0])
        plans_text = plans_text.lstrip()[offset:]
    assert len(plans) == 2
    before_plan, after_plan = plans
    assert any(n.get('Index Name') == 'icash_text_messages_thread_lookup' for n in walk(after_plan['Plan']))
    before_hits, after_hits = (p['Plan']['Shared Hit Blocks'] for p in plans)
    assert after_hits*2 < before_hits, (before_hits, after_hits)
    assert sql(selection) == before and sql(history) == before_hash and sql(definition_query) == definition
    other = sql(f"select id from public.icash_accounts where id<>'{account}' order by id limit 1;")
    # Separate production FKs permit historical wrong/NULL account rows. The
    # original global thread exclusion must continue to block those too.
    for message_account in ["'"+account+"'::uuid", "'"+other+"'::uuid", 'null::uuid']:
        for state in ['ready', 'dispatching', 'accepted', 'delivered', 'needs_review', 'received', 'cancelled']:
            observed = sql('begin;set local plan_cache_mode=force_generic_plan;prepare late_selection as '+selection+'execute late_selection;'+
                f"insert into public.icash_text_messages values(md5('late-evidence')::uuid,{message_account},'{selected}',now(),'{state}','outgoing','preserved late evidence');"
                'execute late_selection;'+
                "update public.icash_text_messages set state='delivered',direction='incoming' where id=md5('late-evidence')::uuid;execute late_selection;rollback;")
            rows = observed.splitlines()
            assert len(rows) == 3 and rows[0] == before
            assert all(row.split('|')[0] != selected for row in rows[1:]), (message_account, state)
    assert sql(selection) == before and sql(history) == before_hash
    print(f'PASS text thread index: exact query/locks/functions and immutable history retained; every state including wrong/NULL-account messages blocks old thread; reused generic plan sees late evidence; shared hits {before_hits} -> {after_hits}. No providers.')


if __name__ == '__main__':
    run()
