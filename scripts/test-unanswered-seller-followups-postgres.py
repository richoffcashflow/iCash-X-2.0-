"""Native concurrency on a dedicated disposable localhost database; no providers."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import select
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
BASE = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres"]
DB = "icash_unanswered_fixture"
CMD = BASE + ["-d", DB]


def sql(query, database=DB):
    r = subprocess.run(BASE + ["-d", database], input="set statement_timeout='8s';\n" + query,
                       text=True, capture_output=True, env=ENV, timeout=15)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def setup():
    sql("drop schema if exists icash_recording_private cascade;drop schema if exists icash_seller_recovery_private cascade;"
        "drop schema if exists icash_seller_agreement_private cascade;drop schema public cascade;create schema public;")
    fixture = (ROOT / "tests/fixtures/unanswered-seller-native.sql").read_text()
    for role in ("anon", "authenticated", "service_role"):
        statement = f"create role {role}" + (" bypassrls" if role == "service_role" else "") + ";"
        fixture = fixture.replace(statement, f"do $$begin {statement} exception when duplicate_object then null;end$$;")
    sql(fixture)


def claim():
    return int(sql("set role service_role;set application_name='unanswered-contender';select icash_queue_unanswered_seller_calls();"))


def late_control(mutation):
    setup()
    holder = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        holder.stdin.write("begin;do $$begin perform 1 from icash_operating_budget where id=1 for update;end$$;"
                           + mutation + "select 'locked';\n")
        holder.stdin.flush()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if select.select([holder.stdout], [], [], .1)[0] and holder.stdout.readline().strip() == "locked":
                break
        else:
            raise AssertionError("Control did not acquire admission lock")
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(claim)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if sql("select exists(select 1 from pg_stat_activity where application_name='unanswered-contender' and wait_event_type='Lock');") == "t":
                    break
                time.sleep(.025)
            else:
                raise AssertionError("Queue did not wait for admission lock")
            holder.stdin.write("commit;\n")
            holder.stdin.flush()
            holder.stdin.close()
            holder.stdin = None
            _, error = holder.communicate(timeout=5)
            assert holder.returncode == 0, error
            assert pending.result(timeout=10) == 0
        assert sql("select count(*) from icash_voice_jobs;") == "1"
        assert sql("select count(*) from icash_operation_spend;") == "1"
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)


# Never reset another test's schema or connect to a configurable/remote server.
assert sql("select current_database();", "icash_reliability") == "icash_reliability"
original_bypass = sql("select rolbypassrls from pg_roles where rolname='service_role';", "icash_reliability")
sql(f"create database {DB};", "icash_reliability")
try:
    setup()
    # Match the actual Supabase service role even if an earlier CI fixture
    # created the cluster-wide role without its production RLS attribute.
    sql("alter role service_role bypassrls;")
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda _: claim(), range(16)))
    assert sum(results) == 1, results
    assert sql("select count(*) from icash_voice_jobs;") == "2"
    assert sql("select count(*) from icash_operation_spend;") == "1"
    assert sql("select bool_and(state='dispatched') from icash_voice_jobs where seller_followup_of is null;") == "t"
    assert sql("set role service_role;select icash_seller_phone_call_current(account_id,id) from icash_voice_jobs where seller_followup_of is not null;") == "t"
    # Column grants permit bounded cursor progress, never policy activation.
    assert sql("select has_column_privilege('service_role','icash_seller_recovery_private.unanswered_policy','enabled','update');") == "f"
    late_control("update icash_accounts set bot_paused=true;")
    late_control("update icash_seller_recovery_private.unanswered_policy set enabled=false;")
    late_control("insert into icash_text_suppressions values('+12145550123');")
    late_control("update icash_live_conversations set result='{\"contactEvidence\":\"human_response\",\"transcript\":[{\"role\":\"agent\",\"message\":\"Do you own 12 Fixture Lane?\"},{\"role\":\"user\",\"message\":\"No.\"}]}';")
    print("PASS native 16-worker single follow-up, immutable original/ledger, service-only grants, late Pause/STOP/reply/policy fences. No provider calls.")
finally:
    sql(f"drop database {DB};", "icash_reliability")
    if original_bypass == "f":
        sql("alter role service_role nobypassrls;", "icash_reliability")
