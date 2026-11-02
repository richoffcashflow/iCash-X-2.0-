"""Multiple real sessions, fixed disposable localhost PostgreSQL; no providers."""
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


account, other = uid(1), uid(2)
items = [{"screeningId": uid(3), "snapshot": {"propertyId": "prop_3"}, "ids": ["per_3"]}]
request = {"people_ids": ["per_3"], "fields": ["person_full_name", "has_active_phone_number"], "property_match": "owner", "anchor": "person", "limit": 1, "require_phone": True, "scrub_dnc": True, "active_phones_only": True}
claim = f"select icash_claim_owner_preflight('{account}',{literal(items)},{literal(request)});"
assert sql("select current_database();") == "icash_reliability"
sql("drop schema if exists icash_research_private cascade; drop schema public cascade; create schema public;")
foundation = (ROOT / "tests/fixtures/owner-preflight-foundation.sql").read_text()
foundation = re.sub(r"create role (anon|authenticated|service_role);", "", foundation)
sql(foundation)
sql((ROOT / "config/owner-export-preflight.sql").read_text())
sql((ROOT / "config/owner-export-preflight-indexing.sql").read_text())
sql(f"insert into icash_accounts(id) values('{account}'),('{other}');insert into icash_screening_jobs values('{uid(3)}','{account}','complete',{literal(items[0]['snapshot'])});update icash_research_private.owner_export_settings set preflight_enabled=true;")
with ThreadPoolExecutor(max_workers=12) as pool:
    claims = list(pool.map(lambda _: json.loads(sql(claim)), range(24)))
created = [c for c in claims if c["status"] == "create"]
assert len(created) == 1 and all(c["status"] in ("create", "pending") for c in claims), claims
c = created[0]
assert sql("select count(*) from icash_research_private.owner_export_preflights;") == "1"


def record(c, step, raw):
    receipt = {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw)}
    return f"select icash_record_owner_preflight('{c['id']}','{c['lease']}','{step}',{literal(receipt)});"


creation = record(c, "create", {"data": {"list_id": "fixture-list", "name": c["name"], "source_type": "people", "status": "completed", "total_count": 1}})
with ThreadPoolExecutor(max_workers=8) as pool:
    receipts = list(pool.map(lambda _: sql(creation), range(16)))
assert set(receipts) == {"pending"}, receipts
assert sql("select next_check_at>=started_at+interval '90 seconds' from icash_research_private.owner_export_preflights;") == "t"
assert sql("select jsonb_object_length from (select count(*) jsonb_object_length from icash_research_private.owner_export_preflights p,jsonb_object_keys(p.receipts)) q;") == "1"
assert json.loads(sql(claim))["status"] == "pending"
sql("update icash_research_private.owner_export_preflights set next_check_at=now()-interval '1 second';")
with ThreadPoolExecutor(max_workers=12) as pool:
    claims = list(pool.map(lambda _: json.loads(sql(claim)), range(24)))
checks = [v for v in claims if v["status"] == "check"]
assert len(checks) == 1 and all(c["status"] in ("check", "pending") for c in claims), claims
c = checks[0]
assert sql(record(c, "baseline", {"total_people": 1, "total_results": 1, "total_properties": 1})) == "checking"
assert sql(record(c, "eligible", {"total_people": 0, "total_results": 0, "total_properties": 0})) == "empty"
with ThreadPoolExecutor(max_workers=12) as pool:
    cleanup = list(pool.map(lambda _: sql("select icash_claim_owner_preflight_cleanup();"), range(24)))
assert sum(bool(x) for x in cleanup) == 1, cleanup
assert sql("select count(*) from fixture_purchases;") == "0"
assert sql(f"select icash_pending_opportunity_count('{account}');") == "0"
print("PASS native PostgreSQL: 24 competing workers create one list, 16 identical receipts persist once, one delayed count claim and one cleanup claim; no purchase or lost empty exclusion.")

# Use the real candidate selector with isolated dependencies to reproduce
# overlapping batches, instead of assuming serial single-cohort callers.
sql((ROOT / "tests/fixtures/owner-preflight-cohorts.sql").read_text())
source = (ROOT / "config/research-request-efficiency.sql").read_text()
candidate = source[source.index("create function public.icash_owner_batch_candidates("):source.index("create function public.icash_claim_owner_batch(")]
candidate = candidate.replace("create function", "create or replace function", 1)
candidate = candidate.replace("where s.account_id=p_account", "where s.account_id=p_account and not public.icash_owner_preflight_empty(s.account_id,s.id,s.snapshot)")
sql(candidate)
sql((ROOT / "config/owner-export-preflight-cohorts.sql").read_text())
sql(f"insert into icash_operation_rates(id) values('{uid(99)}');insert into icash_discovery_configs(account_id,contact_rate_id) values('{account}','{uid(99)}');insert into icash_wallets(account_id) values('{account}');")
cohort_items = [{"screeningId": uid(n), "snapshot": {"propertyId": "prop_"+str(n), "propertyType": "house", "raw": {"data": {"state": "TX"}}}, "ids": ["per_"+str(n)]} for n in (300, 301, 302)]
for item in cohort_items:
    sql(f"insert into icash_screening_jobs(id,account_id,state,snapshot) values('{item['screeningId']}','{account}','complete',{literal(item['snapshot'])});")
cohorts = [[cohort_items[0], cohort_items[1]], [cohort_items[0], cohort_items[2]], [cohort_items[1], cohort_items[2]]]
queries = []
for cohort in cohorts:
    body = {**request, "people_ids": [x["ids"][0] for x in cohort], "limit": 2}
    queries.append(f"select icash_claim_owner_preflight('{account}',{literal(cohort)},{literal(body)});")
with ThreadPoolExecutor(max_workers=12) as pool:
    raced = list(pool.map(lambda n: json.loads(sql(queries[n % 3])), range(36)))
assert sum(r["status"] == "create" for r in raced) == 1, raced
assert all(r["status"] in ("create", "pending", "quota_wait") for r in raced), raced
assert sql("select count(*) from icash_research_private.owner_export_preflights where state='creating';") == "1"
winner = json.loads(sql("select items from icash_research_private.owner_export_preflights where state='creating';"))
leader = winner[0]["screeningId"]
pinned = json.loads(sql(f"select icash_owner_batch_candidates('{account}','{leader}');"))
assert [x["screeningId"] for x in pinned] == [x["screeningId"] for x in winner], pinned
assert sql("select count(*) from fixture_purchases;") == "0"
print("PASS native PostgreSQL: 36 competing overlapping cohorts create one list and retain its exact original batch without a paid admission.")

# Reproduce the ticket issuer's budget lock and the actual selection predicate.
# Either the free cohort wins or the sibling ticket wins, never both.
for trial in range(6):
    pair = [{"screeningId": uid(n), "snapshot": {"propertyId": "prop_"+str(n), "propertyType": "house", "raw": {"data": {"state": "TX"}}}, "ids": ["per_"+str(n)]} for n in (400+trial*2, 401+trial*2)]
    for item in pair:
        sql(f"insert into icash_screening_jobs(id,account_id,state,snapshot) values('{item['screeningId']}','{account}','complete',{literal(item['snapshot'])});")
    body = {**request, "people_ids": [x["ids"][0] for x in pair], "limit": 2}
    free_claim = f"select icash_claim_owner_preflight('{account}',{literal(pair)},{literal(body)});"
    sibling = pair[1]
    issue_ticket = f"begin;select id from icash_operating_budget where id=1 for update;select pg_sleep(0.03);insert into icash_automation_tickets select '{sibling['screeningId']}'::uuid where not public.icash_owner_preflight_sibling_waiting('{account}','{sibling['screeningId']}',{literal(sibling['snapshot'])},'{sibling['screeningId']}');commit;"
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(sql, x) for x in ([free_claim, issue_ticket] if trial % 2 else [issue_ticket, free_claim])]
        for future in futures:
            future.result()
    free = int(sql(f"select count(*) from icash_research_private.owner_export_preflights where items->0->>'screeningId'='{pair[0]['screeningId']}';"))
    ticket = int(sql(f"select count(*) from icash_automation_tickets where screening_id='{sibling['screeningId']}';"))
    assert free + ticket == 1, (trial, free, ticket)
print("PASS native PostgreSQL: competing ticket issuance and free-list creation cannot claim the same sibling.")
