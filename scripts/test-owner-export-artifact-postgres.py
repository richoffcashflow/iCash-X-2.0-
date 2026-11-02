"""Native competing local-artifact leases; disposable localhost, no providers."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]


def sql(query, failure=False):
    r = subprocess.run(CMD, input="set statement_timeout='8s';\n"+query, env=ENV, text=True, capture_output=True, timeout=15)
    if failure:
        assert r.returncode and "immutable" in r.stderr, r.stderr
    elif r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


def literal(value):
    return "'"+str(value).replace("'", "''")+"'"


def js(value):
    return literal(json.dumps(value))+"::jsonb"


def contend(query):
    with ThreadPoolExecutor(max_workers=12) as pool:
        return list(pool.map(lambda _: sql(query), range(24)))


assert sql("select current_database();") == "icash_reliability"
sql("drop schema if exists icash_research_private cascade; drop schema public cascade; create schema public;")
sql("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;")
for file in ["tests/fixtures/owner-export-artifact-before.sql", "config/owner-export-cached-artifact-recovery.sql"]:
    sql((ROOT/file).read_text())

batch, account = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
raw = {"export_id": "original-fixture", "record_count": 1, "file_count": 1, "credits": {"used": 1, "people": 1}}
original = {"receipt": {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw)},
            "recovery": {"httpStatus": 200, "raw": {"data": {**raw, "status": "completed"}}},
            "csv": "internal_person_id,person_full_name\n9007199254740993123,\n",
            "terminal": "clock_timestamp()-interval '1 hour'", "attempts": 6}
original["hash"] = hashlib.sha256(original["csv"].encode()).hexdigest()


def insert(e):
    return f"""insert into icash_research_private.owner_batches(id,account_id,items,preview_receipt,paid_receipt)
      values('{batch}','{account}','[]','{{}}',{js(e.get('paid', raw))});
    insert into icash_research_private.owner_exports(id,request,receipt,recovery,csv,artifact_sha256,terminal_at,recovery_attempts,next_recover_at,lease_until,completed_at)
      values('{batch}','{{"people_ids":["per_9007199254740993123"]}}',{js(e['receipt'])},{js(e['recovery'])},
      {literal(e['csv']) if e['csv'] is not None else 'null'},{literal(e['hash'])},{e['terminal']},{e['attempts']},
      {e.get('due', "clock_timestamp()-interval '1 hour'")},{e.get('lease', 'null')},{e.get('completed', 'null')});"""


claim = f"select public.icash_claim_owner_export_recovery('{batch}');"
# Every rejected candidate must stay untouched and must not consume any retry.
cases = [
    ("missing artifact", lambda e: e.update(csv=None)),
    ("empty artifact", lambda e: e.update(csv="", hash=hashlib.sha256(b"").hexdigest())),
    ("artifact digest mismatch", lambda e: e.update(hash="0"*64)),
    ("oversize artifact", lambda e: e.update(csv="x"*1048577, hash=hashlib.sha256(b"x"*1048577).hexdigest())),
    ("original HTTP error", lambda e: e["receipt"].update(httpStatus=500)),
    ("canonical HTTP error", lambda e: e["recovery"].update(httpStatus=500)),
    ("different original export", lambda e: e["recovery"]["raw"]["data"].update(export_id="another-export")),
    ("unfinished canonical export", lambda e: e["recovery"]["raw"]["data"].update(status="processing")),
    ("canonical count mismatch", lambda e: e["recovery"]["raw"]["data"].update(record_count=2)),
    ("missing terminal evidence", lambda e: e.update(terminal="null")),
    ("unbound batch receipt", lambda e: e.update(paid={**raw, "export_id": "another-export"})),
    ("future backoff", lambda e: e.update(due="clock_timestamp()+interval '1 hour'")),
    ("live lease", lambda e: e.update(lease="clock_timestamp()+interval '1 hour'")),
    ("already completed", lambda e: e.update(completed="clock_timestamp()")),
]
for name, mutate in cases:
    case = deepcopy(original)
    mutate(case)
    result = sql("begin;update icash_research_private.owner_export_settings set cached_artifact_recovery_enabled=true;"+insert(case)+claim+
                 "select recovery_attempts||':'||cached_artifact_attempts from icash_research_private.owner_exports;rollback;")
    assert result == "6:0", (name, result)

# Existing recovery stays available below its original limit while rollout is
# disabled. Its future leases/backoff continue to prevent admission.
ordinary = deepcopy(original)
ordinary["attempts"] = 5
normal_claim = sql("begin;"+insert(ordinary)+claim+"rollback;")
assert json.loads(normal_claim)["localOnly"] is False
for field in ["lease", "due"]:
    future = deepcopy(ordinary)
    future[field] = "clock_timestamp()+interval '1 hour'"
    assert not sql("begin;"+insert(future)+claim+"rollback;"), field

sql(insert(original))
evidence = sql("select jsonb_build_object('receipt',receipt,'request',request,'recovery',recovery,'history',recovery_history,'csv',csv,'hash',artifact_sha256,'terminal',terminal_at) from icash_research_private.owner_exports;")
assert not any(contend(claim)), "Disabled rollout must not release exhausted artifacts"
assert sql("select recovery_attempts||':'||cached_artifact_attempts from icash_research_private.owner_exports;") == "6:0"
sql("update icash_research_private.owner_export_settings set cached_artifact_recovery_enabled=true;")
leases = []
for attempt in range(1, 4):
    # Holding the claiming transaction briefly exercises SKIP LOCKED as well
    # as the persisted lease observed by subsequent competing sessions.
    claims = [json.loads(r) for r in contend("begin;"+claim+"select pg_sleep(0.03);commit;") if r]
    assert len(claims) == 1, claims
    c = claims[0]
    assert c["localOnly"] is True and c["artifactSha256"] == original["hash"]
    assert c["receipt"] == original["receipt"] and c["csv"] == original["csv"]
    assert c["recoveryHttpStatus"] == 200 and c["recovery"] == original["recovery"]["raw"]
    assert c["accountId"] == account and c["id"] == batch
    leases.append(c["lease"])
    assert sql("select recovery_attempts||':'||cached_artifact_attempts from icash_research_private.owner_exports;") == f"6:{attempt}"
    assert not sql(claim), "Lease/backoff must remain exclusive"
    sql("update icash_research_private.owner_exports set lease_until=clock_timestamp()-interval '1 second',next_recover_at=clock_timestamp()-interval '1 second';")
assert len(set(leases)) == 3
assert not any(contend(claim)), "Three local attempts exhaust independently of provider attempts"
sql("update icash_research_private.owner_exports set cached_artifact_attempts=0;", failure=True)
sql("update icash_research_private.owner_exports set recovery_attempts=0;", failure=True)
sql("update icash_research_private.owner_exports set csv='replacement';", failure=True)
assert evidence == sql("select jsonb_build_object('receipt',receipt,'request',request,'recovery',recovery,'history',recovery_history,'csv',csv,'hash',artifact_sha256,'terminal',terminal_at) from icash_research_private.owner_exports;")
assert sql("select count(*) from icash_research_private.owner_exports where completed_at is not null;") == "0", "Claiming is not settlement"
for role in ["anon", "authenticated"]:
    assert sql(f"select has_function_privilege('{role}','public.icash_claim_owner_export_recovery(uuid)','execute');") == "f"
assert sql("select has_table_privilege('service_role','icash_research_private.owner_exports','select');") == "f"
print("PASS native original-artifact recovery: disabled rollout, ordinary recovery preserved, 14 rejected evidence/lease cases, competing workers claim one lease, three bounded local attempts, immutable original receipt/CSV/provider counters and private ACLs.")
