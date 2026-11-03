"""Native PostgreSQL reserve races on a fixed disposable database; no providers."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import select
import subprocess
from threading import Barrier
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]


def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='12s';set timezone='UTC';\n"+query,
                            env=ENV, text=True, capture_output=True, timeout=18)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def setup():
    assert sql("select current_database();") == "icash_reliability"
    sql("drop schema if exists icash_research_private cascade;drop schema public cascade;create schema public;")
    sql((ROOT / "tests/fixtures/new-user-request-reserve-foundation.sql").read_text())
    bridge = (ROOT / "supabase/migrations/20260928221806_discovery_screening_bridge.sql").read_text()
    sql(bridge[bridge.index("create table public.icash_dealmachine_request_budget ("):bridge.index("insert into public.icash_dealmachine_request_budget")])
    sql("""insert into public.icash_dealmachine_request_budget(id) values(1);
      alter table public.icash_dealmachine_request_budget drop constraint icash_dealmachine_request_budget_day_limit_check;
      update public.icash_dealmachine_request_budget set minute_limit=60,day_limit=9800;""")
    sql(bridge[bridge.index("create function public.icash_take_dealmachine_request()"):bridge.index("create function public.icash_save_discovery")])
    ledger = (ROOT / "config/research-request-efficiency.sql").read_text()
    sql(ledger[ledger.index("create table icash_research_private.requests("):ledger.index("alter table icash_research_private.settings")])
    sql(ledger[ledger.index("create function public.icash_take_dealmachine_request(p_kind"):ledger.index("create table icash_research_private.exclusions")])
    capacity = (ROOT / "config/provider-quota-scheduling.sql").read_text()
    sql(capacity[capacity.index("create function public.icash_dealmachine_capacity_available"):capacity.index("alter function public.icash_outbound_search_due")])
    sql((ROOT / "config/research-provider-feedback.sql").read_text())
    before = sql("select to_jsonb(b) from public.icash_dealmachine_request_budget b where id=1;")
    sql((ROOT / "config/new-user-request-reserve.sql").read_text())
    assert sql("select to_jsonb(b) from public.icash_dealmachine_request_budget b where id=1;") == before
    assert sql("select enabled from icash_research_private.request_reserve_policy where id=1;") == "f"
    sql("update icash_research_private.request_reserve_policy set enabled=true where id=1;")


def seed(number, age="1 hour"):
    return sql(f"select public.fixture_reserve_seed({number},interval '{age}');")


def reset_window(used):
    # This mutates only this disposable fixture, never live counters.
    sql(f"""truncate icash_research_private.request_reserve_admissions,icash_research_private.requests,icash_research_private.quota_feedback;
      insert into icash_research_private.quota_feedback(id) values(1);
      update public.icash_dealmachine_request_budget set minute_start=now(),minute_used=0,
        minute_limit=60,day_start=now(),day_used={used},day_limit=9800 where id=1;""")


def request(account=None, request_id=None, kind="owner_preview", operation=None):
    if account is None:
        return "set role service_role;select public.icash_take_dealmachine_request();"
    request_id = request_id or str(uuid.uuid4())
    operation = operation or f"native-reserve:{request_id}"
    return ("set role service_role;select public.icash_take_dealmachine_request("
            f"'{kind}','{account}','{operation}','{request_id}');")


def contend(queries):
    barrier = Barrier(len(queries))

    def run(query):
        barrier.wait(timeout=10)
        return sql(query)

    with ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(run, queries))


def counts():
    return json.loads(sql("""select jsonb_build_object('day',day_used,'minute',minute_used,
      'reserved',(select count(*) from icash_research_private.request_reserve_admissions),
      'admitted',(select count(*) from icash_research_private.requests where admitted))
      from public.icash_dealmachine_request_budget where id=1;"""))


def wait_marker(process):
    deadline = time.monotonic()+5
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(process.stderr.read())
        if select.select([process.stdout], [], [], 0.1)[0] and process.stdout.readline().strip() == "reserve_locked":
            return
    raise AssertionError("Budget-lock holder did not become ready")


def late_guard(account, mutation, label, hold_seconds=0):
    reset_window(8820)
    assert sql(f"set role service_role;select public.icash_dealmachine_capacity_available(1,'{account}');") == "t"
    blocker = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write("begin;set local statement_timeout='12s';do $$begin perform 1 from public.icash_dealmachine_request_budget where id=1 for update;end$$;"+mutation+"select 'reserve_locked';\n")
        blocker.stdin.flush()
        wait_marker(blocker)
        with ThreadPoolExecutor(max_workers=1) as pool:
            query = "set application_name='new-user-reserve-contender';"+request(account)
            future = pool.submit(sql, query)
            deadline = time.monotonic()+5
            waiting = False
            while time.monotonic() < deadline:
                waiting = sql("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and application_name='new-user-reserve-contender' and wait_event_type='Lock');") == "t"
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, "Request never waited on shared limiter"
            if hold_seconds:
                time.sleep(hold_seconds)
            blocker.stdin.write("commit;\n\\q\n")
            blocker.stdin.flush()
            blocker.wait(timeout=5)
            assert blocker.returncode == 0, blocker.stderr.read()
            assert future.result() == "f", label
        observed = counts()
        assert observed == {"day": 8820, "minute": 0, "reserved": 0, "admitted": 0}, (label, observed)
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.wait(timeout=5)


def exclusion_races():
    sql((ROOT / "tests/fixtures/new-user-request-reserve-exclusions-foundation.sql").read_text())
    before = json.loads((ROOT / "tests/fixtures/new-user-request-reserve-exclusions-before.json").read_text())[0]
    sql(before["definition"])
    original = (ROOT / "config/research-request-efficiency.sql").read_text()
    sql(original[original.index("create function public.icash_finish_research_exclusions"):original.index("alter table icash_research_private.exclusions enable")])
    sql("""revoke all on function public.icash_claim_research_exclusions(),public.icash_finish_research_exclusions(uuid,jsonb) from public,anon,authenticated;
      grant execute on function public.icash_claim_research_exclusions(),public.icash_finish_research_exclusions(uuid,jsonb) to service_role;""")
    sql((ROOT / "config/new-user-request-reserve-exclusions.sql").read_text())
    assert sql("select md5(pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure));") == before["hash"]
    owner, other = seed(30), seed(31)
    sql(f"insert into public.icash_discovery_configs(account_id) values('{owner}'),('{other}');")
    reset_window(8820)
    claim_query = f"set role service_role;select coalesce(public.icash_claim_starter_research_exclusions('{owner}')::text,'null');"
    results = contend([claim_query for _ in range(24)])
    claims = [json.loads(value) for value in results if value != "null"]
    assert len(claims) == 1, results
    claim = claims[0]
    assert claim["accountId"] == owner and claim["action"] == "sync" and claim["listId"] == "fixture-list", claim
    assert claim["ids"] == ["prop_1"]
    assert sql("select count(*) from icash_research_private.request_reserve_exclusion_claims;") == "1"
    assert counts() == {"day": 8820, "minute": 0, "reserved": 0, "admitted": 0}, "Claiming does not consume a provider request"
    operation = "starter-exclusion:"+claim["token"]

    # A valid claim is still refused after an account/list/lease mismatch. A
    # refusal must leave that original claim available when its binding agrees.
    assert sql(request(other, kind="exclusion_sync", operation=operation)) == "f"
    assert sql(request(owner, kind="exclusion_create", operation=operation)) == "f"
    for mutation, undo in (
        (f"update public.icash_discovery_configs set research_list_id='other-list' where account_id='{owner}';",
         f"update public.icash_discovery_configs set research_list_id='fixture-list' where account_id='{owner}';"),
        ("update icash_research_private.exclusions set list_id='other-list';",
         "update icash_research_private.exclusions set list_id='fixture-list';"),
        ("update icash_research_private.exclusions set token=gen_random_uuid();",
         f"update icash_research_private.exclusions set token='{claim['token']}';"),
        ("update icash_research_private.exclusions set lease_until=now()-interval '1 second';",
         "update icash_research_private.exclusions set lease_until=now()+interval '1 minute';"),
        ("update icash_research_private.settings set exclusions_enabled=false;",
         "update icash_research_private.settings set exclusions_enabled=true;"),
        ("update icash_research_private.exclusions set state='unknown';",
         "update icash_research_private.exclusions set state='ready';"),
    ):
        sql(mutation)
        assert sql(request(owner, kind="exclusion_sync", operation=operation)) == "f", mutation
        sql(undo)
    assert counts() == {"day": 8820, "minute": 0, "reserved": 0, "admitted": 0}

    # Different request IDs cannot replay the same account/list/lease action.
    results = contend([request(owner, kind="exclusion_sync", operation=operation) for _ in range(24)])
    assert results.count("t") == 1 and results.count("f") == 23, results
    assert counts() == {"day": 8821, "minute": 1, "reserved": 1, "admitted": 1}
    receipt = json.dumps({"ok": True, "listId": claim["listId"], "ids": claim["ids"], "added": 1})
    assert sql(f"set role service_role;select public.icash_finish_research_exclusions('{claim['token']}','{receipt}'::jsonb);") == "t"
    assert sql("select count(*) from icash_research_private.exclusion_items where synced_at is null;") == "0"
    assert sql(request(owner, kind="exclusion_sync", operation=operation)) == "f"
    assert sql("select md5(pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure));") == before["hash"]
    for role in ("anon", "authenticated", "service_role"):
        assert sql(f"select has_function_privilege('{role}','public.icash_claim_starter_research_exclusions(uuid)','execute');") == ("t" if role == "service_role" else "f")
        assert sql(f"select has_function_privilege('{role}','icash_research_private.starter_exclusion_request_allowed(uuid,text,timestamptz)','execute');") == "f"
    print("PASS native starter exclusion sync: 24 claimants produce one bound lease; 24 different request IDs produce one reserved admission; mismatched account/list/token/lease and unsupported creation/recovery spend no requests; original receipt completes list synchronization.")


def run():
    setup()
    new = seed(1)
    old = seed(2, "2 days")
    for role in ("anon", "authenticated", "service_role"):
        expected = "t" if role == "service_role" else "f"
        for signature in ("public.icash_take_dealmachine_request()",
                          "public.icash_take_dealmachine_request(text,uuid,text,uuid)",
                          "public.icash_dealmachine_capacity_available(integer,uuid)"):
            assert sql(f"select has_function_privilege('{role}','{signature}','execute');") == expected, (role, signature)
        assert sql(f"select has_table_privilege('{role}','icash_research_private.request_reserve_admissions','insert');") == "f"

    reset_window(8818)
    results = contend([request() for _ in range(24)])
    assert results.count("t") == 2 and results.count("f") == 22, results
    assert counts() == {"day": 8820, "minute": 2, "reserved": 0, "admitted": 0}

    reset_window(8820)
    queries = [request(new) if i % 2 else request() for i in range(48)]
    results = contend(queries)
    assert all(result == ("t" if i % 2 else "f") for i, result in enumerate(results)), results
    assert counts() == {"day": 8844, "minute": 24, "reserved": 24, "admitted": 24}

    reset_window(8820)
    duplicate_id = str(uuid.uuid4())
    results = contend([request(new, duplicate_id) for _ in range(24)])
    assert results.count("t") == 1 and results.count("f") == 23, results
    assert counts() == {"day": 8821, "minute": 1, "reserved": 1, "admitted": 1}

    reset_window(8820)
    results = contend([request(new) for _ in range(64)])
    assert results.count("t") == 50 and results.count("f") == 14, results
    assert counts() == {"day": 8870, "minute": 50, "reserved": 50, "admitted": 50}
    assert sql(f"set role service_role;select public.icash_dealmachine_capacity_available(1,'{new}');") == "f"

    reset_window(9775)
    accounts = [seed(number) for number in range(100, 148)]
    results = contend([request(account) for account in accounts])
    assert results.count("t") == 25 and results.count("f") == 23, results
    assert counts() == {"day": 9800, "minute": 25, "reserved": 25, "admitted": 25}

    reset_window(8820)
    assert sql(request(old)) == "f", "Old accounts cannot consume new-user reserve"
    sql(f"insert into public.icash_funding_orders(account_id,credited_at) values('{old}',now());")
    assert sql(request(old)) == "f", "A top-up cannot restart first-funding eligibility"
    assert sql(request(new, kind="buyer_search")) == "f", "Buyer research does not qualify as starter research"
    assert counts() == {"day": 8820, "minute": 0, "reserved": 0, "admitted": 0}

    test_account = seed(10)
    sql(f"update public.icash_funding_orders set mode='test' where account_id='{test_account}';")
    future_account = seed(11, "-1 hour")
    expired_account = seed(12, "24 hours")
    held_account = seed(13)
    sql(f"update public.icash_wallets set reserved_cents=balance_cents where account_id='{held_account}';")
    inactive_account = seed(14)
    sql(f"update public.icash_accounts set membership_allowed=false where id='{inactive_account}';")
    for account in (test_account, future_account, expired_account, held_account, inactive_account):
        assert sql(request(account)) == "f", ("Ineligible account consumed reserve", account)
    assert counts() == {"day": 8820, "minute": 0, "reserved": 0, "admitted": 0}

    late_guard(new, "update icash_research_private.quota_feedback set blocked_until=now()+interval '5 minutes' where id=1;",
               "Provider hold committed before limiter admission must win")
    late_guard(new, f"update public.icash_accounts set bot_paused=true where id='{new}';",
               "Customer Pause committed before limiter admission must win")
    sql(f"update public.icash_accounts set bot_paused=false where id='{new}';")
    late_guard(new, f"update public.icash_wallets set reserved_cents=balance_cents where account_id='{new}';",
               "Funding committed to another operation before limiter admission must win")
    sql(f"update public.icash_wallets set reserved_cents=0 where account_id='{new}';")
    late_guard(new, f"update public.icash_accounts set membership_allowed=false where id='{new}';",
               "Membership loss committed before limiter admission must win")
    sql(f"update public.icash_accounts set membership_allowed=true where id='{new}';")
    expiring_account = seed(20)
    sql(f"update public.icash_funding_orders set credited_at=clock_timestamp()-interval '23 hours 59 minutes 58 seconds' where account_id='{expiring_account}';")
    late_guard(expiring_account, "", "The 24-hour starter window can expire while waiting on the limiter", hold_seconds=3)
    exclusion_races()

    print("PASS native new-user reserve: ordinary/reserved contention, exact global and account caps, one-use requests, late provider/Pause/funding/membership guards and elapsed expiry, first-funding/top-up/kind boundaries, disabled install and service-only access. No providers.")


if __name__ == "__main__":
    run()
