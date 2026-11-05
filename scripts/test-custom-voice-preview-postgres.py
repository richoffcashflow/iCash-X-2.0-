"""Private preview claims under native PostgreSQL concurrency; no providers."""
from concurrent.futures import ThreadPoolExecutor
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from threading import Barrier
import json
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location('preview_fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
base = module_from_spec(SPEC)
SPEC.loader.exec_module(base)
sql = base.sql
a, u, v = [f'00000000-0000-4000-8000-{n:012d}' for n in (1, 2, 4)]
request = {"text": "Hi, this is a preview of my AI voice. I'm calling about your property. Is now a good time to talk?", "model_id": "eleven_v4_turbo", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
payload = json.dumps(request).replace("'", "''")
claim = f"set role service_role;set application_name='voice-preview-contender';select public.icash_begin_custom_voice_preview('{u}','{a}','{v}','fixture_voice','{payload}'::jsonb);"

assert sql('select current_database();') == 'icash_reliability'
sql('drop schema public cascade;create schema public;')
sql('''create table public.icash_accounts(id uuid primary key,owner_user_id uuid,vip boolean,balance_cents integer,bot_paused boolean);
create function public.icash_vip_active(p_account uuid) returns boolean language sql as $$select vip from public.icash_accounts where id=p_account$$;
create function public.icash_vip_features_active(p_account uuid) returns boolean language sql as $$select vip from public.icash_accounts where id=p_account$$;''')
for role in ('anon','authenticated','service_role'):
    sql(f"do $$begin if not exists(select 1 from pg_roles where rolname='{role}') then create role {role};end if;end$$;")
sql('alter role service_role bypassrls;grant usage on schema public to service_role;grant select,update on public.icash_accounts to service_role;')
sql((ROOT/'config/vip-custom-voice.sql').read_text())
sql((ROOT/'config/custom-voice-preview.sql').read_text())
sql(f"insert into public.icash_accounts values('{a}','{u}',true,0,true);")
sql(f"insert into public.icash_custom_voices(account_id,id,state,voice_id,enabled,consent_version,consent_user,sample_sha256) values('{a}','{v}','ready','fixture_voice',false,'own-voice-2026-10-07.1','{u}',repeat('a',64));")

def contenders():
    barrier = Barrier(24)
    def run(_):
        barrier.wait(timeout=10)
        return json.loads(sql(claim))
    with ThreadPoolExecutor(max_workers=24) as pool:
        return list(pool.map(run, range(24)))

results = contenders()
assert sum(r['started'] for r in results) == 1
assert len({r['preview']['id'] for r in results}) == 1
assert sql('select count(*) from public.icash_custom_voice_previews;') == '1'
sql("update public.icash_custom_voice_previews set state='unknown',created_at=now()-interval '1 day';")
assert not any(r['started'] for r in contenders()), 'Unknown generation cannot retry under any contender'
sql("update public.icash_custom_voice_previews set state='rejected',updated_at=now()-interval '2 minutes';")
assert sum(r['started'] for r in contenders()) == 1
assert sql('select count(*) from public.icash_custom_voice_previews;') == '2', 'Original rejection stays recorded'
sql("update public.icash_custom_voice_previews set state='ready',audio_base64=repeat('A',2000) where attempt=2;")
assert not any(r['started'] for r in contenders()), 'Saved sample cannot generate again'
assert sql('select balance_cents=0 and bot_paused from public.icash_accounts;') == 't'
assert sql('select not enabled from public.icash_custom_voices;') == 't'

# A VIP removal committed while claim waits on the original account lock wins.
sql('delete from public.icash_custom_voice_previews;')
holder = subprocess.Popen(base.CMD, env=base.ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
contender = None
try:
    holder.stdin.write("begin;update public.icash_accounts set vip=false;select 'vip_locked';\n")
    holder.stdin.flush()
    base.wait_for_marker(holder,'vip_locked')
    contender = subprocess.Popen(base.CMD, env=base.ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    contender.stdin.write(claim+'\n\\q\n');contender.stdin.flush()
    for _ in range(100):
        if sql("select count(*) from pg_stat_activity where application_name='voice-preview-contender' and wait_event_type='Lock';") == '1':
            break
        time.sleep(0.02)
    else:
        raise AssertionError('Preview did not wait on the account lock')
    holder.stdin.write('commit;\n\\q\n');holder.stdin.flush();holder.wait(timeout=5)
    contender.wait(timeout=10)
    assert contender.returncode != 0 and 'VIP required' in contender.stderr.read()
    assert sql('select count(*) from public.icash_custom_voice_previews;') == '0'
finally:
    for proc in (holder,contender):
        if proc and proc.poll() is None:
            proc.kill();proc.wait(timeout=5)
assert sql("select has_table_privilege('authenticated','public.icash_custom_voice_previews','SELECT') or has_function_privilege('anon','public.icash_begin_custom_voice_preview(uuid,uuid,uuid,text,jsonb)','EXECUTE');") == 'f'
print('PASS native preview: 24 contenders claim one generation, unknown never retries, rejection preserves receipts, cached playback never generates, late VIP removal denies, wallet/Pause/live voice untouched, private ACL.')
