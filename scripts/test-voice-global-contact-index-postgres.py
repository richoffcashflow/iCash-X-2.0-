"""Exact global voice-contact exclusion on a disposable localhost PostgreSQL DB."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'voice_contact_native_fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql


def read(path):
    return (ROOT/path).read_text()


def literal(value):
    return "'"+str(value).replace("'", "''")+"'"


def walk(node):
    yield node
    for child in node.get('Plans', []):
        yield from walk(child)


def contact_rows(plan):
    return sum((n.get('Actual Rows',0)+n.get('Rows Removed by Filter',0)
                +n.get('Rows Removed by Index Recheck',0))*n.get('Actual Loops',0)
               for n in walk(plan['Plan']) if n.get('Relation Name') == 'icash_operational_contacts')


def decode_values(output):
    """psql emits scalar JSON rows and multiline EXPLAIN JSON consecutively."""
    decoder = json.JSONDecoder()
    values = []
    while output.strip():
        output = output.lstrip()
        value, offset = decoder.raw_decode(output)
        values.append(value)
        output = output[offset:]
    return values


def metadata():
    return sql("""select jsonb_build_object(
      'functions',(select jsonb_agg(jsonb_build_object(
        'oid',p.oid,'signature',p.oid::regprocedure::text,
        'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,
        'config',p.proconfig,'volatility',p.provolatile,'definer',p.prosecdef)
        order by p.oid)
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','icash_recording_private') and p.prokind='f'),
      'relations',(select jsonb_agg(jsonb_build_object(
        'oid',c.oid,'name',c.oid::regclass::text,'owner',c.relowner,'acl',c.relacl,
        'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
        'definition',case when c.relkind='v' then pg_get_viewdef(c.oid) end)
        order by c.oid)
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname in ('public','icash_recording_private')
        and c.relkind in ('r','v')),
      'schemas',(select jsonb_agg(jsonb_build_object(
        'name',n.nspname,'owner',n.nspowner,'acl',n.nspacl) order by n.nspname)
       from pg_namespace n where n.nspname in ('public','icash_recording_private')));""")


def history():
    # Hash every fixture data row, including original unknown outcomes and DNC
    # receipts. Index DDL must not rewrite any evidence or source binding.
    tables = json.loads(sql("""select jsonb_agg(format('%I.%I',n.nspname,c.relname)
      order by n.nspname,c.relname) from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','icash_recording_private') and c.relkind='r';"""))
    parts = [f"select {literal(table)} as name,count(*) as rows,"
             f"md5(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text))) as hash "
             f"from {table} t" for table in tables]
    return sql('select jsonb_agg(to_jsonb(h) order by name) from ('+' union all '.join(parts)+') h;')


def slot_results():
    return json.loads(sql("""select jsonb_agg(jsonb_build_object(
      'label',label,'expected',expected_slot,
      'actual',icash_recording_private.voice_queue_slot_from_snapshot(account_id,job_id,'{}'))
      order by label) from public.fixture_voice_contact_cases;"""))


def assert_slots(results):
    assert results
    for result in results:
        assert result['actual'] == result['expected'], result


def execute_case(case):
    return 'execute original_busy_guard('+literal(case['job_id'])+','+literal(case['contact_key'])+');'


def run():
    # Reuse the repository's hardcoded fixture connection. Refuse an edited
    # target before the destructive schema reset, even if env PG* values exist.
    for flag, expected in [('-h','127.0.0.1'),('-p','55443'),('-U','postgres'),('-d','icash_reliability')]:
        assert fixture.CMD[fixture.CMD.index(flag)+1] == expected
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_recording_private cascade;drop schema public cascade;create schema public;')
    sql(read('tests/fixtures/voice-global-contact-index.sql'))
    original = json.loads(read('tests/fixtures/voice-global-contact-index-before.json'))
    start = original['definition'].index('   select 1 from public.icash_voice_jobs busy')
    end = original['definition'].index('\n  and not exists(select 1 from public.icash_live_conversations', start)
    captured_busy = original['definition'][start:end].replace('busy.id<>j.id','busy.id<>$1').replace(
        'other.contact_key=target.contact_key','other.contact_key=$2')
    assert captured_busy[:-1] == original['busy_query'], 'Only the outer NOT EXISTS parenthesis and parameters may differ'
    sql('create view public.icash_voice_contact_targets as '+original['target_view'])
    sql(original['definition'])
    sql("""revoke all on all functions in schema public,icash_recording_private from public,anon,authenticated;
      grant execute on function icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb) to service_role;""")
    signature = 'icash_recording_private.voice_queue_slot_from_snapshot(uuid,uuid,jsonb)'
    assert sql(f"select md5(pg_get_functiondef('{signature}'::regprocedure));") == original['definition_md5']
    assert sql("select md5(pg_get_viewdef('public.icash_voice_contact_targets'::regclass,true));") == original['view_md5']
    for role in ('anon','authenticated','service_role'):
        assert sql(f"select has_function_privilege('{role}','{signature}','execute');") == ('t' if role == 'service_role' else 'f')
    assert int(sql('select count(*) from public.icash_operational_contacts;')) >= 30654
    assert int(sql('select count(*) from public.icash_voice_jobs;')) >= 300191
    cases = json.loads(sql('select jsonb_agg(to_jsonb(c) order by label) from public.fixture_voice_contact_cases c;'))
    unmatched = next(case for case in cases if case['label'] == 'unmatched')
    assert unmatched['expected_busy'] is False
    before_metadata, before_history = metadata(), history()
    before_slots = slot_results()
    assert_slots(before_slots)
    index_query = "select jsonb_agg(indexname order by indexname) from pg_indexes where schemaname='public' and tablename='icash_operational_contacts';"
    before_indexes = set(json.loads(sql(index_query)) or [])
    migration = read('config/voice-global-contact-index.sql')
    versions = list((ROOT/'supabase/migrations').glob('*_voice_global_contact_index.sql'))
    assert len(versions) == 1 and versions[0].read_text() == migration
    # Keep the exact captured subquery: only bind its outer UUID/contact values.
    # No account restriction, state rewrite, source shortcut or DNC shortcut.
    prepare = 'prepare original_busy_guard(uuid,text) as select jsonb_build_object(\'busy\',exists('+original['busy_query'].rstrip().rstrip(';')+'));'
    case_queries = ''.join(execute_case(case) for case in cases)
    prepare += 'prepare original_busy_probe(uuid,uuid,uuid) as '+original['performance_query']+';'
    probe = 'explain(analyze,buffers,format json) execute original_busy_probe('+','.join(literal(unmatched[k]) for k in ('job_id','target_id','account_id'))+');'
    stages = []
    query = prepare
    for mode in ('auto','force_generic_plan'):
        stages.append(('before',mode))
        query += 'set plan_cache_mode='+mode+';'+case_queries+probe
    query += migration+'analyze public.icash_operational_contacts;'
    for mode in ('auto','force_generic_plan'):
        stages.append(('after',mode))
        query += 'set plan_cache_mode='+mode+';'+case_queries+probe
    # A warm generic plan must reflect uncertainty recorded later in this
    # transaction, then return to its original result after rollback. This is
    # visibility/plan reuse coverage, not a concurrent paid-admission claim.
    query += ('begin;set local plan_cache_mode=force_generic_plan;'
              +execute_case(unmatched)
              +"update public.icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry' "
               "where id=md5('busy-unmatched')::uuid;"
              +execute_case(unmatched)+'rollback;'+execute_case(unmatched))
    # One session reuses prepared statements through CREATE INDEX invalidation.
    values = decode_values(sql(query))
    assert len(values) == len(stages)*(len(cases)+1)+3, len(values)
    assert values[-3:] == [{'busy':False},{'busy':True},{'busy':False}], values[-3:]
    plans = {}
    offset = 0
    for stage in stages:
        for case in cases:
            assert values[offset] == {'busy':case['expected_busy']}, (stage,case,values[offset])
            offset += 1
        plans[stage] = values[offset][0]
        offset += 1
    added_indexes = set(json.loads(sql(index_query)) or [])-before_indexes
    assert len(added_indexes) == 1, added_indexes
    index_name = added_indexes.pop()
    measurements = []
    for mode in ('auto','force_generic_plan'):
        before, after = plans[('before',mode)], plans[('after',mode)]
        assert any(n.get('Relation Name') == 'icash_operational_contacts' and n.get('Rows Removed by Filter',0) >= 30000
                   for n in walk(before['Plan'])), (mode,before)
        assert any(n.get('Index Name') == index_name and n.get('Actual Loops',0)>0
                   for n in walk(after['Plan'])), (mode,after)
        before_blocks = before['Plan'].get('Shared Hit Blocks',0)+before['Plan'].get('Shared Read Blocks',0)
        after_blocks = after['Plan'].get('Shared Hit Blocks',0)+after['Plan'].get('Shared Read Blocks',0)
        # The busy-job join may change order. Check the targeted contact scan,
        # rather than claiming every unrelated buffer also decreases.
        assert contact_rows(after)*2 < contact_rows(before), (mode,contact_rows(before),contact_rows(after))
        measurements.append({'mode':mode,'buffers_before':before_blocks,'buffers_after':after_blocks,
                             'contact_rows_before':contact_rows(before),'contact_rows_after':contact_rows(after),
                             'ms_before':before['Execution Time'],'ms_after':after['Execution Time']})
    assert metadata() == before_metadata, 'Functions, view definitions, owners, ACLs and RLS must remain unchanged'
    assert history() == before_history, 'Original contacts, job states and DNC evidence must remain unchanged'
    assert slot_results() == before_slots
    print('PASS native global voice-contact index: exact cross-account busy/unknown guard and source/DNC joins; '
          'all cases unchanged in default and reused generic plans; original functions/ACLs/evidence unchanged. '
          'Offline synthetic PostgreSQL only; no providers. '+json.dumps(measurements))


if __name__ == '__main__':
    run()
