"""Real scheduler races on a fixed disposable localhost database; no providers."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
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
ISSUE = "set role service_role;set application_name='preflight-priority-contender';select coalesce(public.icash_next_acquisition()::text,'null');"


def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='8s';set timezone='UTC';\n"+query,
                            env=ENV, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def read(path):
    return (ROOT / path).read_text()


def setup():
    assert sql("select current_database();") == "icash_reliability"
    sql("drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema if exists icash_private cascade;drop schema public cascade;create schema public;")
    sql(read("tests/fixtures/opportunity-schema.sql"))
    sql(read("tests/fixtures/owner-cleanup-ticket-recovery-native.sql"))
    source = read("config/owner-enrichment-deferral.sql")
    sql(source[:source.index("create function public.icash_defer_owner_enrichment")]+"\ncommit;")
    source = read("config/owner-export-preflight.sql")
    sql(source[:source.index("create function public.icash_claim_owner_preflight")]+"\ncommit;")
    sql(read("tests/fixtures/owner-preflight-priority-foundation.sql"))
    definitions = json.loads(read("tests/fixtures/owner-preflight-priority-before.json"))
    order = [
        "icash_research_private.owner_preflight_cohort(uuid,uuid)",
        "public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)",
        "public.icash_enrichment_before_prospecting_budget(uuid)",
        "public.icash_enrichment_before_provider_quota(uuid)",
        "public.icash_enrichment_candidate(uuid)",
        "public.icash_next_acquisition()",
    ]
    assert set(definitions) == set(order)
    for signature in order:
        sql(definitions[signature])
        expected = hashlib.md5(definitions[signature].encode()).hexdigest()
        assert sql(f"select md5(pg_get_functiondef('{signature}'::regprocedure));") == expected, signature
    sql("""
      grant select,insert,update,delete on all tables in schema public to service_role;
      revoke all on all functions in schema public from public,anon,authenticated;
      grant execute on all functions in schema public to service_role;
      grant usage on schema icash_private to service_role;
      grant select on all tables in schema icash_private to service_role;
      revoke all on schema icash_research_private from public,anon,authenticated,service_role;
      update icash_research_private.owner_export_settings set preflight_enabled=true;
    """)
    sql(read("config/owner-preflight-priority.sql"))


def seed(n):
    # Keep every scenario isolated without rewriting a prior ticket or receipt.
    sql("update public.icash_discovery_configs set enabled=false;")
    case = json.loads(sql(f"select public.fixture_preflight_seed({n},true,interval '2 minutes');"))
    # Otherwise a correctly rejected old operation could select independent work.
    sql(f"update public.icash_screening_jobs set result='{{\"financialCheck\":{{\"status\":\"ineligible\"}}}}' where id='{case['fresh']}';")
    case['operation'] = f"owners:{case['account']}:{case['screening']}"
    return case


def evidence(case):
    return json.loads(sql(f"""select jsonb_build_object('ticket',to_jsonb(t),'preflight',to_jsonb(p),
      'wallet',to_jsonb(w),'rate',to_jsonb(r))
      from public.icash_automation_tickets t,icash_research_private.owner_export_preflights p,
       public.icash_wallets w,public.icash_operation_rates r
      where t.id='{case['ticket']}' and p.id='{case['preflight']}'
       and w.account_id='{case['account']}' and r.id='{case['rate']}';"""))


def assert_no_paid_work():
    for table in ('icash_operation_spend', 'icash_credit_reservations', 'icash_cost_manifests', 'icash_credit_ledger'):
        assert sql(f"select count(*) from public.{table};") == '0', table


def wait_for_marker(process, marker):
    deadline = time.monotonic()+5
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(process.stderr.read())
        if select.select([process.stdout], [], [], 0.1)[0]:
            if process.stdout.readline().strip() == marker:
                return
    raise AssertionError('Budget-lock holder did not become ready')


def late_guard(case, mutation, label):
    before = evidence(case)
    assert sql(f"set role service_role;select public.icash_owner_preflight_due_at('{case['account']}',null::uuid) is not null;") == 't'
    blocker = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write("begin;set local statement_timeout='8s';do $$begin perform 1 from public.icash_operating_budget where id=1 for update;end$$;"+mutation+"select 'budget_locked';\n")
        blocker.stdin.flush()
        wait_for_marker(blocker, 'budget_locked')
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, ISSUE)
            deadline = time.monotonic()+5
            waiting = False
            while time.monotonic() < deadline:
                waiting = sql("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and application_name='preflight-priority-contender' and wait_event_type='Lock' and query like '%icash_next_acquisition%');") == 't'
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, 'Issuer never reached the shared budget lock'
            blocker.stdin.write("commit;\n\\q\n")
            blocker.stdin.flush()
            blocker.wait(timeout=5)
            assert blocker.returncode == 0, blocker.stderr.read()
            assert json.loads(future.result()) is None, label
        assert evidence(case) == before, label+' must retain original ticket and preflight evidence'
        assert sql(f"select count(*) from public.icash_automation_tickets where account_id='{case['account']}' and state='issued';") == '0'
        assert sql(f"set role service_role;select public.icash_owner_preflight_due_at('{case['account']}',null::uuid) is null;") == 't'
        assert_no_paid_work()
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.wait(timeout=5)


def run():
    setup()
    helper = 'public.icash_owner_preflight_due_at(uuid,uuid)'
    for role in ('anon', 'authenticated', 'service_role'):
        assert sql(f"select has_function_privilege('{role}','{helper}','execute');") == ('t' if role == 'service_role' else 'f')
        assert sql(f"select has_schema_privilege('{role}','icash_research_private','usage');") == 'f'
        assert sql(f"select has_table_privilege('{role}','icash_research_private.owner_export_preflights','select');") == 'f'

    case = seed(1)
    before = evidence(case)
    config_before = sql(f"select md5(to_jsonb(c)::text) from public.icash_discovery_configs c where account_id='{case['account']}';")
    for screening in ("null::uuid", "'"+case['screening']+"'::uuid"):
        assert sql(f"set role service_role;select public.icash_owner_preflight_due_at('{case['account']}',{screening}) is not null;") == 't'
    assert sql(f"set role service_role;select public.icash_enrichment_candidate('{case['account']}');") == case['screening']
    assert evidence(case) == before, 'Read-only preference must preserve all evidence'
    assert sql(f"select md5(to_jsonb(c)::text) from public.icash_discovery_configs c where account_id='{case['account']}';") == config_before

    barrier = Barrier(24)

    def issue(_):
        barrier.wait(timeout=10)
        return json.loads(sql(ISSUE))

    with ThreadPoolExecutor(max_workers=24) as pool:
        results = list(pool.map(issue, range(24)))
    issued = [result for result in results if result is not None]
    assert len(issued) == 1 and results.count(None) == 23, results
    after = evidence(case)
    assert sql("select count(*) from public.icash_automation_tickets where state='issued';") == '1'
    assert after['ticket']['token'] == issued[0]['token']
    assert after['ticket']['token'] != before['ticket']['token']
    assert after['ticket']['state'] == 'issued'
    changed = {'token', 'state', 'outcome', 'completed_at', 'created_at', 'expires_at'}
    for field, value in before['ticket'].items():
        if field not in changed:
            assert after['ticket'][field] == value, field
    for field in ('preflight', 'wallet', 'rate'):
        assert after[field] == before[field], field
    assert_no_paid_work()

    paused = seed(2)
    late_guard(paused, f"update public.icash_accounts set bot_paused=true where id='{paused['account']}';",
               'Pause committed ahead of the budget lock must prevent issue')
    assert sql(f"select bot_paused from public.icash_accounts where id='{paused['account']}';") == 't'

    observed = seed(3)
    late_guard(observed, f"insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine','{observed['operation']}:original','synthetic-original-receipt',null,'credits');",
               'Original unknown cost evidence committed ahead of the budget lock must prevent issue')
    assert sql(f"select count(*) from public.icash_cost_observations where event_key='{observed['operation']}:original' and amount is null and not reconciled;") == '1'
    print('PASS native preflight priority: 24 issuers produce one ticket; selection preserves original evidence and deferral fields; late Pause and original cost evidence win the budget lock; service-only helper needs no private-schema access. No providers.')


if __name__ == '__main__':
    run()
