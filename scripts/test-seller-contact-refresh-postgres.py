"""Native claim races on disposable localhost only; no provider or production calls.

The exported fixture runs the real refresh scheduler, monetary reservation,
claim, credit ledger and prospecting guard. Contact ancestry and provider quota
are explicit synthetic boundaries; their real validators have separate tests.
"""
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


def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='8s';set timezone='UTC';\n" + query,
                            env=ENV, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def fixture():
    result = subprocess.run(
        ["node", "--experimental-strip-types", "tests/seller-contact-refresh-billing.test.mjs", "--print-fixture"],
        cwd=ROOT, text=True, capture_output=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "icash_claim_seller_contact_refresh" in result.stdout
    return result.stdout


FIXTURE = fixture()


def setup():
    assert sql("select current_database();") == "icash_reliability"
    sql("drop schema if exists icash_seller_recovery_private cascade;"
        "drop schema if exists icash_research_private cascade;"
        "drop schema if exists icash_reliability_private cascade;"
        "drop schema if exists icash_owner_review_private cascade;"
        "drop schema public cascade;create schema public;")
    sql(FIXTURE)


def claim():
    result = sql("set role service_role;set application_name='contact-refresh-contender';select icash_claim_seller_contact_refresh();")
    return json.loads(result) if result else None


def counts():
    return json.loads(sql("""select jsonb_build_object(
      'operations',(select count(*) from icash_operation_spend),
      'reservations',(select count(*) from icash_credit_reservations),
      'requests',(select count(*) from icash_research_private.requests),
      'refreshes',(select count(*) from icash_seller_recovery_private.contact_refreshes),
      'charges',(select count(*) from icash_credit_ledger));"""))


def assert_no_purchase():
    assert counts() == dict(operations=0, reservations=0, requests=0, refreshes=0, charges=0), counts()
    assert sql("select reserved_micros from icash_operating_budget;") == "0"


def late_control(mutation):
    setup()
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
                if sql("select exists(select 1 from pg_stat_activity where application_name='contact-refresh-contender' and wait_event_type='Lock');") == "t":
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
        assert_no_purchase()
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)


setup()
for role in ("anon", "authenticated", "service_role"):
    expected = "t" if role == "service_role" else "f"
    assert sql(f"select has_function_privilege('{role}','public.icash_claim_seller_contact_refresh()','execute');") == expected
    for signature in ("reserve_contact_refresh(uuid,uuid,uuid,bigint)", "settle_contact_refresh(text)"):
        assert sql(f"select has_function_privilege('{role}','icash_seller_recovery_private.{signature}','execute');") == "f"
with ThreadPoolExecutor(max_workers=24) as pool:
    results = list(pool.map(lambda _: claim(), range(24)))
assert sum(result is not None for result in results) == 1, results
assert counts() == dict(operations=1, reservations=1, requests=1, refreshes=1, charges=0), counts()
assert sql("select state from icash_operation_spend;") == "dispatched"
assert sql("select kind from icash_research_private.requests;") == "phone_dnc"

# Simulate a long worker/provider outage: no new purchase may escape the global
# unknown-outcome hold merely because the one-minute pacing period passed.
sql("update icash_seller_recovery_private.contact_refreshes set requested_at=now()-interval '2 minutes';")
sql("""insert into icash_seller_gaps(id,account_id,reason,state,review_reason,outgoing_id,stage,thread_id,due_at,expires_at,created_at)
 select '00000000-0000-4000-8000-000000000099',account_id,reason,state,review_reason,null,stage,thread_id,now(),expires_at,created_at
 from icash_seller_gaps limit 1;""")
assert claim() is None
assert counts()["requests"] == 1

late_control("update icash_accounts set bot_paused=true;")
late_control("update icash_seller_recovery_private.contact_refresh_policy set enabled=false;")
late_control("update icash_operation_rates set enabled=false;")
late_control("update fixture_controls set quota_admitted=false;")
late_control("update fixture_controls set late_current=false;")

setup()
sql("update icash_operating_budget set funded_micros=0;")
assert claim() is None
assert_no_purchase()
assert sql("select scan_gap_id is not null from icash_seller_recovery_private.contact_refresh_policy;") == "t"
print("PASS native 24-worker one-purchase claim, unknown-outcome hold, late Pause/policy/rate/quota/contact fences and complete monetary rollback.")
