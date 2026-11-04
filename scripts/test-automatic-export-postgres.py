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


def rejected_before_claim(mutation):
    # Each rejection is isolated from the saved original and successful race.
    assert sql("begin;"+mutation+"select icash_claim_automatic_export_capacity(repeat('a',40));"
               "select count(*) from icash_research_private.owner_export_capacity_reviews;rollback;") == "0", mutation


def probe_receipt(probe, stamp, server_date=None):
    data = [{"export_id": f"fixture-{i}", "status": "failed", "created_at": stamp} for i in range(100)] if probe == "inventory" else []
    raw = {"data": data, "pagination": {"limit": 100, "offset": 0, "total": 5000 if data else 0, "has_more": bool(data)}}
    return {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw), "headers": {"minuteRemaining": 49, "dayRemaining": 300, "serverDate": server_date, "age": None}}


def rejected_at_finish(stamp, mutation="", bad_header=None):
    # Give every refusal a fresh attempt. Reusing a previous inventory claim
    # would consume its real 20-second response window during unrelated tests.
    review = "current_setting('fixture.capacity_review_id')::uuid"
    statements = ["begin;do $$declare r jsonb;begin r:=icash_claim_automatic_export_capacity(repeat('a',40));"
                  "if r->>'reviewId' is null then raise exception 'Fresh fixture claim required';end if;"
                  "perform set_config('fixture.capacity_review_id',r->>'reviewId',true);end$$;"]
    for probe in ["inventory", "pending", "processing"]:
        if probe != "inventory":
            statements.append(f"do $$begin perform icash_claim_export_capacity_probe({review},'{probe}');end$$;")
        receipt = literal(probe_receipt(probe, stamp))
        date = "to_jsonb(to_char(clock_timestamp() at time zone 'UTC','Dy, DD Mon YYYY HH24:MI:SS \"GMT\"'))"
        receipt = f"jsonb_set({receipt},'{{headers,serverDate}}',{date})"
        if probe == "processing" and bad_header is not None:
            if bad_header == "missing_date":
                receipt = f"({receipt} #- '{{headers,serverDate}}')"
            elif bad_header == "malformed_date":
                receipt = f"jsonb_set({receipt},'{{headers,serverDate}}','\"not-a-date\"')"
            elif bad_header in ("stale_date", "future_date"):
                offset = "-" if bad_header == "stale_date" else "+"
                date = f"to_jsonb(to_char((clock_timestamp(){offset}interval '1 day') at time zone 'UTC','Dy, DD Mon YYYY HH24:MI:SS \"GMT\"'))"
                receipt = f"jsonb_set({receipt},'{{headers,serverDate}}',{date})"
            elif bad_header in ("cached", "malformed_age"):
                age = '"1"' if bad_header == "cached" else '"invalid"'
                receipt = f"jsonb_set({receipt},'{{headers,age}}','{age}')"
        statements.append(f"do $$begin perform icash_record_export_capacity_probe({review},'{probe}',{receipt});end$$;")
    statements += [mutation, f"select icash_finish_automatic_export_capacity({review});",
                   "select icash_owner_active_export_capacity();",
                   "select state from icash_operation_spend;",
                   "select icash_owner_export_people_available('[\"held-owner\"]');", "rollback;"]
    assert sql("".join(statements)).splitlines() == ["capacity_review_held", "export_busy", "dispatched", "f"], mutation or bad_header or "stale inventory"


assert sql("select current_database();") == "icash_reliability"
for status in [500, 504, 400]:
    sql("drop schema if exists icash_research_private cascade; drop schema public cascade; create schema public;")
    for file in ["tests/fixtures/automatic-export-foundation.sql", "config/owner-export-capacity-recovery.sql", "supabase/migrations/20261030012215_owner_export_capacity_precision.sql", "config/automatic-export-capacity.sql", "config/gateway-export-capacity.sql", "config/empty-export-capacity.sql", "config/empty-export-capacity-freshness.sql"]:
        source = (ROOT/file).read_text()
        if "foundation" in file:
            source = re.sub(r"create role (anon|authenticated|service_role);", "", source)
        sql(source)
    batch, account = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
    raw = {"error": {"code": "internal_error", "request_id": "req_fixture"}}
    if status == 400:
        raw = {"error": {"code": "invalid_request", "message": 'No records matched this export. Filters and scrub settings (like "Active phone numbers only") may have excluded every record — adjust them and try again.', "request_id": "req_fixture"}}
    failure = {"httpStatus": status, "raw": raw, "rawText": json.dumps(raw)} if status != 504 else {"httpStatus": 504, "raw": None, "rawText": "<title>dealmachine.com | 504: Gateway time-out</title><p>api.v2.dealmachine.com</p>"}
    sql(f"""insert into icash_research_private.owner_batches(id,account_id,created_at) values('{batch}','{account}',now()-interval '8 minutes');
    insert into icash_research_private.owner_exports(id,request,receipt) values('{batch}','{{"people_ids":["held-owner"]}}',{literal(failure)});
    insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values('{batch}','owner_lookup','{account}','owner-batch:{batch}',true,now()-interval '8 minutes',now()-interval '6 minutes','{{"outcome":"http_error","httpStatus":{status}}}');
    insert into icash_operation_spend values('original','dispatched',100);
    update icash_research_private.export_capacity_automation set enabled=true,gateway_enabled=true;""")
    if status == 400:
        # The normal receipt recorder also preserves this JSON error on the
        # claimed batch. It does not prove zero cost or completed enrichment.
        sql(f"update icash_research_private.owner_batches set paid_receipt={literal(raw)} where id='{batch}';")
        assert sql("select empty_enabled from icash_research_private.export_capacity_automation;") == "f"
        assert sql("select icash_claim_automatic_export_capacity(repeat('a',40));") == ""
        assert sql("select count(*) from icash_research_private.owner_export_capacity_reviews;") == "0"
        assert sql("select icash_owner_active_export_capacity();") == "export_busy"
        sql("update icash_research_private.export_capacity_automation set empty_enabled=true;")
        for mutation in [
            "update icash_research_private.requests set account_id='00000000-0000-4000-8000-000000000999';",
            "update icash_research_private.requests set operation_key='owner-batch:foreign';",
            "update icash_research_private.requests set admitted=false;",
            "update icash_research_private.requests set kind='owner_preview';",
            "update icash_research_private.requests set account_id=null;",
            "update icash_research_private.requests set result='{}';",
            "update icash_research_private.requests set finished_at=null;",
            "update icash_research_private.requests set finished_at=now();",
            "update icash_research_private.requests set finished_at=now()-interval '1 minute';",
            "update icash_research_private.requests set finished_at=created_at-interval '1 second';",
            "update icash_research_private.owner_batches set paid_receipt=null;",
            "update icash_research_private.owner_batches set paid_receipt='{}';",
            "update icash_research_private.owner_batches set state='complete';",
            "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute';",
            "update icash_research_private.owner_exports set recovery='{}';",
            "update icash_research_private.owner_exports set csv='saved artifact';",
            "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{rawText}','\"changed receipt\"');",
            "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw,error,code}','\"other_error\"');",
            "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw,error,message}','\"A different invalid request\"');",
            "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{raw,export_id}','\"known_export\"');",
            "update fixture_settings set quota=false;",
        ]:
            rejected_before_claim(mutation)
    old_inventory_stamp = sql("select now()-interval '1 day';")
    if status == 400:
        for bad_header in ["missing_date", "malformed_date", "stale_date", "future_date", "cached", "malformed_age"]:
            rejected_at_finish(old_inventory_stamp, bad_header=bad_header)
        # All three fresh free receipts are required, and their final decision
        # rechecks the exact source and switch after admission.
        for mutation in [
            "update icash_research_private.export_capacity_automation set empty_enabled=false;",
            "update icash_research_private.export_capacity_automation set enabled=false;",
            "update icash_research_private.owner_batches set paid_receipt='{}';",
            "update icash_research_private.requests set result='{}' where kind='owner_lookup';",
            "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute';",
            f"update icash_research_private.requests set account_id='00000000-0000-4000-8000-000000000999' where id='{batch}';",
            "update icash_research_private.owner_exports set receipt=jsonb_set(receipt,'{rawText}','\"changed after admission\"');",
            "update icash_research_private.requests set operation_key='foreign probe' where kind='owner_preview';",
        ]:
            rejected_at_finish(old_inventory_stamp, mutation)
    else:
        # Unknown 500/504 outcomes still need a terminal inventory record at
        # least as recent as their incident, even with three current Dates.
        rejected_at_finish(old_inventory_stamp)
    assert sql("select count(*) from icash_research_private.owner_export_capacity_reviews;") == "0"
    assert sql("select count(*) from icash_research_private.export_capacity_probes;") == "0"
    original_export = sql("select to_jsonb(e)-'capacity_review_id' from icash_research_private.owner_exports e;")
    original_batch = sql("select to_jsonb(b) from icash_research_private.owner_batches b;")
    original_request = sql(f"select to_jsonb(r) from icash_research_private.requests r where id='{batch}';")
    original_money = sql("select to_jsonb(o) from icash_operation_spend o;")
    claims = [json.loads(r) for r in contend("select icash_claim_automatic_export_capacity(repeat('a',40));") if r]
    assert len(claims) == 1, claims
    claim = claims[0]
    expected_policy = {500: "idle-v1", 504: "gateway-idle-v1", 400: "empty-idle-v1"}[status]
    assert sql(f"select auto_policy from icash_research_private.owner_export_capacity_reviews where id='{claim['reviewId']}';") == expected_policy
    # The exact 400 rejection produces no export history entry. Current free
    # responses must recover capacity using older terminal history alone.
    stamp = old_inventory_stamp if status == 400 else sql("select clock_timestamp();")
    for probe in ["inventory", "pending", "processing"]:
        if probe != "inventory":
            requests = [r for r in contend(f"select icash_claim_export_capacity_probe('{claim['reviewId']}','{probe}');") if r]
            assert len(requests) == 1, requests
        server_date = sql("select to_char(clock_timestamp() at time zone 'UTC','Dy, DD Mon YYYY HH24:MI:SS \"GMT\"');")
        receipt = probe_receipt(probe, stamp, server_date)
        if probe == "pending":
            receipt['headers']['age'] = '0'
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
    assert sql("select to_jsonb(e)-'capacity_review_id' from icash_research_private.owner_exports e;") == original_export
    assert sql("select to_jsonb(b) from icash_research_private.owner_batches b;") == original_batch
    assert sql(f"select to_jsonb(r) from icash_research_private.requests r where id='{batch}';") == original_request
    assert sql("select to_jsonb(o) from icash_operation_spend o;") == original_money
    print(f"PASS native PostgreSQL HTTP {status}: competing workers claim one recovery, one request per probe, idempotent receipts and capacity completion; original money and owner fences remain.")
    if status == 400:
        print("PASS native empty-filter freshness: older terminal inventory plus three fresh provider Dates recovers capacity; missing/malformed/stale/future Dates or cached responses hold. Foreign/unfinished source, changed receipts, saved artifacts, quota refusal, foreign probes and late disable retain original holds; unknown 500/504 still require post-incident history.")
