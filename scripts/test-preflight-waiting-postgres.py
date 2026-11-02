"""Native cleanup/count contention on disposable localhost; no provider calls."""
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


def uid(n):
    return f"00000000-0000-4000-8000-{n:012d}"


def seed(n, age=6, state="waiting"):
    a, p = uid(n), uid(n+1)
    items = [{"screeningId": uid(i), "snapshot": {"propertyId": "prop_"+str(i), "propertyType": "house", "raw": {"data": {"state": "TX"}}}, "ids": ["per_"+str(i)]} for i in (n+2, n+3)]
    request = {"people_ids": [x["ids"][0] for x in items], "property_match": "owner", "anchor": "person", "require_phone": True, "scrub_dnc": True, "active_phones_only": True}
    raw = {"data": {"list_id": "list-"+str(n), "name": "list-"+str(n), "source_type": "people", "status": "completed", "total_count": 2}}
    receipts = {"create": {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw)}}
    sql(f"insert into icash_accounts(id) values('{a}');insert into icash_discovery_configs(account_id,contact_rate_id) values('{a}','{uid(99)}');insert into icash_wallets(account_id) values('{a}');")
    for item in items:
        sql(f"insert into icash_screening_jobs(id,account_id,state,snapshot) values('{item['screeningId']}','{a}','complete',{literal(item['snapshot'])});")
    sql(f"""insert into icash_research_private.owner_export_preflights(id,account_id,fingerprint,items,request,state,list_name,list_id,receipts,created_at,started_at,next_check_at)
values('{p}','{a}',md5(jsonb_build_array({literal(items)},{literal(request)})::text),{literal(items)},{literal(request)},'{state}','list-{n}',{literal('list-'+str(n))},{literal(receipts)},now()-interval '{age} minutes',now()-interval '{age} minutes',now()-interval '1 minute');""")
    for item in items:
        sql(f"insert into icash_research_private.owner_export_preflight_items values('{p}','{a}','{item['screeningId']}',md5({literal(item['snapshot'])}::text));")
    return a, p, items, request


assert sql("select current_database();") == "icash_reliability"
sql("drop schema if exists icash_research_private cascade;drop schema public cascade;create schema public;")
foundation = re.sub(r"create role (anon|authenticated|service_role);", "", (ROOT / "tests/fixtures/owner-preflight-foundation.sql").read_text())
sql(foundation)
sql((ROOT / "tests/fixtures/owner-preflight-cohorts.sql").read_text())
source = (ROOT / "config/research-request-efficiency.sql").read_text()
candidate = source[source.index("create function public.icash_owner_batch_candidates("):source.index("create function public.icash_claim_owner_batch(")]
sql(candidate.replace("create function", "create or replace function", 1))
for name in ("owner-export-preflight", "owner-export-preflight-indexing", "owner-export-preflight-cohorts"):
    sql((ROOT / f"config/{name}.sql").read_text())
sql(f"insert into icash_operation_rates(id) values('{uid(99)}');update icash_research_private.owner_export_settings set preflight_enabled=true;")
a, p, items, request = seed(2000)
cleanup = f"select icash_claim_owner_preflight_cleanup('{p}');"
assert json.loads(sql("begin;"+cleanup+"rollback;"))["id"] == p
assert sql(f"select icash_research_private.owner_preflight_cohort('{a}','{items[0]['screeningId']}') is null;") == "t"
sql((ROOT / "config/owner-preflight-waiting-lifetime.sql").read_text())
retry_a, retry_p, retry_items, retry_request = seed(6000)
sql(f"update icash_research_private.owner_export_preflights set cleanup_attempts=1,cleanup_until=now()-interval '1 minute' where id='{retry_p}';")
assert not sql(f"select icash_claim_owner_preflight_cleanup('{retry_p}');")
sql((ROOT / "config/owner-preflight-cleanup-retry.sql").read_text())
with ThreadPoolExecutor(max_workers=12) as pool:
    retries = list(pool.map(lambda _: sql(f"select icash_claim_owner_preflight_cleanup('{retry_p}');"), range(24)))
assert sum(bool(x) for x in retries) == 1, retries
assert sql(f"select cleanup_attempts from icash_research_private.owner_export_preflights where id='{retry_p}';") == "2"
sql(f"update icash_research_private.owner_export_preflights set cleanup_attempts=3,cleanup_until=now()-interval '1 minute' where id='{retry_p}';")
assert not sql(f"select icash_claim_owner_preflight_cleanup('{retry_p}');")
claim = f"select icash_claim_owner_preflight('{a}',{literal(items)},{literal(request)});"
with ThreadPoolExecutor(max_workers=16) as pool:
    results = list(pool.map(lambda n: (n % 2, sql(claim if n % 2 else cleanup)), range(32)))
assert all(not result for lane, result in results if lane == 0), results
checks = [json.loads(result) for lane, result in results if lane == 1]
assert sum(c["status"] == "check" for c in checks) == 1, checks
assert all(c["status"] in ("check", "pending") for c in checks), checks
assert sql(f"select cleanup_attempts from icash_research_private.owner_export_preflights where id='{p}';") == "0"
assert json.loads(sql(f"select icash_research_private.owner_preflight_cohort('{a}','{items[0]['screeningId']}');")) == items
check = next(c for c in checks if c["status"] == "check")
for step, count in (("baseline", 2), ("eligible", 1)):
    raw = {"total_people": count, "total_results": count, "total_properties": count}
    receipt = {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw)}
    assert sql(f"select icash_record_owner_preflight('{p}','{check['lease']}','{step}',{literal(receipt)});") == ("checking" if step == "baseline" else "ready")
with ThreadPoolExecutor(max_workers=12) as pool:
    cleanup_results = list(pool.map(lambda _: sql(cleanup), range(24)))
assert sum(bool(x) for x in cleanup_results) == 1, cleanup_results

# The waiting exception never becomes an unbounded lease or applies to a stuck
# count handler. Expired lists still have exactly one normal cleanup capability.
for n, age, state in ((3000, 31, "waiting"), (4000, 6, "checking"), (5000, 6, "creating")):
    a2, p2, items2, request2 = seed(n, age, state)
    with ThreadPoolExecutor(max_workers=12) as pool:
        cleanup_results = list(pool.map(lambda _: sql(f"select icash_claim_owner_preflight_cleanup('{p2}');"), range(24)))
    assert sum(bool(x) for x in cleanup_results) == 1, (state, cleanup_results)
    assert sql(f"select icash_research_private.owner_preflight_cohort('{a2}','{items2[0]['screeningId']}') is null;") == "t"
assert sql("select count(*) from fixture_purchases;") == "0"
print("PASS native waiting checks: 32 competing count/cleanup workers preserve one due list, one count claim and terminal cleanup; 30-minute expiry and original handler bounds remain enforced, with no paid work.")
