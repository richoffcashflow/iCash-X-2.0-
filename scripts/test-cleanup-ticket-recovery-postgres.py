"""Real concurrent sessions on a fixed disposable localhost database; no providers."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]


def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='8s';set timezone='UTC';\n"+query,
                            env=ENV, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def literal(value):
    return "'"+json.dumps(value).replace("'", "''")+"'::jsonb"


def uid(n):
    return f"00000000-0000-4000-8000-{n:012d}"


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
    sql(source[:source.index("create function public.icash_owner_preflight_empty")]+"\ncommit;")
    source = read("config/owner-preflight-renewal.sql")
    sql(source[:source.index("create function icash_research_private.guard_owner_preflight_generation")]+"\ncommit;")
    source = read("config/owner-export-capacity-recovery.sql")
    start = source.index("create function public.icash_owner_export_people_available")
    sql(source[start:source.index("do $$", start)])
    sql(read("config/owner-cleanup-ticket-recovery.sql"))
    sql("update icash_research_private.owner_export_settings set preflight_enabled=true,preflight_renewal_enabled=true;")


def seed(n):
    account, rate, screening, ticket, preflight = [uid(n*10+i) for i in range(1, 6)]
    now = datetime.now(timezone.utc)
    fetched = (now-timedelta(hours=2)).isoformat()
    created = (now-timedelta(minutes=45)).isoformat()
    deleted = (now-timedelta(minutes=35)).isoformat()
    completed = (now-timedelta(minutes=20)).isoformat()
    snapshot = {"propertyId": f"prop_{n}", "propertyType": "house", "fetchedAt": fetched,
                "raw": {"data": {"dm_property_id": f"prop_{n}", "state": "TX"}}}
    items = [{"screeningId": screening, "snapshot": snapshot, "ids": [f"per_{n}"]}]
    request = {"people_ids": [f"per_{n}"], "mobile_only": False}
    name, list_id = "icash-owner-preflight-"+preflight, "synthetic-list-"+str(n)
    raw = {"data": {"list_id": list_id, "name": name, "source_type": "people", "status": "completed", "total_count": 1}}
    receipts = {"create": {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw)}}
    cleanup = [{"token": uid(n*10+6), "receipt": {"httpStatus": 200, "raw": {"data": {"deleted": True}}, "rawText": '{"data":{"deleted":true}}'}}]
    sql(f"""
      insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused) values('{account}','{account}','Synthetic cleanup fixture',false);
      insert into public.icash_wallets(account_id,balance_cents) values('{account}',10000);
      insert into public.icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
        values('{rate}','owner_enrichment','synthetic-cleanup-{n}',105,'{{"dealmachine":250000}}','SYNTHETIC original review',now()-interval '1 day',now()+interval '1 day',true);
      insert into icash_owner_review_private.changes select 'rate',to_jsonb(r),now()-interval '3 hours' from public.icash_operation_rates r where id='{rate}';
      insert into public.icash_discovery_configs(account_id,enabled,contacts_enabled,zip,rate_id,contact_rate_id,property_credit_micros,contact_credit_cap,data_rights_until,seller_cost_reserve_cents,next_run_at)
        values('{account}',true,true,'75217','{rate}','{rate}',10000,25,now()+interval '1 day',100000,now()+interval '1 hour');
      insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
        values('{screening}','{account}','synthetic-cleanup-{n}',{literal(snapshot)},'complete','{{"financialCheck":{{"status":"eligible"}}}}','{fetched}');
      insert into public.icash_automation_tickets(id,token,account_id,kind,screening_id,state,outcome,created_at,completed_at,expires_at,owner_preview_deferrals,owner_preview_retry_after,owner_preview_retry_until,owner_preview_screening_hash)
        select '{ticket}','synthetic-original-token-{n}','{account}','contacts','{screening}','held','held','{created}','{completed}',now()-interval '25 minutes',3,now()-interval '15 minutes',now()+interval '20 hours',public.icash_owner_enrichment_screening_hash(s)
        from public.icash_screening_jobs s where id='{screening}';
      insert into icash_research_private.owner_export_preflights(id,account_id,fingerprint,items,request,created_at,state,started_at,list_id,list_name,receipts,cleanup_attempts,cleanup_token,cleanup_receipts,deleted_at)
        values('{preflight}','{account}','synthetic-fingerprint-{n}',{literal(items)},{literal(request)},'{created}','waiting','{created}',{literal(list_id)},'{name}',{literal(receipts)},1,'{uid(n*10+6)}',{literal(cleanup)},'{deleted}');
    """)
    hashes = json.loads(sql(f"""select jsonb_build_array(public.icash_owner_enrichment_ticket_hash(t),md5(to_jsonb(p)::text),md5((to_jsonb(c)-'next_run_at')::text),md5(to_jsonb(r)::text))
       from public.icash_automation_tickets t,icash_research_private.owner_export_preflights p,public.icash_discovery_configs c,public.icash_operation_rates r
       where t.id='{ticket}' and p.id='{preflight}' and c.account_id='{account}' and r.id='{rate}';"""))
    args = ",".join("'"+value+"'" for value in [ticket, preflight, *hashes])
    return dict(account=account, rate=rate, screening=screening, ticket=ticket, preflight=preflight,
                operation=f"owners:{account}:{screening}", call=f"set role service_role;select public.icash_recover_cleaned_owner_ticket({args});")


def evidence(case):
    return json.loads(sql(f"select jsonb_build_object('ticket',to_jsonb(t),'preflight',to_jsonb(p)) from public.icash_automation_tickets t,icash_research_private.owner_export_preflights p where t.id='{case['ticket']}' and p.id='{case['preflight']}';"))


def no_recovery(case):
    assert sql(f"select count(*) from public.icash_owner_enrichment_recoveries where ticket_id='{case['ticket']}';") == "0"
    assert sql(f"select count(*) from icash_research_private.cleanup_ticket_recoveries where ticket_id='{case['ticket']}';") == "0"


def run():
    setup()
    signature = "public.icash_recover_cleaned_owner_ticket(uuid,uuid,text,text,text,text)"
    for role in ("anon", "authenticated"):
        assert sql(f"select has_function_privilege('{role}','{signature}','execute');") == "f"
        assert sql(f"select has_table_privilege('{role}','icash_research_private.cleanup_ticket_recoveries','SELECT');") == "f"
    assert sql(f"select has_function_privilege('service_role','{signature}','execute');") == "t"
    assert sql("select has_table_privilege('service_role','icash_research_private.cleanup_ticket_recoveries','SELECT');") == "t"
    for role in ("anon", "authenticated", "service_role"):
        for privilege in ("INSERT", "UPDATE", "DELETE"):
            assert sql(f"select has_table_privilege('{role}','icash_research_private.cleanup_ticket_recoveries','{privilege}');") == "f"

    case = seed(1)
    before = evidence(case)
    assert sql(case['call']) == "f", "Repair must install disabled"
    assert evidence(case) == before
    no_recovery(case)
    sql("update icash_research_private.owner_export_settings set cleanup_ticket_recovery_enabled=true;")
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(lambda _: sql(case['call']), range(24)))
    assert results.count("t") == 1 and results.count("f") == 23, results
    after = evidence(case)
    assert after['preflight'] == before['preflight'], "All original creation/deletion receipts and list identity must remain unchanged"
    for key, value in before['ticket'].items():
        if key not in ('outcome', 'owner_preview_retry_after'):
            assert after['ticket'][key] == value, key
    assert after['ticket']['outcome'] == 'owner_preview_rate_limited'
    assert after['ticket']['owner_preview_retry_after'] != before['ticket']['owner_preview_retry_after']
    assert sql(f"select count(*)=1 and min(approved_max_charge_cents)=105 from public.icash_owner_enrichment_recoveries where ticket_id='{case['ticket']}';") == "t"
    assert sql(f"select count(*)=1 and bool_and(before_ticket={literal(before['ticket'])} and preflight={literal(before['preflight'])}) from icash_research_private.cleanup_ticket_recoveries where ticket_id='{case['ticket']}';") == "t"
    for table in ("icash_research_private.cleanup_ticket_recoveries", "public.icash_owner_enrichment_recoveries"):
        for mutation in (f"update {table} set recovered_at=clock_timestamp()", f"delete from {table}"):
            try:
                sql(mutation)
                raise AssertionError("Immutable archive mutation unexpectedly succeeded")
            except AssertionError as error:
                assert "Owner enrichment recovery approval is immutable" in str(error), str(error)
    assert sql(f"select count(*) from public.icash_operation_spend where operation_key='{case['operation']}';") == "0"
    assert sql(f"select balance_cents=10000 and reserved_cents=0 from public.icash_wallets where account_id='{case['account']}';") == "t"

    for n, change in ((2, 'source'), (3, 'rate'), (4, 'funds'), (5, 'existing_receipt')):
        blocked = seed(n)
        if change == 'source':
            sql(f"update public.icash_screening_jobs set snapshot=snapshot||'{{\"propertyId\":\"prop_99999\"}}'::jsonb where id='{blocked['screening']}';")
        elif change == 'rate':
            sql(f"update public.icash_operation_rates set charge_cents=106 where id='{blocked['rate']}';")
        elif change == 'funds':
            sql(f"update public.icash_wallets set reserved_cents=balance_cents where account_id='{blocked['account']}';")
        else:
            sql(f"insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine','{blocked['operation']}:original','synthetic-receipt',null,'credits');")
        saved = evidence(blocked)
        assert sql(blocked['call']) == "f", change
        no_recovery(blocked)
        assert evidence(blocked) == saved

    paused = seed(6)
    before = evidence(paused)
    blocker = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write(f"begin;set local statement_timeout='8s';select id from public.icash_operating_budget where id=1 for update;update public.icash_accounts set bot_paused=true where id='{paused['account']}';select 'pause_locked';\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != 'pause_locked':
            if blocker.poll() is not None:
                raise AssertionError(blocker.stderr.read())
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, paused['call'])
            waiting = False
            for _ in range(80):
                waiting = sql(f"select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%icash_recover_cleaned_owner_ticket%{paused['ticket']}%');") == 't'
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, 'Recovery never reached the shared budget lock'
            blocker.stdin.write("commit;\n\\q\n")
            blocker.stdin.flush()
            blocker.wait(timeout=5)
            assert future.result() == 'f', 'A Pause that wins the budget lock must win recovery'
        no_recovery(paused)
        assert evidence(paused) == before
        assert sql(f"select bot_paused from public.icash_accounts where id='{paused['account']}';") == 't'
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.wait(timeout=5)
    print('PASS native cleanup-ticket repair: 24 workers create one immutable capped approval; exact evidence/token/deferral/deadline remain; source/rate drift, funds, prior receipt and late Pause reject; service-only RPC. No providers.')


if __name__ == '__main__':
    run()
