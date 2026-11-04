"""Real concurrent ingress diagnostics, only on the fixed disposable CI database."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import select
import subprocess
from threading import Barrier
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]


def execute(query):
    return subprocess.run(CMD, input="set statement_timeout='8s';set timezone='UTC';\n"+query,
                          env=ENV, text=True, capture_output=True, timeout=12)


def sql(query):
    result = execute(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def run():
    assert sql("select current_database();") == "icash_reliability"
    sql("""drop schema if exists icash_reliability_private cascade;
      drop schema public cascade;create schema public;
      create schema icash_reliability_private;
      do $$begin
        if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
        if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
        if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
      end$$;
      grant usage on schema public,icash_reliability_private to service_role,anon,authenticated;""")
    source = (ROOT / "config/property-text-reception-health.sql").read_text()
    sql(source[source.index("create table icash_reliability_private.text_ingress_monitor"):source.index("create or replace function public.icash_owner_text_health")])
    call = "set role service_role;select public.icash_record_text_ingress_failure('processing_failed','property_ingestion');"
    barrier = Barrier(24)

    def record(_):
        barrier.wait(timeout=10)
        return sql(call)

    with ThreadPoolExecutor(max_workers=24) as pool:
        list(pool.map(record, range(24)))
    health = json.loads(sql("set role service_role;select public.icash_text_ingress_health();"))
    assert health["failedRequests24h"] == 24, health
    assert len(health["failures"]) == 1 and health["failures"][0]["requests"] == 24
    assert health["monitoredSince"] and health["windowStartedAt"]
    for role in ("anon", "authenticated"):
        for signature in ("public.icash_record_text_ingress_failure(text,text)", "public.icash_text_ingress_health()"):
            assert sql(f"select has_function_privilege('{role}','{signature}','execute');") == "f"
        assert execute(f"set role {role};select * from icash_reliability_private.text_ingress_failures;").returncode != 0
    invalid = execute("set role service_role;select public.icash_record_text_ingress_failure('authenticated_rejected','property_ingestion');")
    assert invalid.returncode != 0 and "Invalid text ingress observation" in invalid.stderr
    assert sql("select sum(requests) from icash_reliability_private.text_ingress_failures;") == "24"

    # An unrelated held diagnostic bucket cannot indefinitely delay a webhook.
    blocker = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write("begin;set local statement_timeout='8s';do $$begin perform 1 from icash_reliability_private.text_ingress_failures for update;end$$;select 'ingress_locked';\n")
        blocker.stdin.flush()
        deadline = time.monotonic()+5
        ready = False
        while time.monotonic() < deadline:
            if blocker.poll() is not None:
                raise AssertionError(blocker.stderr.read())
            if select.select([blocker.stdout], [], [], .1)[0] and blocker.stdout.readline().strip() == "ingress_locked":
                ready = True
                break
        assert ready, "Diagnostic lock holder did not become ready"
        start = time.monotonic()
        blocked = execute(call)
        elapsed = time.monotonic()-start
        assert blocked.returncode != 0 and "lock timeout" in blocked.stderr, blocked.stderr
        assert elapsed < 4, elapsed
        blocker.stdin.write("rollback;\n\\q\n")
        blocker.stdin.flush()
        blocker.wait(timeout=5)
        assert blocker.returncode == 0, blocker.stderr.read()
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.wait(timeout=5)
    assert sql("select sum(requests) from icash_reliability_private.text_ingress_failures;") == "24"
    sql(call)
    assert sql("select sum(requests) from icash_reliability_private.text_ingress_failures;") == "25"
    sql("update icash_reliability_private.text_ingress_failures set hour_at=hour_at-interval '25 hours';")
    assert json.loads(sql("set role service_role;select public.icash_text_ingress_health();"))["failedRequests24h"] == 0
    print("PASS native ingress diagnostics: 24 concurrent increments, service-only ACLs, rejected categories, bounded lock timeout with no partial count, recovery and expired buckets. No providers.")


if __name__ == "__main__":
    run()
