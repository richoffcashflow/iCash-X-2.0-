"""Prove ordinary accounts never plan/lock owner-only evidence on native PG."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]
OWNER = "48dfb798-8c1a-404f-88c0-c396cc067062"
OTHER = "11111111-1111-4111-8111-111111111111"
JOB = "22222222-2222-4222-8222-222222222222"
CONTACT = "33333333-3333-4333-8333-333333333333"
LEAD = "44444444-4444-4444-8444-444444444444"
SCREEN = "55555555-5555-4555-8555-555555555555"
REQUEST = "66666666-6666-4666-8666-666666666666"
USER = "592171a0-2bb9-484e-8c9a-dd5d2b43b5f7"


def command(query):
    return subprocess.run(CMD, input="set statement_timeout='5s';\n"+query, env=ENV, text=True, capture_output=True, timeout=10)


def sql(query):
    r = command(query)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def held_evidence():
    p = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    p.stdin.write("begin;set local lock_timeout='2s';lock table public.icash_optin_call_requests in access exclusive mode;select 'LOCKED';\n")
    p.stdin.flush()
    assert p.stdout.readline().strip() == "LOCKED"
    return p


def release(p):
    p.stdin.write("rollback;\n")
    p.stdin.close()
    p.wait(timeout=10)
    assert p.returncode == 0, p.stderr.read()


assert sql("select current_database();") == "icash_reliability"
sql("drop schema if exists icash_recording_private cascade;drop schema public cascade;create schema public;create schema icash_recording_private;")
sql("do $$begin if not exists(select from pg_roles where rolname='service_role') then create role service_role;end if;if not exists(select from pg_roles where rolname='anon') then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;end$$;")
sql("grant usage on schema public to service_role;")
schema = json.loads((ROOT / "tests/fixtures/seller-phone-spacing-schema.json").read_text())
for table in schema:
    sql(f"create table public.{table['name']} ("+",".join(f'"{c["name"]}" {c["type"]}' for c in table['columns'])+");")
sql("""
create table icash_timezone_names(name text primary key);
insert into icash_timezone_names select name from pg_timezone_names;
create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
create table icash_optin_call_requests(lead_id uuid,request_id uuid,phone text,account_id uuid,requested_by uuid,source text,request_version text,request_reference text,requested_at timestamptz,expires_at timestamptz);
create table icash_text_suppressions(phone text);create table icash_contact_suppressions(contact_key text);
create table icash_recording_private.terminal_cost_receipts(recording_id uuid,receipt jsonb,created_at timestamptz);
create function icash_seller_voice_permission_current(p_account uuid,p_permission uuid) returns boolean language plpgsql as $$begin
 perform 1 from public.icash_contact_permissions where id=p_permission and account_id=p_account for share;
 return exists(select 1 from public.icash_contact_permissions where id=p_permission and account_id=p_account and dnc_clear);
end$$;
""")
baseline = json.loads((ROOT / "tests/fixtures/outreach-predicates-before.json").read_text())
for row in baseline:
    sql(row['definition'])
    sql(f"revoke all on function public.{row['signature']} from public,anon,authenticated;grant execute on function public.{row['signature']} to service_role;")
ordinary = f"set role service_role;select public.icash_owner_demo_call_current('{OTHER}','{JOB}');"
owner = f"set role service_role;select public.icash_owner_demo_call_current('{OWNER}','{JOB}');"
lock = held_evidence()
try:
    rejected = command("set statement_timeout='250ms';"+ordinary)
    assert rejected.returncode != 0 and "statement timeout" in rejected.stderr, rejected
finally:
    release(lock)
sql((ROOT / "config/outreach-predicate-performance.sql").read_text())
lock = held_evidence()
try:
    with ThreadPoolExecutor(max_workers=12) as pool:
        assert set(pool.map(lambda _: sql("set plan_cache_mode=force_generic_plan;"+ordinary), range(24))) == {'f'}
    rejected = command("set statement_timeout='250ms';"+owner)
    assert rejected.returncode != 0 and "statement timeout" in rejected.stderr, 'owner must still check locked original evidence'
finally:
    release(lock)
sql(f"""
insert into icash_accounts(id,owner_user_id,bot_paused) values('{OWNER}','{USER}',false);
insert into icash_contact_permissions(id,account_id,screening_id,seller_intake_id,phone,contact_key,party,permission_until,dnc_clear)
 values('{CONTACT}','{OWNER}','{SCREEN}','{LEAD}','+12142185280',encode(sha256(convert_to('+12142185280','UTF8')),'hex'),'seller',now()+interval '1 hour',true);
insert into icash_voice_jobs(id,account_id,permission_id,state,created_at) values('{JOB}','{OWNER}','{CONTACT}','ready',now());
insert into icash_seller_intakes(id,request_id,phone,state,ai_consented,contact_consent_scope,attribution,created_at)
 values('{LEAD}','{REQUEST}','+12142185280','assigned',true,'icash_x_demo','{{"demoAccountId":"{OWNER}"}}',now()-interval '2 minutes');
insert into icash_optin_call_requests values('{LEAD}','{REQUEST}','+12142185280','{OWNER}','{USER}','demo_form','icash-optin-call-now-2026-10-16.1','icash-optin-call-now-2026-10-16.1',now()-interval '1 minute',now()+interval '4 minutes');
insert into icash_seller_matches values('{LEAD}','{OWNER}','{SCREEN}');
insert into icash_screening_jobs(id,account_id,state) values('{SCREEN}','{OWNER}','complete');
""")
assert sql(owner) == 't'
sql(f"update icash_accounts set bot_paused=true where id='{OWNER}';")
assert sql(owner) == 'f', 'late owner Pause retained'
sql(f"update icash_accounts set bot_paused=false where id='{OWNER}';update icash_optin_call_requests set requested_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute';")
assert sql(owner) == 'f', 'original request expiry retained'
print("PASS native PostgreSQL: baseline ordinary call blocked on unrelated owner evidence;24 parallel fixed reads bypass that relation, owner retains lock/evidence checks, valid demo/Pause/expiry remain exact.")
