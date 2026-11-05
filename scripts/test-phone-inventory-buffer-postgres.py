"""Read-only inventory projection under concurrent claim changes; localhost only."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
read = fixture.read
COUNT = "select icash_pending_opportunity_count(fixture_phone_id(1000));"


def sql(query):
    # Match verified production configuration; the Docker database defaults to JIT on.
    return fixture.sql('set jit=off;'+query)


def run():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema public cascade;create schema public;')
    sql(read('tests/fixtures/opportunity-schema.sql'))
    sql(read('tests/fixtures/phone-inventory-buffer.sql'))
    tables = ('icash_screening_jobs', 'icash_opportunity_outcomes', 'icash_automation_tickets',
              'icash_property_controls', 'icash_owner_contacts', 'icash_operation_spend',
              'icash_customer_identities', 'icash_operational_contacts', 'icash_inventory_claims',
              'icash_contact_permissions', 'icash_deal_files')
    sql('analyze '+','.join('public.'+table for table in tables)+';')
    for item in json.loads(read('tests/fixtures/phone-inventory-buffer-before.json')):
        sql(item['definition'])
        assert sql(f"select md5(pg_get_functiondef('{item['signature']}'::regprocedure));") == item['hash']
    sql('revoke all on function icash_pending_opportunity_count(uuid) from public,anon,authenticated;grant execute on function icash_pending_opportunity_count(uuid),icash_operational_phone(text),icash_owner_preflight_empty(uuid,uuid,jsonb) to service_role;grant usage on schema public to service_role;grant select on all tables in schema public to service_role;')
    assert sql(COUNT) == '25'
    before = sql('select fixture_phone_evidence();')
    metadata = sql("select proacl::text||':'||provolatile::text||':'||prosecdef::text from pg_proc where oid='icash_pending_opportunity_count(uuid)'::regprocedure;")
    sql(read('config/phone-inventory-opportunity-buffer.sql'))
    assert sql(COUNT) == '11'
    assert sql('set role service_role;begin read only;'+COUNT+'commit;') == '11'
    assert sql('select fixture_phone_evidence();') == before
    assert sql("select proacl::text||':'||provolatile::text||':'||prosecdef::text from pg_proc where oid='icash_pending_opportunity_count(uuid)'::regprocedure;") == metadata
    for role in ('anon', 'authenticated'):
        assert sql(f"select has_function_privilege('{role}','icash_pending_opportunity_count(uuid)','execute');") == 'f'
    # Explain the installed SQL body so the plan includes its nested predicates.
    definition = sql("select pg_get_functiondef('icash_pending_opportunity_count(uuid)'::regprocedure);")
    projection = definition.split('AS $function$\n', 1)[1].rsplit('\n$function$', 1)[0].strip().rstrip(';')
    projection = projection.replace('p_account', 'fixture_phone_id(1000)')
    plan = json.loads(sql("set statement_timeout='2s';explain (analyze,buffers,settings,format json) "+projection+';'))[0]
    assert plan['Settings']['jit'] == 'off', 'Native fixture must match verified production JIT setting'
    print('Phone inventory projection plan: '+json.dumps({
        'executionMs': plan['Execution Time'], 'planningMs': plan['Planning Time'],
        'totalCost': plan['Plan']['Total Cost'], 'sharedHits': plan['Plan']['Shared Hit Blocks'],
        'sharedReads': plan['Plan']['Shared Read Blocks'], 'settings': plan['Settings'],
    }), flush=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert set(pool.map(lambda _: sql("set statement_timeout='2s';"+COUNT), range(16))) == {'11'}
    assert sql('select fixture_phone_evidence();') == before
    holder = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        # Uncommitted release remains invisible; a plain projection must not
        # block on the other account's inventory lock or change its evidence.
        holder.stdin.write("set jit=off;begin;set local statement_timeout='10s';update icash_inventory_claims set cooldown_until=now()-interval '1 second' where screening_id=fixture_phone_id(1);select 'inventory_locked';\n")
        holder.stdin.flush()
        fixture.wait_for_marker(holder, 'inventory_locked')
        assert sql("set statement_timeout='1s';"+COUNT) == '11'
        assert holder.poll() is None
        holder.stdin.write('commit;\n\\q\n')
        holder.stdin.flush()
        holder.wait(timeout=5)
        assert holder.returncode == 0, holder.stderr.read()
        assert sql(COUNT) == '12', 'Next statement restores inventory after the claim release commits'
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)
    # A new genuine unknown purchase still takes precedence over projection.
    sql("select fixture_phone_seed(26,'unknown');update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"prop_2\"') where id=fixture_phone_id(26);")
    assert sql(COUNT) == '14'
    assert sql("select count(*) from icash_operation_spend where state='dispatched';") == '8'
    print('PASS native phone inventory buffer: reproduced25→11, concurrent reads preserve evidence, locked claim release is nonblocking and fresh after commit, new unknown purchase retained, service read-only/ACL unchanged.')


if __name__ == '__main__':
    run()
