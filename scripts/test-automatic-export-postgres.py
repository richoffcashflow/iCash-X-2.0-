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
for status in [500, 504]:
    sql("drop schema if exists icash_research_private cascade; drop schema public cascade; create schema public;")
    for file in ["tests/fixtures/automatic-export-foundation.sql", "config/owner-export-capacity-recovery.sql", "supabase/migrations/20261030012215_owner_export_capacity_precision.sql", "config/automatic-export-capacity.sql", "config/gateway-export-capacity.sql"]:
        source = (ROOT/file).read_text()
        if "foundation" in file:
            source = re.sub(r"create role (anon|authenticated|service_role);", "", source)
        sql(source)
    batch, account = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
    raw = {"error": {"code": "internal_error", "request_id": "req_fixture"}}
    failure = {"httpStatus": 500, "raw": raw, "rawText": json.dumps(raw)} if status == 500 else {"httpStatus": 504, "raw": None, "rawText": "<title>dealmachine.com | 504: Gateway time-out</title><p>api.v2.dealmachine.com</p>"}
    sql(f"""insert into icash_research_private.owner_batches(id,account_id,created_at) values('{batch}','{account}',now()-interval '8 minutes');
    insert into icash_research_private.owner_exports(id,request,receipt) values('{batch}','{{"people_ids":["held-owner"]}}',{literal(failure)});
    insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values('{batch}','owner_lookup','{account}','owner-batch:{batch}',true,now()-interval '8 minutes',now()-interval '6 minutes','{{"outcome":"http_error","httpStatus":{status}}}');
    insert into icash_operation_spend values('original','dispatched',100);
    update icash_research_private.export_capacity_automation set enabled=true,gateway_enabled=true;""")
    claims = [json.loads(r) for r in contend("select icash_claim_automatic_export_capacity(repeat('a',40));") if r]
    assert len(claims) == 1, claims
    claim = claims[0]
    stamp = sql("select clock_timestamp();")
    for probe in ["inventory", "pending", "processing"]:
        if probe != "inventory":
            requests = [r for r in contend(f"select icash_claim_export_capacity_probe('{claim['reviewId']}','{probe}');") if r]
            assert len(requests) == 1, requests
        data = [{"export_id": f"fixture-{i}", "status": "failed", "created_at": stamp} for i in range(100)] if probe == "inventory" else []
        raw = {"data": data, "pagination": {"limit": 100, "offset": 0, "total": 5000 if data else 0, "has_more": bool(data)}}
        receipt = {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw), "headers": {"minuteRemaining": 49, "dayRemaining": 300}}
        writes = contend(f"select icash_record_export_capacity_probe('{claim['reviewId']}','{probe}',{literal(receipt)});", 12)
        assert set(writes) == {"t"}, writes
    finished = contend(f"select icash_finish_automatic_export_capacity('{claim['reviewId']}');", 16)
    assert "capacity_verified" in finished and set(finished) <= {"capacity_verified", "capacity_review_held"}, finished
    assert sql("select icash_owner_active_export_capacity();") == "ready"
    assert sql("select count(*) from icash_research_private.export_capacity_probes;") == "3"
    assert sql("select count(*) from icash_research_private.requests where kind='owner_preview';") == "3"
    assert sql("select state from icash_operation_spend;") == "dispatched"
    assert sql("select icash_owner_export_people_available('[\"held-owner\"]');") == "f"
    assert sql("select terminal_at is null and completed_at is null from icash_research_private.owner_exports;") == "t"
    print(f"PASS native PostgreSQL HTTP {status}: competing workers claim one recovery, one request per probe, idempotent receipts and capacity completion; original money and owner fences remain.")
