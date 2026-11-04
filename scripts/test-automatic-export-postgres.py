"""Native multi-session PostgreSQL; disposable localhost fixtures, no providers."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]


def sql(query):
    r = subprocess.run(CMD, input="set statement_timeout='8s';\n"+query, env=ENV, text=True, capture_output=True, timeout=15)
    if r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


def literal(value):
    return "'"+json.dumps(value).replace("'", "''")+"'::jsonb"


def contend(query, count=24):
    with ThreadPoolExecutor(max_workers=12) as pool:
        return list(pool.map(lambda _: sql(query), range(count)))


assert sql("select current_database();") == "icash_reliability"
for status in [500, 504, 400]:
    sql("drop schema if exists icash_research_private cascade; drop schema public cascade; create schema public;")
    for file in ["tests/fixtures/automatic-export-foundation.sql", "config/owner-export-capacity-recovery.sql", "supabase/migrations/20261030012215_owner_export_capacity_precision.sql", "config/automatic-export-capacity.sql", "config/gateway-export-capacity.sql", "config/empty-export-capacity.sql", "config/empty-export-immediate-capacity.sql"]:
        source = (ROOT/file).read_text()
        if "foundation" in file:
            source = re.sub(r"create role (anon|authenticated|service_role);", "", source)
        sql(source)
    batch, account = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
    raw = {"error": {"code": "internal_error", "request_id": "req_fixture"}}
    if status == 400:
        raw = {"error": {"code": "invalid_request", "request_id": "req_fixture", "message": 'No records matched this export. Filters and scrub settings (like "Active phone numbers only") may have excluded every record — adjust them and try again.'}}
    failure = {"httpStatus": status, "raw": raw, "rawText": json.dumps(raw)} if status != 504 else {"httpStatus": 504, "raw": None, "rawText": "<title>dealmachine.com | 504: Gateway time-out</title><p>api.v2.dealmachine.com</p>"}
    paid_receipt = literal(raw) if status == 400 else "null"
    created = "now()-interval '1 second'" if status == 400 else "now()-interval '8 minutes'"
    completed = "now()" if status == 400 else "now()-interval '6 minutes'"
    sql(f"""insert into icash_research_private.owner_batches(id,account_id,created_at,paid_receipt) values('{batch}','{account}',{created},{paid_receipt});
    insert into icash_research_private.owner_exports(id,request,receipt) values('{batch}','{{"people_ids":["held-owner"]}}',{literal(failure)});
    insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values('{batch}','owner_lookup','{account}','owner-batch:{batch}',true,{created},{completed},'{{"outcome":"http_error","httpStatus":{status}}}');
    insert into icash_operation_spend values('original','dispatched',100);
    update icash_research_private.export_capacity_automation set enabled=true,gateway_enabled=true;""")
    if status == 400:
        assert sql("select icash_claim_automatic_export_capacity(repeat('a',40));") == "", "The new response family is staged disabled"
        assert sql("select count(*) from icash_research_private.owner_export_capacity_reviews;") == "0"
        sql("update icash_research_private.export_capacity_automation set empty_enabled=true;")
        immediate = sql("begin;update icash_research_private.requests set finished_at=now();"
                        + f"select icash_research_private.capacity_source_policy('{batch}',md5(receipt::text)) from icash_research_private.owner_exports where id='{batch}';rollback;")
        assert immediate == "empty-idle-v1", "Exact completed no-records evidence is eligible immediately"
        # An unrelated 400, malformed source, interrupted handler or changed
        # batch cannot inherit the exact observed no-records recovery family.
        for change in [
            "update icash_research_private.requests set finished_at=null",
            "update icash_research_private.requests set finished_at=now()+interval '1 minute'",
            "update icash_research_private.requests set finished_at=created_at-interval '1 second'",
            "update icash_research_private.requests set admitted=false",
            "update icash_research_private.requests set kind='owner_preview'",
            "update icash_research_private.requests set operation_key='wrong'",
            "update icash_research_private.requests set account_id=null",
            "update icash_research_private.requests set result='{}'",
            "update icash_research_private.owner_batches set paid_receipt=null",
            "update icash_research_private.owner_batches set state='complete'",
            "update icash_research_private.owner_exports set recovery='{}'",
            "update icash_research_private.owner_exports set csv='unreviewed data'",
            "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute'",
            "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{rawText}','\"mismatched raw response\"')",
            "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw,error,message}','\"A different invalid request\"')",
            "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw,export_id}','\"known_export\"')",
        ]:
            result = sql("begin;"+change+";select icash_claim_automatic_export_capacity(repeat('a',40));rollback;")
            assert result == "", (change, result)
        assert sql(f"select finished_at>now()-interval '1 minute' from icash_research_private.requests where id='{batch}';") == "t", "The concurrent 400 exercise must not wait out the previous five-minute guard"
    else:
        for completion in ["now()", "now()+interval '1 minute'", "null"]:
            refused = sql(f"begin;update icash_research_private.requests set finished_at={completion};"
                          + "select icash_claim_automatic_export_capacity(repeat('a',40));rollback;")
            assert refused == "", f"HTTP {status} retains its original completed-handler age guard"
    original = sql("select md5((to_jsonb(e)-'capacity_review_id')::text) from icash_research_private.owner_exports e;")
    original_request = sql(f"select md5(to_jsonb(r)::text) from icash_research_private.requests r where id='{batch}';")
    original_batch = sql("select md5(to_jsonb(b)::text) from icash_research_private.owner_batches b;")
    original_money = sql("select md5(to_jsonb(s)::text) from public.icash_operation_spend s;")
    claims = [json.loads(r) for r in contend("select icash_claim_automatic_export_capacity(repeat('a',40));") if r]
    assert len(claims) == 1, claims
    claim = claims[0]
    # A rejected empty export may create no history row. Fresh authenticated
    # inventory can truthfully contain only older terminal exports for 400.
    stamp = "2000-01-01T00:00:00Z" if status == 400 else sql("select clock_timestamp();")
    for probe in ["inventory", "pending", "processing"]:
        if probe != "inventory":
            requests = [r for r in contend(f"select icash_claim_export_capacity_probe('{claim['reviewId']}','{probe}');") if r]
            assert len(requests) == 1, requests
        data = [{"export_id": f"fixture-{i}", "status": "failed", "created_at": stamp} for i in range(100)] if probe == "inventory" else []
        raw = {"data": data, "pagination": {"limit": 100, "offset": 0, "total": 5000 if data else 0, "has_more": bool(data)}}
        receipt = {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw), "headers": {"minuteRemaining": 49, "dayRemaining": 300}}
        writes = contend(f"select icash_record_export_capacity_probe('{claim['reviewId']}','{probe}',{literal(receipt)});", 12)
        assert set(writes) == {"t"}, writes
    if status in [500, 504]:
        held = sql("begin;update icash_research_private.owner_batches set created_at=now()+interval '1 day';"
                   + f"select icash_finish_automatic_export_capacity('{claim['reviewId']}');rollback;")
        assert held == "capacity_review_held", "Pre-incident history remains insufficient for 500/504"
    if status == 400:
        # Independent sessions change source/policy after the three reads. The
        # final transaction must check current evidence rather than its claim.
        for change in [
            "update icash_research_private.export_capacity_automation set empty_enabled=false",
            "update icash_research_private.export_capacity_automation set enabled=false",
            "update icash_research_private.owner_batches set paid_receipt='{}'",
            "update icash_research_private.requests set result='{}' where kind='owner_lookup'",
            "update icash_research_private.requests set finished_at=null where kind='owner_lookup'",
            "update icash_research_private.requests set finished_at=now()+interval '1 minute' where kind='owner_lookup'",
            "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute'",
        ]:
            held = sql("begin;"+change+f";select icash_finish_automatic_export_capacity('{claim['reviewId']}');rollback;")
            assert held == "capacity_review_held", (change, held)
            assert sql("select capacity_review_id is null from icash_research_private.owner_exports;") == "t"
        assert sql(f"select auto_policy from icash_research_private.owner_export_capacity_reviews where id='{claim['reviewId']}';") == "empty-idle-v1"
    finished = contend(f"select icash_finish_automatic_export_capacity('{claim['reviewId']}');", 16)
    assert "capacity_verified" in finished and set(finished) <= {"capacity_verified", "capacity_review_held"}, finished
    assert sql("select icash_owner_active_export_capacity();") == "ready"
    assert sql("select count(*) from icash_research_private.export_capacity_probes;") == "3"
    assert sql("select count(*) from icash_research_private.requests where kind='owner_preview';") == "3"
    assert sql("select state from icash_operation_spend;") == "dispatched"
    assert sql("select icash_owner_export_people_available('[\"held-owner\"]');") == "f"
    assert sql("select terminal_at is null and completed_at is null from icash_research_private.owner_exports;") == "t"
    assert sql("select md5((to_jsonb(e)-'capacity_review_id')::text) from icash_research_private.owner_exports e;") == original
    assert sql(f"select md5(to_jsonb(r)::text) from icash_research_private.requests r where id='{batch}';") == original_request
    assert sql("select md5(to_jsonb(b)::text) from icash_research_private.owner_batches b;") == original_batch
    assert sql("select md5(to_jsonb(s)::text) from public.icash_operation_spend s;") == original_money
    print(f"PASS native PostgreSQL HTTP {status}: competing workers claim one recovery, one request per probe, idempotent receipts and capacity completion; original money and owner fences remain.")
