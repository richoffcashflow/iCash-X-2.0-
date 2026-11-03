"""One-use owner demo lookup races in fixed disposable PostgreSQL; no providers."""
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
# Do not inherit a connection URL, service file, options, or provider credentials.
ENV = {key: value for key, value in os.environ.items()
       if key in ("PATH", "LANG", "LC_ALL", "SYSTEMROOT")}
ENV.update(PGPASSWORD="isolated-fixture-only", PGCONNECT_TIMEOUT="5", PGSSLMODE="disable")
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
       "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]
ACCOUNT = "48dfb798-8c1a-404f-88c0-c396cc067062"
PHONE = "+12142185280"


def sql(query, failure=False):
    result = subprocess.run(CMD, input="set statement_timeout='12s';set timezone='UTC';\n"+query,
                            env=ENV, text=True, capture_output=True, timeout=18)
    if failure:
        assert result.returncode != 0, "Expected the transaction to reject the operation"
        return result.stderr
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def setup():
    assert sql("select current_database();") == "icash_reliability"
    sql("drop schema if exists icash_research_private cascade;drop schema public cascade;create schema public;")
    foundation = (ROOT/"tests/fixtures/owner-demo-request-foundation.sql").read_text()
    for role in ("anon", "authenticated", "service_role"):
        foundation = foundation.replace(f"create role {role};", (
            f"do $$begin if not exists(select 1 from pg_roles where rolname='{role}') "
            f"then create role {role};end if;end$$;"))
    # psql submits semicolon-delimited input separately. Bind the fixture's
    # saved provider timestamps in one transaction, as its original receipt was.
    sql("begin;\n"+foundation+"\ncommit;")
    sql("grant usage on schema public to anon,authenticated,service_role;")
    before = snapshot()
    sql((ROOT/"config/owner-demo-request-allowance.sql").read_text())
    assert snapshot() == before, "Installation must not change quotas, research reservations or funds"
    assert sql("select enabled from icash_research_private.owner_demo_request_policy where id=1;") == "f"
    sql("update icash_research_private.owner_demo_request_policy set enabled=true where id=1;")


def seed():
    lead, request = str(uuid.uuid4()), str(uuid.uuid4())
    sql(f"select public.fixture_owner_demo_lead('{lead}','{request}');")
    return lead


def claim_query(lead):
    return ("set role service_role;set application_name='owner-demo-request-contender';"
            f"select coalesce(public.icash_claim_owner_demo_lookup('{lead}')::text,'null');")


def claim(lead):
    return json.loads(sql(claim_query(lead)))


def snapshot():
    return json.loads(sql("""select jsonb_build_object(
      'budget',(select to_jsonb(b) from public.icash_dealmachine_request_budget b where id=1),
      'lookup',(select jsonb_build_object('reserved',lookup_reserved_micros,'used',lookup_used_micros)
        from public.icash_seller_controls where id=1),
      'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from public.icash_wallets w),
      'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb)
        from icash_research_private.requests r));"""))


def admissions():
    return int(sql("select count(*) from icash_research_private.owner_demo_request_admissions;"))


def contend(leads):
    barrier = Barrier(len(leads))

    def run(lead):
        barrier.wait(timeout=10)
        return claim(lead)

    with ThreadPoolExecutor(max_workers=len(leads)) as pool:
        return list(pool.map(run, leads))


def assert_one(results, before):
    accepted = [value for value in results if value is not None]
    assert len(accepted) == 1, results
    winner = accepted[0]
    assert winner["noAddressFallback"] is True
    uuid.UUID(winner["quotaRequestId"])
    assert winner["demoExpiresAt"]
    after = snapshot()
    assert after["budget"]["day_used"] == 9801
    assert after["budget"]["minute_used"] == before["budget"]["minute_used"]+1
    for field in ("day_limit", "day_start", "minute_limit"):
        assert after["budget"][field] == before["budget"][field], field
    assert after["wallets"] == before["wallets"], "Research reservation must not alter customer balance"
    assert after["lookup"]["used"] == before["lookup"]["used"]
    assert after["lookup"]["reserved"] > before["lookup"]["reserved"]
    assert len(after["requests"]) == len(before["requests"])+1
    own_request = next(item for item in after["requests"] if item["id"] == winner["quotaRequestId"])
    assert own_request["admitted"] is True and own_request["kind"] == "property_lookup"
    assert admissions() == 1
    assert sql(f"select state from public.icash_seller_intakes where id='{winner['id']}';") == "checking"
    assert sql(f"select claim_token from public.icash_seller_intakes where id='{winner['id']}';") == winner["token"]
    return winner


def wait_marker(process):
    deadline = time.monotonic()+5
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(process.stderr.read())
        if select.select([process.stdout], [], [], 0.1)[0]:
            if process.stdout.readline().strip() == "demo_guard_locked":
                return
    raise AssertionError("Lock holder did not become ready")


def late_guard(lead, mutation, label, lock_table="icash_operating_budget", pause_seconds=0):
    before = snapshot()
    holder = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        holder.stdin.write("begin;set local statement_timeout='12s';"
                           f"do $$begin perform 1 from public.{lock_table} where id=1 for update;end$$;"
                           +mutation+"select 'demo_guard_locked';\n")
        holder.stdin.flush()
        wait_marker(holder)
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(claim, lead)
            deadline = time.monotonic()+5
            while time.monotonic() < deadline:
                if sql("""select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid()
                  and application_name='owner-demo-request-contender' and wait_event_type='Lock');""") == "t":
                    break
                time.sleep(0.025)
            else:
                raise AssertionError("Claim did not wait on the admission lock: "+label)
            if pause_seconds:
                time.sleep(pause_seconds)
            holder.stdin.write("commit;\n\\q\n")
            holder.stdin.flush()
            holder.wait(timeout=5)
            assert holder.returncode == 0, holder.stderr.read()
            assert pending.result() is None, label
        after = snapshot()
        assert after["budget"] == before["budget"], label
        assert after["lookup"] == before["lookup"], label
        assert after["requests"] == before["requests"], label
        assert admissions() == 0, label
        assert sql(f"select state from public.icash_seller_intakes where id='{lead}';") == "received"
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)


def run():
    setup()
    lead = seed()
    before = snapshot()
    assert before["budget"]["day_used"] == 9800
    winner = assert_one(contend([lead]*24), before)
    admitted = snapshot()
    assert contend([lead]*12) == [None]*12
    assert snapshot() == admitted, "Lost HTTP response must never replay a consumed lookup claim"
    assert "immutable" in sql("update icash_research_private.owner_demo_request_admissions set phone=phone;", failure=True).lower()
    assert "immutable" in sql("delete from icash_research_private.owner_demo_request_admissions;", failure=True).lower()
    assert snapshot() == admitted
    print("PASS native owner demo: 24 repeated submissions create one lookup claim and one extra quota debit; replay and receipt edits reject.")

    # Distinct, valid form receipts share the same single extra rolling-day slot.
    setup()
    leads = [seed() for _ in range(24)]
    before = snapshot()
    winner = assert_one(contend(leads), before)
    assert sum(int(sql(f"select count(*) from public.icash_seller_intakes where id='{item}' and state='checking';"))
               for item in leads) == 1
    before = snapshot()
    request_id = winner["quotaRequestId"]
    assert sql(f"set role service_role;select public.icash_finish_dealmachine_request('{request_id}', '{{\"outcome\":\"unknown\"}}'::jsonb);") == "t"
    assert contend(leads[:12]) == [None]*12
    after = snapshot()
    assert after["budget"] == before["budget"] and after["lookup"] == before["lookup"]
    assert after["wallets"] == before["wallets"] and admissions() == 1
    print("PASS native owner demo: 24 different fresh requests have one winner; unknown provider outcome retains the consumed daily allowance.")

    # A committed customer control takes precedence over a waiting admission.
    for mutation, label in (
        (f"update public.icash_accounts set bot_paused=true where id='{ACCOUNT}';", "late Pause"),
        (f"insert into public.icash_text_suppressions(phone) values('{PHONE}');", "late STOP"),
        (f"update public.icash_wallets set reserved_cents=balance_cents where account_id='{ACCOUNT}';", "late reserved funds"),
        ("update icash_research_private.owner_demo_request_policy set enabled=false where id=1;", "late policy disable"),
    ):
        setup()
        lead = seed()
        late_guard(lead, mutation, label)
    print("PASS native owner demo: committed Pause, STOP, reserved funds and policy disable win before admission.")

    # The transaction begins while the immutable five-minute request is valid,
    # but waits on the quota row until after expiry. now() would be stale here.
    setup()
    lead = seed()
    sql(f"""update public.icash_seller_intakes set created_at=clock_timestamp()-interval '5 minutes' where id='{lead}';
      update public.icash_optin_call_requests set requested_at=clock_timestamp()-interval '4 minutes 58 seconds',
        expires_at=clock_timestamp()+interval '2 seconds' where lead_id='{lead}';
      update public.icash_optin_call_requests set expires_at=requested_at+interval '5 minutes' where lead_id='{lead}';""")
    late_guard(lead, "", "expiry after quota wait", lock_table="icash_dealmachine_request_budget", pause_seconds=2.2)
    print("PASS native owner demo: expiry after waiting for the quota lock refuses without reserving lookup cost or incrementing counters.")

    setup()
    lead = seed()
    late_guard(lead, "update icash_research_private.quota_feedback set blocked_until=clock_timestamp()+interval '1 minute' where id=1;",
               "late provider backoff", lock_table="icash_dealmachine_request_budget")
    setup()
    lead = seed()
    sql("update public.icash_dealmachine_request_budget set day_start=clock_timestamp()-interval '24 hours'+interval '2 seconds' where id=1;")
    late_guard(lead, "", "rolling day ended while waiting", lock_table="icash_dealmachine_request_budget", pause_seconds=2.2)
    print("PASS native owner demo: late provider backoff and a rolling-window boundary refuse without clearing or resetting shared quota.")

    # The real ordinary lookup-claim function rejects an insufficient provider
    # research allowance. The owner headroom path must commit nothing in return.
    setup()
    lead = seed()
    sql("update public.icash_seller_controls set lookup_allowance_micros=0 where id=1;")
    before = snapshot()
    assert claim(lead) is None
    assert snapshot() == before and admissions() == 0
    assert sql(f"select state from public.icash_seller_intakes where id='{lead}';") == "received"
    print("PASS native owner demo: ordinary lookup-budget refusal leaves the lead, quota, costs and owner balance unchanged.")

    setup()
    lead = seed()
    sql(f"update public.icash_seller_intakes set attribution=jsonb_set(attribution,'{{demoAccountId}}','\"00000000-0000-4000-8000-000000009999\"') where id='{lead}';")
    before = snapshot()
    assert contend([lead]*12) == [None]*12 and snapshot() == before and admissions() == 0
    for role in ("anon", "authenticated", "service_role"):
        expected = "t" if role == "service_role" else "f"
        assert sql(f"select has_function_privilege('{role}','public.icash_claim_owner_demo_lookup(uuid)','execute');") == expected
        assert sql(f"select has_table_privilege('{role}','icash_research_private.owner_demo_request_admissions','SELECT');") == "f"
    print("PASS native owner demo: a different account cannot use the exception; the RPC remains service-only and its receipts private.")


if __name__ == "__main__":
    run()
