"""Real concurrent one-use capacity claims; fixed disposable localhost only."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
from threading import Barrier

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_fixture', ROOT / 'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql, read = fixture.sql, fixture.read

assert sql('select current_database();') == 'icash_reliability'
sql('drop schema if exists icash_recording_private cascade;drop schema public cascade;create schema public;')
sql(read('tests/fixtures/eighty-percent-voice-capacity-foundation.sql'))
baseline = json.loads(read('tests/fixtures/eighty-percent-voice-capacity-before.json'))
for function in baseline['functions']:
    sql(function['definition'])
    assert hashlib.md5(function['definition'].encode()).hexdigest() == function['hash']
    assert sql(f"select md5(pg_get_functiondef(oid)) from pg_proc where proname='{function['name']}';") == function['hash']
sql("""
 insert into public.icash_voice_capacity_policy values(1,20,now(),'original observation','available',now(),now()-interval '1 day',now()-interval '23 hours');
 grant usage on schema public to service_role;
 grant select,insert,update on all tables in schema public to service_role;
 revoke all on all functions in schema public from public,anon,authenticated;
 grant execute on all functions in schema public to service_role;
 revoke all on schema icash_recording_private from public,anon,authenticated,service_role;
""")
old_receipt = sql('select pro_change_applied_at from public.icash_voice_capacity_policy;')
sql(read('config/eighty-percent-voice-capacity.sql'))

def change(action):
    return json.loads(sql(f"set role service_role;select public.icash_eighty_percent_voice_capacity_change('{action}');"))

assert change('claim') == {'claimed': False, 'status': 'disabled'}
assert change('enable') == {'claimed': False, 'status': 'ready'}
barrier = Barrier(24)

def contend(_):
    barrier.wait(timeout=10)
    return change('claim')

with ThreadPoolExecutor(max_workers=24) as pool:
    results = list(pool.map(contend, range(24)))
assert sum(result['claimed'] for result in results) == 1, 'Exactly one transaction may authorize a provider PATCH'
assert all(result['status'] == 'claimed' for result in results)
observation = "set role service_role;select public.icash_save_voice_capacity(32,'[{\"agentId\":\"agent_outgoing\",\"limit\":30,\"creditState\":\"available\"},{\"agentId\":\"agent_incoming\",\"limit\":2,\"creditState\":\"available\"}]','offline fixture');"
with ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(lambda _: sql(observation), range(8)))
assert change('claim') == {'claimed': False, 'status': 'claimed'}
assert change('complete') == {'claimed': False, 'status': 'applied'}
receipt = sql('select eighty_change_applied_at from public.icash_voice_capacity_policy;')
with ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(lambda _: change('claim'), range(8)))
assert not any(result['claimed'] for result in results)
sql(observation)
change('enable')
change('complete')
assert sql('select eighty_change_applied_at from public.icash_voice_capacity_policy;') == receipt
assert sql('select pro_change_applied_at from public.icash_voice_capacity_policy;') == old_receipt
for role in ('anon', 'authenticated', 'service_role'):
    expected = 't' if role == 'service_role' else 'f'
    assert sql(f"select has_function_privilege('{role}','public.icash_eighty_percent_voice_capacity_change(text)','execute');") == expected
    assert sql(f"select has_schema_privilege('{role}','icash_recording_private','usage');") == 'f'
print('PASS native capacity: 24 competing claims, one winner, concurrent observations preserve immutable receipts and private ACLs')
