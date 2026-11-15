"""Actual SQL concurrency on fixed disposable localhost; no providers or live DB."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import select
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]
SCHEMA = "icash_seller_recovery_private"
RELEASE = "a" * 40


def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='8s';set timezone='UTC';\n" + query,
                            env=ENV, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def setup():
    assert sql("select current_database();") == "icash_reliability"
    sql("drop schema if exists icash_seller_recovery_private cascade;drop schema if exists icash_research_private cascade;"
        "drop schema if exists icash_reliability_private cascade;drop schema if exists icash_owner_review_private cascade;"
        "drop schema public cascade;create schema public;")
    for path in ("tests/fixtures/seller-contact-refresh-native.sql", "tests/fixtures/seller-contact-refresh-isolation-before.sql",
                 "config/seller-contact-refresh-isolation.sql"):
        sql((ROOT / path).read_text())
    refresh = sql(f"select id from {SCHEMA}.contact_refreshes limit 1;")
    fingerprint = sql(f"select encode(sha256(convert_to({SCHEMA}.contact_refresh_isolation_snapshot('{refresh}')::text,'UTF8')),'hex');")
    assert len(fingerprint) == 64
    assert sql(f"select {SCHEMA}.review_contact_refresh_isolation('{refresh}','{fingerprint}','Native fictional exact receipt review');") == "t"
    return refresh, fingerprint


def activate(fingerprint):
    return sql(f"select {SCHEMA}.activate_contact_refresh_isolation('{fingerprint}','{RELEASE}');")


def claim():
    result = sql("set role service_role;set application_name='contact-isolation-contender';select icash_claim_seller_contact_refresh();")
    return json.loads(result) if result else None


refresh, fingerprint = setup()
before = sql(f"select jsonb_build_object('refresh',to_jsonb(f),'spend',to_jsonb(o),'request',to_jsonb(r)) from {SCHEMA}.contact_refreshes f join icash_operation_spend o using(operation_key) join icash_research_private.requests r on r.id=f.request_id where f.id='{refresh}';")
reserve = int(sql("select reserved_micros from icash_operating_budget;"))
with ThreadPoolExecutor(max_workers=8) as pool:
    assert all(value == "t" for value in pool.map(lambda _: activate(fingerprint), range(8)))
assert int(sql("select reserved_micros from icash_operating_budget;")) == reserve + 12000
with ThreadPoolExecutor(max_workers=8) as pool:
    claimed = [value for value in pool.map(lambda _: claim(), range(8)) if value]
assert len(claimed) == 1, claimed
assert claimed[0]["phone"] == "+12145550234"
assert sql(f"select count(*) from {SCHEMA}.contact_refreshes;") == "2"
assert sql("select count(*) from icash_credit_ledger;") == "0"
after = sql(f"select jsonb_build_object('refresh',to_jsonb(f),'spend',to_jsonb(o),'request',to_jsonb(r)) from {SCHEMA}.contact_refreshes f join icash_operation_spend o using(operation_key) join icash_research_private.requests r on r.id=f.request_id where f.id='{refresh}';")
assert after == before
sql(f"update {SCHEMA}.contact_refreshes set requested_at=now()-interval '2 minutes',response_at=now()-interval '1 minute',state='responded',http_status=200,response='{{}}' where id='{claimed[0]['id']}';")
assert claim() is None
sql(f"update {SCHEMA}.contact_refreshes set requested_at=now()-interval '2 minutes',response_at=now()-interval '1 minute',state='processed',outcome='cost_review',http_status=200,response='{{}}' where id='{claimed[0]['id']}';")
assert claim() is None


def late_control(mutation):
    _, fingerprint = setup()
    assert activate(fingerprint) == "t"
    holder = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, bufsize=1)
    try:
        holder.stdin.write("begin;do $$begin perform 1 from icash_operating_budget where id=1 for update;end$$;"
                           + mutation + "select 'locked';\n")
        holder.stdin.flush()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if select.select([holder.stdout], [], [], .1)[0] and holder.stdout.readline().strip() == "locked":
                break
        else:
            raise AssertionError("Control did not acquire the admission lock")
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(claim)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if sql("select exists(select 1 from pg_stat_activity where application_name='contact-isolation-contender' and wait_event_type='Lock');") == "t":
                    break
                time.sleep(.025)
            else:
                raise AssertionError("Claim did not wait for the admission lock")
            holder.stdin.write("commit;\n")
            holder.stdin.flush()
            holder.stdin.close()
            holder.stdin = None
            _, error = holder.communicate(timeout=5)
            assert holder.returncode == 0, error
            assert pending.result(timeout=10) is None
        assert sql(f"select count(*) from {SCHEMA}.contact_refreshes;") == "1"
        assert int(sql("select reserved_micros from icash_operating_budget;")) == 72000
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)


late_control(f"update {SCHEMA}.contact_refresh_isolation set enabled=false;")
late_control("update icash_data_cost_settings set credit_micros=20000;")
late_control("update icash_accounts set bot_paused=true;")

_, fingerprint = setup()
assert activate(fingerprint) == "t"
settle = "select icash_settle_operation('dnc:00000000-0000-4000-8000-000000000003',14,60000,'synthetic independent reconciliation');"
sql(settle)
sql(settle)
assert int(sql("select reserved_micros from icash_operating_budget;")) == 12000
assert sql("select count(*) from icash_credit_ledger;") == "1"
assert claim()["phone"] == "+12145550123"
print("PASS native activation once, concurrent isolated claims once, unchanged original records, new-ambiguity stop, late rollback/rate/Pause and later original settlement.")
