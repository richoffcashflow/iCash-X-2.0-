"""Native multi-session unknown-export capacity recovery; localhost only, no provider."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import format_datetime
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]
BATCH = "00000000-0000-4000-8000-000000000001"
ACCOUNT = "00000000-0000-4000-8000-000000000002"
SCREENING = "00000000-0000-4000-8000-000000000003"
TICKET = "00000000-0000-4000-8000-000000000004"


def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='8s';\n" + query,
                            env=ENV, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def contend(query, count=24):
    with ThreadPoolExecutor(max_workers=12) as pool:
        return list(pool.map(lambda _: sql(query), range(count)))


def receipt(probe):
    # An unknown POST need not have produced any inventory row. Original
    # unknown owner/billing evidence remains held after capacity verification.
    data = [{"export_id": "old-terminal", "status": "completed", "created_at": "2000-01-01T00:00:00Z"}] if probe == "inventory" else []
    raw = {"data": data, "pagination": {"limit": 100, "offset": 0, "total": len(data), "has_more": False}}
    return {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw),
            "headers": {"minuteRemaining": 49, "dayRemaining": 300,
                        "date": format_datetime(datetime.now(timezone.utc), usegmt=True), "age": None}}


def claim_and_probe(concurrent=False, mutate=None):
    values = contend("select icash_claim_automatic_export_capacity(repeat('a',40));") if concurrent else [sql("select icash_claim_automatic_export_capacity(repeat('a',40));")]
    claims = [json.loads(value) for value in values if value]
    assert len(claims) == 1, claims
    claim = claims[0]
    for probe in ["inventory", "pending", "processing"]:
        if probe != "inventory":
            query = f"select icash_claim_export_capacity_probe('{claim['reviewId']}','{probe}');"
            requests = [value for value in (contend(query) if concurrent else [sql(query)]) if value]
            assert len(requests) == 1, requests
        evidence = receipt(probe)
        if mutate:
            mutate(evidence, probe)
            evidence["rawText"] = json.dumps(evidence["raw"])
        query = f"select icash_record_export_capacity_probe('{claim['reviewId']}','{probe}',{literal(evidence)});"
        writes = contend(query, 12) if concurrent else [sql(query)]
        assert set(writes) == {"t"}, writes
    return claim


def source_snapshot():
    return sql(f"""select jsonb_build_object(
      'export',(select to_jsonb(e)-'capacity_review_id' from icash_research_private.owner_exports e where id='{BATCH}'),
      'batch',(select to_jsonb(b) from icash_research_private.owner_batches b where id='{BATCH}'),
      'request',(select to_jsonb(r) from icash_research_private.requests r where id='{BATCH}'),
      'handler',(select to_jsonb(t) from public.icash_automation_tickets t where id='{TICKET}'),
      'money',(select jsonb_agg(to_jsonb(s) order by operation_key) from public.icash_operation_spend s));""")


assert sql("select current_database();") == "icash_reliability"
# Setup and tests follow the exact installed source family below.

FILES = ["tests/fixtures/automatic-export-foundation.sql", "config/owner-export-capacity-recovery.sql",
         "supabase/migrations/20261030012215_owner_export_capacity_precision.sql",
         "config/automatic-export-capacity.sql", "config/gateway-export-capacity.sql",
         "config/empty-export-capacity.sql", "config/empty-export-immediate-capacity.sql"]


def setup():
    sql("drop schema if exists icash_research_private cascade; drop schema public cascade; create schema public;")
    for filename in FILES:
        source = (ROOT / filename).read_text()
        if "foundation" in filename:
            source = re.sub(r"create role (anon|authenticated|service_role);", "", source)
        sql(source)
    for filename in ["tests/fixtures/unknown-export-foundation.sql",
                     "tests/fixtures/unknown-export-late-foundation.sql",
                     "tests/fixtures/unknown-export-late-live-functions.sql",
                     "tests/fixtures/unknown-export-late-batch-function.sql",
                     "config/unknown-export-capacity.sql",
                     "config/unknown-export-late-evidence.sql"]:
        sql((ROOT / filename).read_text())
    sql(f"""insert into icash_research_private.owner_batches(id,account_id,primary_screening,created_at)
      values('{BATCH}','{ACCOUNT}','{SCREENING}',now()-interval '9 minutes');
      insert into icash_research_private.owner_exports(id,request) values('{BATCH}','{{"people_ids":["held-owner"]}}');
      insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result)
      values('{BATCH}','owner_lookup','{ACCOUNT}','owner-batch:{BATCH}',true,now()-interval '9 minutes',now()-interval '7 minutes','{{"outcome":"unknown"}}');
      insert into icash_automation_tickets(id,account_id,screening_id,kind,state,outcome,created_at,issue_attempts,expires_at,completed_at)
      values('{TICKET}','{ACCOUNT}','{SCREENING}','contacts','held','held_for_reconciliation',now()-interval '10 minutes',1,now()-interval '7 minutes',now()-interval '6 minutes 59 seconds');
      insert into icash_operation_spend values('original','dispatched',105);
      update icash_research_private.export_capacity_automation set enabled=true,gateway_enabled=true,empty_enabled=true;""")


def enable():
    sql("update icash_research_private.export_capacity_automation set unknown_enabled=true;")


setup()
assert sql("select icash_owner_active_export_capacity();") == "export_busy"
assert sql("select unknown_enabled from icash_research_private.export_capacity_automation;") == "f"
assert sql("select icash_claim_automatic_export_capacity(repeat('a',40));") == ""
assert sql("select count(*) from icash_research_private.owner_export_capacity_reviews;") == "0"
enable()
original = source_snapshot()

# Each failed source gate preserves the original rows, including request facts
# whose absence or chronology must not be silently accepted by SQL NULL logic.
for change in [
    "update icash_research_private.requests set admitted=false",
    "update icash_research_private.requests set admitted=null",
    "update icash_research_private.requests set finished_at=null",
    "update icash_research_private.requests set finished_at=now()",
    "update icash_research_private.requests set finished_at=created_at-interval '1 second'",
    "update icash_research_private.requests set account_id=null",
    "update icash_research_private.requests set kind='owner_preview'",
    "update icash_research_private.requests set operation_key='wrong'",
    "update icash_research_private.requests set result='{}'",
    "update icash_research_private.requests set result='{\"outcome\":\"unknown\",\"httpStatus\":200}'",
    "update icash_research_private.owner_batches set state='complete'",
    "update icash_research_private.owner_batches set paid_receipt='{}'",
    "update icash_research_private.owner_exports set receipt='{}'",
    "update icash_research_private.owner_exports set csv='new artifact'",
    "update icash_research_private.owner_exports set recovery='{}'",
    "update icash_research_private.owner_exports set lease_until=now()+interval '1 minute'",
    "update icash_automation_tickets set completed_at=null",
    "update icash_automation_tickets set issue_attempts=null",
    "update icash_automation_tickets set issue_attempts=0",
    "update icash_automation_tickets set issue_attempts=2",
    "update icash_automation_tickets set completed_at=now()",
    "update icash_automation_tickets set state='consumed'",
    "update icash_automation_tickets set outcome='completed'",
    "update icash_automation_tickets set account_id=null",
    "update icash_automation_tickets set screening_id=null",
    "update icash_automation_tickets set expires_at=now()+interval '1 minute'",
]:
    assert sql("begin;" + change + ";select icash_claim_automatic_export_capacity(repeat('a',40));rollback;") == "", change
assert source_snapshot() == original

# Each unknown probe needs original fresh response headers. Stale/invalid data
# and any actual export in either complete active-status list keep capacity held.
def alter_header(key, value):
    def mutate(evidence, probe):
        if probe == "processing":
            evidence["headers"][key] = value
    return mutate


def missing_date(evidence, probe):
    if probe == "inventory":
        del evidence["headers"]["date"]


def pending_export(evidence, probe):
    if probe == "pending":
        evidence["raw"]["data"] = [{"export_id": "active", "status": "pending", "created_at": "2000-01-01T00:00:00Z"}]
        evidence["raw"]["pagination"]["total"] = 1


for mutate in [missing_date, alter_header("date", "invalid"),
               alter_header("date", "Sat, 01 Jan 2000 00:00:00 GMT"),
               alter_header("date", "Tue, 01 Jan 2030 00:00:00 GMT"),
               alter_header("age", "1"), alter_header("age", "bad"), pending_export]:
    setup()
    enable()
    baseline = source_snapshot()
    claim = claim_and_probe(mutate=mutate)
    assert sql(f"select icash_finish_automatic_export_capacity('{claim['reviewId']}');") == "capacity_review_held"
    assert sql("select capacity_review_id is null from icash_research_private.owner_exports;") == "t"
    assert source_snapshot() == baseline
    # A held attempt is immutable; another maintenance turn must observe its
    # existing bounded backoff instead of repeating those same free requests.
    assert sql("select icash_claim_automatic_export_capacity(repeat('a',40));") == ""
    assert sql("select count(*) from icash_research_private.export_capacity_probes;") == "3"

# Source changes committed by another session must be observed before the
# capacity write; finalization cannot race ahead using a pre-update snapshot.
for change in [
    "update icash_research_private.owner_exports set receipt='{\"httpStatus\":200,\"raw\":{\"export_id\":\"late-original\"}}'",
    "update icash_research_private.owner_batches set paid_receipt='{\"export_id\":\"late-original\"}'",
    "update icash_research_private.requests set result='{\"outcome\":\"response\",\"httpStatus\":200}' where kind='owner_lookup'",
    "update icash_automation_tickets set state='consumed'",
]:
    setup()
    enable()
    claim = claim_and_probe()
    writer = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        writer.stdin.write("begin;" + change + ";select 'source_locked';\n")
        writer.stdin.flush()
        assert writer.stdout.readline().strip() == "source_locked"
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, f"select icash_finish_automatic_export_capacity('{claim['reviewId']}');")
            time.sleep(0.15)
            writer.stdin.write("commit;\n\\q\n")
            writer.stdin.flush()
            writer.wait(timeout=5)
            assert writer.returncode == 0, writer.stderr.read()
            assert future.result(timeout=10) == "capacity_review_held", change
        assert sql("select capacity_review_id is null from icash_research_private.owner_exports;") == "t", change
    finally:
        if writer.poll() is None:
            writer.kill()
            writer.wait(timeout=5)

# Competing workers may allocate only one attempt, one request per probe, and
# one capacity binding. Successful idempotent repeats never repeat a paid POST.
setup()
enable()
original = source_snapshot()
claim = claim_and_probe(concurrent=True)
assert sql(f"select auto_policy from icash_research_private.owner_export_capacity_reviews where id='{claim['reviewId']}';") == "unknown-idle-v1"
for change in [
    "update icash_research_private.export_capacity_automation set unknown_enabled=false",
    "update icash_research_private.export_capacity_automation set enabled=false",
    "update icash_research_private.owner_exports set request='{\"people_ids\":[\"changed-owner\"]}'",
    "update icash_automation_tickets set completed_at=completed_at+interval '1 second'",
]:
    assert sql("begin;" + change + f";select icash_finish_automatic_export_capacity('{claim['reviewId']}');rollback;") == "capacity_review_held", change
finished = contend(f"select icash_finish_automatic_export_capacity('{claim['reviewId']}');", 16)
assert "capacity_verified" in finished and set(finished) <= {"capacity_verified", "capacity_review_held"}, finished
assert sql("select icash_owner_active_export_capacity();") == "ready"
assert sql("select icash_owner_export_people_available('[\"held-owner\"]');") == "f"
assert sql("select count(*) from icash_research_private.export_capacity_probes;") == "3"
assert sql("select count(*) from icash_research_private.requests where kind='owner_preview';") == "3"
assert source_snapshot() == original, "Capacity binding must preserve original unknown request, owner fence, handler, batch and money"
assert sql("select terminal_at is null and completed_at is null and receipt is null from icash_research_private.owner_exports;") == "t"
# Late original evidence must be accepted even after unrelated new capacity
# has been admitted. It retains the review and restores the active global fence.
new_batch = "00000000-0000-4000-8000-000000000009"
late_raw = {"error": {"code": "internal_error", "request_id": "req_late_original"}}
late_receipt = {"httpStatus": 500, "raw": late_raw, "rawText": json.dumps(late_raw)}
review_before = sql(f"select capacity_review_id from icash_research_private.owner_exports where id='{BATCH}';")
sql(f"insert into icash_research_private.owner_exports(id,request) values('{new_batch}','{{\"people_ids\":[\"other-owner\"]}}');")
late_writes = contend(f"select icash_record_owner_export_receipt('{ACCOUNT}','{BATCH}',{literal(late_receipt)});", 12)
assert set(late_writes) == {"t"}, late_writes
assert sql(f"select capacity_review_id from icash_research_private.owner_exports where id='{BATCH}';") == review_before
assert sql("select count(*) from icash_research_private.unknown_export_late_holds;") == "1"
sql(f"delete from icash_research_private.owner_exports where id='{new_batch}';")
assert sql("select icash_owner_active_export_capacity();") == "export_busy"
assert sql(f"select icash_owner_active_export_capacity('{ACCOUNT}');") == "export_busy"
assert sql(f"select count(*) from icash_owner_export_findings() where resource_id='{BATCH}';") == "1"
assert sql("select state from icash_operation_spend;") == "dispatched"

# The separately callable batch writer must establish the same fence. A later
# correlated terminal export receipt makes that latch inactive without erasing
# its evidence or settling the original money/owner purchase.
setup()
enable()
claim = claim_and_probe()
assert sql(f"select icash_finish_automatic_export_capacity('{claim['reviewId']}');") == "capacity_verified"
terminal_raw = {"export_id": "late_original", "record_count": 1, "file_count": 1}
terminal_receipt = {"httpStatus": 200, "raw": terminal_raw, "rawText": json.dumps(terminal_raw)}
batch_writes = contend(f"select icash_record_owner_batch_receipt('{ACCOUNT}','{BATCH}',{literal(terminal_raw)});", 12)
assert set(batch_writes) == {"t"}, batch_writes
assert sql("select icash_owner_active_export_capacity();") == "export_busy"
assert sql(f"select receipt is null from icash_research_private.owner_exports where id='{BATCH}';") == "t"
assert sql(f"select icash_record_owner_export_receipt('{ACCOUNT}','{BATCH}',{literal(terminal_receipt)});") == "t"
assert sql("select icash_owner_active_export_capacity();") == "ready"
assert sql("select count(*) from icash_research_private.unknown_export_late_holds;") == "1"
assert sql("select state from icash_operation_spend;") == "dispatched"

# Exercise the actual recorder/admission entry points in distinct transactions.
# Before the late write, these source-valid fixture arguments reach normal
# admission. While its uncommitted latch is invisible, the recorder's original
# organization lock alone must keep every competing admission out. After commit
# the durable latch must continue the exclusion without relying on that lock.
new_items = [{"screeningId": SCREENING, "ids": ["per_999"], "snapshot": {"propertyId": "property_999"}}]
new_preview = {"data": [{"dm_property_id": "property_999", "found": True, "contacts": [
    {"dm_person_id": "per_999", "contact_type": "owner", "is_likely_owner": True, "availability": {"phones": 1}}]}]}
new_request = {"people_ids": ["per_999"], "fields": ["person_full_name", "has_active_phone_number"],
               "property_match": "owner", "anchor": "person", "limit": 1,
               "require_phone": True, "scrub_dnc": True, "active_phones_only": True}
admission_query = (f"select icash_admit_owner_active_export('{ACCOUNT}','{SCREENING}','{new_batch}',"
                   + f"{literal(new_items)},{literal(new_preview)},'{{}}'::jsonb,{literal(new_request)});")
for recorder in [
    f"select icash_record_owner_export_receipt('{ACCOUNT}','{BATCH}',{literal(late_receipt)});",
    f"select icash_record_owner_batch_receipt('{ACCOUNT}','{BATCH}',{literal(late_raw)});",
]:
    setup()
    enable()
    claim = claim_and_probe()
    assert sql(f"select icash_finish_automatic_export_capacity('{claim['reviewId']}');") == "capacity_verified"
    assert sql("begin;" + admission_query + "rollback;") == "claimed", "Fixture must reach the real admission lock, not an earlier source refusal"
    assert sql(f"select count(*) from icash_research_private.owner_exports where id='{new_batch}';") == "0"
    writer = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        writer.stdin.write("begin;" + recorder + "select 'late_receipt_saved';\n")
        writer.stdin.flush()
        assert writer.stdout.readline().strip() == "t"
        assert writer.stdout.readline().strip() == "late_receipt_saved"
        assert sql("select pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));") == "f", "Actual recorder must hold the shared organization lock through commit"
        assert sql("select count(*) from icash_research_private.unknown_export_late_holds;") == "0", "Late latch must still be uncommitted in the competing session"
        blocked = contend(admission_query, 12)
        assert set(blocked) == {"export_busy"}, (recorder, blocked)
        writer.stdin.write("commit;\n\\q\n")
        writer.stdin.flush()
        writer.wait(timeout=5)
        assert writer.returncode == 0, writer.stderr.read()
    finally:
        if writer.poll() is None:
            writer.kill()
            writer.wait(timeout=5)
    assert sql("select count(*) from icash_research_private.unknown_export_late_holds;") == "1"
    assert sql("select pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));") == "t", "The recorder lock must be released at commit"
    blocked = contend(admission_query, 12)
    assert set(blocked) == {"export_busy"}, (recorder, blocked)
    assert sql(f"select count(*) from icash_research_private.owner_exports where id='{new_batch}';") == "0"
    assert sql("select state from icash_operation_spend;") == "dispatched"

# The new fingerprint and immutable snapshot column retain all prior source
# families, including the original post-incident inventory rule for500/504.
for status, expected in [(500, "idle-v1"), (504, "gateway-idle-v1"), (400, "empty-idle-v1")]:
    setup()
    enable()
    raw = {"error": {"code": "internal_error", "request_id": "req_fixture"}}
    if status == 400:
        raw = {"error": {"code": "invalid_request", "request_id": "req_fixture", "message": 'No records matched this export. Filters and scrub settings (like "Active phone numbers only") may have excluded every record — adjust them and try again.'}}
    evidence = {"httpStatus": status, "raw": raw, "rawText": json.dumps(raw)} if status != 504 else {"httpStatus": 504, "raw": None, "rawText": "dealmachine.com | 504: Gateway time-out api.v2.dealmachine.com"}
    paid = literal(raw) if status == 400 else "null"
    sql(f"update icash_research_private.owner_exports set receipt={literal(evidence)};"
        + f"update icash_research_private.owner_batches set paid_receipt={paid};"
        + f"update icash_research_private.requests set result='{{\"outcome\":\"http_error\",\"httpStatus\":{status}}}' where id='{BATCH}';")
    baseline = source_snapshot()
    claim = claim_and_probe()
    assert sql(f"select auto_policy from icash_research_private.owner_export_capacity_reviews where id='{claim['reviewId']}';") == expected
    assert sql(f"select source_snapshot is null from icash_research_private.owner_export_capacity_reviews where id='{claim['reviewId']}';") == "t"
    outcome = sql(f"select icash_finish_automatic_export_capacity('{claim['reviewId']}');")
    assert outcome == ("capacity_verified" if status == 400 else "capacity_review_held"), (status, outcome)
    assert source_snapshot() == baseline

print("PASS native unknown export recovery: staged default, strict original handler/request binding, late-source races, competing free probes/finalization, original owner and money holds preserved.")
