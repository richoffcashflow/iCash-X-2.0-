"""Real owner-choice races on the fixed disposable localhost DB. No providers."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
from threading import Barrier

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql
data = json.loads(subprocess.check_output(['node', '--experimental-strip-types', 'tests/helpers/list-quality-fixture.mjs'], cwd=ROOT, text=True))
assert sql('select current_database();') == 'icash_reliability'
sql('drop schema if exists icash_research_private cascade;drop schema public cascade;create schema public;')
sql("do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;"
    "if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;"
    "if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;end$$;")
sql(data['coreSetup']+data['helpers']+data['core']+data['seed'])
sql('grant usage on schema public to service_role;')
account, other, screen = data['account'], data['other'], data['screen']
sql(f"insert into icash_owner_contacts select '{other}','{other}',jsonb_set(result,'{{contacts,0,phones,1,matchConfidence}}','90') from icash_owner_contacts where screening_id='{screen}';")

def choice(a, s, phone):
    return sql(f"set role service_role;select icash_owner_sms_quality_current('{a}','{s}','{phone}');")

barrier = Barrier(8)
def attempt(n):
    args = (account, screen, '+12145550103') if n % 2 == 0 else (other, other, '+12145550102')
    barrier.wait(timeout=10)
    return args[2], choice(*args)

with ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(attempt, range(8)))
chosen = sql('select phone from icash_research_private.owner_sms_choices;')
assert sql('select count(*) from icash_research_private.owner_sms_choices;') == '1'
assert all((ok == 't') == (phone == chosen) for phone, ok in results), results
assert choice(account, screen, '+12145550101') == 'f', 'Landlines remain held'

# Another property cannot replace the owner choice after a wrong number or STOP.
assert choice(other, other, '+12145550102' if chosen.endswith('103') else '+12145550103') == 'f'

# An original unknown dispatch is retained instead of selecting a new number.
sql("truncate icash_research_private.owner_sms_choices;"
    f"insert into icash_text_threads values('{screen}','{account}','+12145550102','seller');"
    f"insert into icash_text_messages values('{screen}','{account}','{screen}','outgoing','dispatching',null,null,now());")
assert choice(account, screen, '+12145550103') == 'f'
assert sql('select phone from icash_research_private.owner_sms_choices;') == '+12145550102'

# The common lock forces a concurrent admission to see a newly enabled policy.
sql('truncate icash_research_private.owner_sms_choices;truncate icash_text_messages;'
    'update icash_research_private.list_quality_settings set enabled=false;')
holder = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
holder.stdin.write("begin;select 1 from icash_operating_budget where id=1 for update;update icash_research_private.list_quality_settings set enabled=true;select 'quality-locked';\n")
holder.stdin.flush()
fixture.wait_for_marker(holder, 'quality-locked')
with ThreadPoolExecutor(max_workers=1) as pool:
    future = pool.submit(choice, account, screen, '+12145550102')
    holder.stdin.write('commit;\n');holder.stdin.flush()
    assert future.result(timeout=15) == 'f'
holder.stdin.close();holder.wait(timeout=10)
assert holder.returncode == 0
print('PASS native list quality: concurrent cross-account owner choices, no alternate after unknown dispatch, mobile filter and late policy activation under the common lock.')
