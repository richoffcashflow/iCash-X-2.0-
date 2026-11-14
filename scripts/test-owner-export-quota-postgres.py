"""Native original-export quota accounting, isolated localhost; no provider HTTP."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
PORT = os.environ.get("ICASH_TEST_POSTGRES_PORT", "55443")
assert PORT.isdigit() and 1024 < int(PORT) < 65536
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", "icash_reliability"]


def sql(query, error=None):
    result = subprocess.run(CMD, input="set statement_timeout='8s';\n"+query, env=ENV, text=True, capture_output=True, timeout=15)
    if error:
        assert result.returncode and error in result.stderr, result.stderr
    else:
        assert not result.returncode, result.stderr
    return result.stdout.strip()


def literal(value):
    return "'"+str(value).replace("'", "''")+"'"


def js(value):
    return literal(json.dumps(value))+"::jsonb"


def contend(query):
    with ThreadPoolExecutor(max_workers=24) as pool:
        return list(pool.map(lambda _: sql(query), range(24)))


def claim(batch, ordinary=False):
    function = "icash_claim_owner_export_recovery" if ordinary else "icash_claim_owner_export_quota_recovery"
    return f"select public.{function}('{batch}');"


def due(batch):
    return f"update icash_research_private.owner_exports set lease_until=clock_timestamp()-interval '1 second',next_recover_at=clock_timestamp()-interval '1 second' where id='{batch}';"


account = "00000000-0000-4000-8000-000000000001"
batch = "00000000-0000-4000-8000-000000000002"
raw = {"export_id": "original-fixture", "record_count": 1, "file_count": 1, "credits": {"used": 1, "people": 1}}
receipt = {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw)}
base = {"attempts": 6, "count": 6, "receipt": receipt, "paid": raw, "state": "claimed", "results": "null", "created": "clock_timestamp()-interval '1 hour'", "terminal": "clock_timestamp()-interval '50 minutes'", "csv": "null", "recovery": "null", "history": "'[]'", "due": "clock_timestamp()-interval '1 hour'", "lease": "null"}


def insert(batch_id, fixture=None):
    e = deepcopy(base if fixture is None else fixture)
    return f"""insert into icash_research_private.owner_batches(id,account_id,primary_screening,created_at,state,items,preview_receipt,paid_receipt,results)
      values('{batch_id}','{account}','00000000-0000-4000-8000-000000000003',{e['created']},{literal(e['state'])},'[]','{{}}',{js(e['paid'])},{e['results']});
    insert into icash_research_private.owner_exports(id,request,receipt,recovery,recovery_history,csv,terminal_at,recovery_attempts,next_recover_at,lease_until)
      values('{batch_id}','{{"people_ids":["per_9007199254740993123"]}}',{js(e['receipt'])},{e['recovery']},{e['history']},{e['csv']},{e['terminal']},{e['attempts']},{e['due']},{e['lease']});
    insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result)
      select gen_random_uuid(),'owner_preview','{account}','owner-export-recovery:{batch_id}',false,'{{"outcome":"quota_wait"}}' from generate_series(1,{e['count']});"""


def evidence(batch_id):
    return f"""select jsonb_build_object('request',e.request,'receipt',e.receipt,'terminal',e.terminal_at,'attempts',e.recovery_attempts,
      'batch',to_jsonb(b),'requests',(select jsonb_agg(to_jsonb(r) order by r.id) from icash_research_private.requests r where r.operation_key='owner-export-recovery:'||e.id))
      from icash_research_private.owner_exports e join icash_research_private.owner_batches b on b.id=e.id where e.id='{batch_id}';"""


def finish(c, status=503, outcome="http_error"):
    return f"select public.icash_finish_dealmachine_request('{c['quotaRequestId']}',{js({'outcome': outcome, 'httpStatus': status})});"


def record(c, status=503, export_id=None):
    body = {"httpStatus": status, "raw": {"data": {"export_id": export_id or raw['export_id'], "status": "completed" if status == 200 else "processing", "record_count": 1}}, "rawText": "fixture-only"}
    return f"select public.icash_record_owner_export_quota_recovery('{c['id']}','{c['lease']}','{c['quotaRequestId']}',{js(body)});"


assert sql("select current_database();") == "icash_reliability"
sql("drop schema if exists icash_research_private cascade;drop schema public cascade;create schema public;")
sql("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;")
sql((ROOT/"tests/fixtures/owner-export-quota-before.sql").read_text())

# Reproduce the actual predecessor defect: six claims, six explicit quota
# refusals, zero admitted provider requests, then permanent ordinary exhaustion.
original = deepcopy(base)
original.update(attempts=0, count=0)
sql(insert(batch, original)+"update public.native_fixture_quota set available=false;")
for attempt in range(1, 7):
    c = json.loads(sql(claim(batch, ordinary=True)))
    assert not c.get("atomicRecovery")
    request_id = str(uuid4())
    assert sql(f"select public.icash_take_dealmachine_request('owner_preview','{account}','owner-export-recovery:{batch}','{request_id}');") == "f"
    assert sql(f"select recovery_attempts from icash_research_private.owner_exports where id='{batch}';") == str(attempt)
    sql(due(batch))
assert not sql(claim(batch, ordinary=True))
assert sql("select count(*) filter(where admitted)||':'||count(*) from icash_research_private.requests;") == "0:6"
original_evidence = sql(evidence(batch))

migration = (ROOT/"config/owner-export-quota-continuation.sql").read_text()
predecessor_hashes = "select jsonb_build_object('claim',md5(pg_get_functiondef('public.icash_claim_owner_export_recovery(uuid)'::regprocedure)),'prune',md5(pg_get_functiondef('public.icash_prune_research_requests()'::regprocedure)));"
before_hashes = sql(predecessor_hashes)
# Hosted migration execution owns the DDL+ledger transaction. A late ledger
# failure must roll back every new relation and function replacement together.
sql("begin;\n"+migration+"\ndo $$begin raise exception 'simulated migration ledger failure';end$$;\ncommit;", error="simulated migration ledger failure")
assert sql(predecessor_hashes) == before_hashes
assert sql("select to_regclass('icash_research_private.owner_export_quota_policy') is null and to_regclass('icash_research_private.owner_export_quota_continuations') is null and to_regclass('icash_research_private.owner_export_quota_requests') is null and to_regclass('icash_research_private.owner_export_quota_request_source') is null and to_regprocedure('public.icash_claim_owner_export_quota_recovery(uuid)') is null;") == "t"
sql("begin;\n"+migration+"\ncommit;")
assert not any(contend(claim(batch)))
assert sql(evidence(batch)) == original_evidence
assert sql("select enabled from icash_research_private.owner_export_quota_policy;") == "f"
# A disabled rollout retains the previous ordinary handler contract.
ordinary_batch = "00000000-0000-4000-8000-000000000004"
ordinary_disabled = sql("begin;"+insert(ordinary_batch, original)+claim(ordinary_batch, True)+"rollback;")
assert not json.loads(ordinary_disabled).get("atomicRecovery")
release = "a"*40
activation = f"select icash_research_private.activate_owner_export_quota_recovery('{release}');"
assert sql("select icash_research_private.activate_owner_export_quota_recovery('bad-release');") == "f"
assert sql("begin;alter function public.icash_finish_dealmachine_request(uuid,jsonb) set statement_timeout='1s';"+activation+"rollback;") == "f"
for changed_hashes in ["'{}'::jsonb", "function_hashes-'icash_research_private.guard_owner_export()'", "function_hashes||jsonb_build_object('icash_research_private.guard_owner_export()',null)", "function_hashes||jsonb_build_object('icash_research_private.guard_owner_export()','malformed')"]:
    assert sql("begin;update icash_research_private.owner_export_quota_policy set function_hashes="+changed_hashes+";"+activation+"rollback;") == "f"
# Activation waits for legacy provider handlers to relinquish their leases.
assert sql("begin;"+insert(ordinary_batch, original)+claim(ordinary_batch, True)+activation+"rollback;").splitlines()[-1] == "f"
assert sql("begin;"+insert(ordinary_batch, original)+claim(ordinary_batch, True)+due(ordinary_batch)+activation+"rollback;").splitlines()[-1] == "t"
assert sql(activation) == "t"
assert sql(activation) == "t"
assert sql("select icash_research_private.activate_owner_export_quota_recovery('"+"b"*40+"');") == "f"

# A denial enrolls immutable proof, retains the refusal and defers. It never
# consumes a provider ordinal or changes the original provider attempt counter.
assert not any(contend(claim(batch)))
assert sql("select count(*) filter(where phase='original')||':'||count(*) filter(where phase='continuation')||':'||count(ordinal) from icash_research_private.owner_export_quota_requests;") == "6:1:0"
assert sql(evidence(batch)) == original_evidence
assert sql("select minute_used||':'||day_used from public.icash_dealmachine_request_budget;") == "0:0"
assert sql(f"select public.icash_take_dealmachine_request('owner_preview','{account}','owner-export-recovery:{batch}',(select request_id from icash_research_private.owner_export_quota_requests where phase='original' limit 1));") == "f"
assert sql("select public.icash_finish_dealmachine_request((select request_id from icash_research_private.owner_export_quota_requests where phase='original' limit 1),'{\"outcome\":\"response\",\"httpStatus\":200}');") == "f"
assert sql(evidence(batch)) == original_evidence

# Near misses cannot turn absent provider evidence into a recovery allowance.
case_batch = "00000000-0000-4000-8000-000000000005"
cases = [
    ("five refusals", lambda e: e.update(count=5), ""),
    ("seven requests", lambda e: e.update(count=7), ""),
    ("wrong historical counter", lambda e: e.update(attempts=5), ""),
    ("old source past retention margin", lambda e: e.update(created="clock_timestamp()-interval '30 days'", terminal="clock_timestamp()-interval '29 days'"), ""),
    ("future source", lambda e: e.update(created="clock_timestamp()+interval '1 hour'"), ""),
    ("wrong primary receipt", lambda e: e.update(paid={**raw, "export_id": "another-original"}), ""),
    ("failed primary response", lambda e: e['receipt'].update(httpStatus=500), ""),
    ("malformed original ID", lambda e: e['receipt']['raw'].update(export_id="../other-export"), ""),
    ("saved artifact", lambda e: e.update(csv="'saved-artifact'"), ""),
    ("unbound recovery", lambda e: e.update(recovery="'{\"httpStatus\":503}'", history="'[{\"httpStatus\":503}]'"), ""),
    ("settled batch", lambda e: e.update(state="completed"), ""),
    ("saved results", lambda e: e.update(results="'[]'"), ""),
    ("future backoff", lambda e: e.update(due="clock_timestamp()+interval '1 hour'"), ""),
    ("live lease", lambda e: e.update(lease="clock_timestamp()+interval '1 hour'"), ""),
]
for name, column, value in [
    ("admitted original", "admitted", "true"),
    ("wrong account", "account_id", "'00000000-0000-4000-8000-000000000099'"),
    ("wrong request kind", "kind", "'property_search'"),
    ("unknown original result", "result", "'{\"outcome\":\"unknown\"}'"),
    ("missing original result", "result", "null"),
    ("finished original", "finished_at", "clock_timestamp()"),
    ("pre-terminal request", "created_at", "clock_timestamp()-interval '2 hours'"),
]:
    cases.append((name, lambda e: None, f"update icash_research_private.requests set {column}={value} where id=(select id from icash_research_private.requests where operation_key='owner-export-recovery:{case_batch}' limit 1);"))
for name, mutate, extra in cases:
    fixture = deepcopy(base)
    mutate(fixture)
    out = sql("begin;"+insert(case_batch, fixture)+extra+claim(case_batch)+f"select count(*) from icash_research_private.owner_export_quota_continuations where batch_id='{case_batch}';rollback;")
    assert out == "0", (name, out)

# Enrollment freezes the complete original source, not only its request UUIDs.
assert sql("begin;update public.native_fixture_quota set available=true;"+due(batch)+f"update icash_research_private.owner_batches set preview_receipt='{{\"changed\":true}}' where id='{batch}';"+claim(batch)+"rollback;") == ""
# An older admitted request cannot disappear merely because it predates the
# new journal. Unknown and unfinished legacy outcomes block fresh admission.
for legacy_result, legacy_finished in [("null", "null"), ("'{\"outcome\":\"unknown\"}'", "clock_timestamp()")]:
    legacy = deepcopy(original)
    legacy['attempts'] = 1
    out = sql("begin;"+insert(case_batch, legacy)+f"insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result,finished_at) values(gen_random_uuid(),'owner_preview','{account}','owner-export-recovery:{case_batch}',true,{legacy_result},{legacy_finished});"+claim(case_batch, True)+f"select recovery_attempts||':'||(select count(*) from icash_research_private.owner_export_quota_requests where batch_id='{case_batch}') from icash_research_private.owner_exports where id='{case_batch}';rollback;")
    assert out == "1:0", out

sql("update public.native_fixture_quota set available=true;"+due(batch))
claims = [json.loads(r) for r in contend("begin;"+claim(batch)+"select pg_sleep(0.03);commit;") if r]
assert len(claims) == 1, claims
current = claims[0]
assert current['id'] == batch and current['accountId'] == account and current['atomicRecovery'] is True and current['localOnly'] is False
assert current['receipt'] == receipt and current['csv'] is None
assert sql(f"select request_id::text||':'||lease_token::text from icash_research_private.owner_export_quota_requests where batch_id='{batch}' and ordinal=1;") == current['quotaRequestId']+":"+current['lease']
assert sql(evidence(batch)) == original_evidence
assert not sql(claim(batch))
# Lost acknowledgement, unknown outcome, missing response, mismatched lease or
# response status never grants a replacement request after lease expiration.
assert not sql("begin;"+due(batch)+claim(batch)+"rollback;")
assert sql("begin;"+finish(current, outcome="unknown")+due(batch)+claim(batch)+"rollback;") == "t"
assert sql("begin;"+finish(current)+due(batch)+claim(batch)+"rollback;") == "t"
wrong = {**current, 'lease': str(uuid4())}
assert sql("begin;"+finish(current)+record(wrong)+due(batch)+claim(batch)+"rollback;") == "t\nf"
assert sql("begin;"+finish(current, status=502)+record(current, status=503)+due(batch)+claim(batch)+"rollback;") == "t\nt"
assert sql("begin;"+finish(current)+record({**current, 'quotaRequestId': str(uuid4())})+due(batch)+claim(batch)+"rollback;") == "t\nf"
assert sql("begin;"+finish(current, status=200, outcome="response")+record(current, status=200, export_id="different-original")+due(batch)+claim(batch)+"rollback;") == "t\nt"
assert sql("begin;"+finish(current)+record(current, status="malformed")+due(batch)+claim(batch)+"rollback;") == "t\nt"
assert sql("begin;"+finish(current)+record(current)+record(current)+due(batch)+claim(batch)+"rollback;") == "t\nt\nt"
assert sql("begin;"+due(batch)+record(current)+"rollback;") == "f", "Expired lease cannot save a response"

# Bounded known-response continuation: 24 workers share one new original-ID
# read, every response is source/lease-bound, and a seventh GET is impossible.
requests = set()
for attempt in range(1, 7):
    assert current['quotaRequestId'] not in requests
    requests.add(current['quotaRequestId'])
    status = 200 if attempt == 6 else 503
    assert sql(finish(current, status=status, outcome="response" if status == 200 else "http_error")+record(current, status=status)) == "t\nt"
    assert sql(f"select count(ordinal) from icash_research_private.owner_export_quota_requests where batch_id='{batch}' and phase='continuation';") == str(attempt)
    assert sql(evidence(batch)) == original_evidence
    if attempt < 6:
        sql(due(batch))
        next_claims = [json.loads(r) for r in contend(claim(batch)) if r]
        assert len(next_claims) == 1, next_claims
        current = next_claims[0]
assert sql("begin;"+due(batch)+claim(batch)+"rollback;") == ""
assert sql("select day_used from public.icash_dealmachine_request_budget;") == "6", "Historical admission budget must count six requests"
# The unchanged artifact writer accepts only the current exact lease. The
# existing cached-artifact path remains separate and consumes no provider quota.
assert sql(f"select public.icash_record_owner_export_artifact('{batch}','{uuid4()}','fixture-csv');") == "f"
assert sql(f"select public.icash_record_owner_export_artifact('{batch}','{current['lease']}','fixture-csv');") == "t"
sql("update icash_research_private.owner_export_settings set cached_artifact_recovery_enabled=true;"+due(batch))
local = json.loads(sql(claim(batch, True)))
assert local['localOnly'] is True and not local.get('atomicRecovery') and 'quotaRequestId' not in local
assert local['csv'] == 'fixture-csv'
assert sql("select day_used from public.icash_dealmachine_request_budget;") == "6", "Historical admission budget must count six requests"
assert sql(f"select recovery_attempts||':'||cached_artifact_attempts from icash_research_private.owner_exports where id='{batch}';") == "6:1"

# Prospective ordinary work never burns a recovery attempt while quota is
# unavailable. Its admitted response uses the same history/no-unknown boundary.
sql(insert(ordinary_batch, original)+"update public.native_fixture_quota set available=false;")
assert not any(contend(claim(ordinary_batch, True)))
for _ in range(5):
    sql(due(ordinary_batch))
    assert not sql(claim(ordinary_batch, True))
assert sql(f"select recovery_attempts||':'||cached_artifact_attempts||':'||coalesce(lease_token::text,'none') from icash_research_private.owner_exports where id='{ordinary_batch}';") == "0:0:none"
assert sql(f"select count(*)||':'||count(ordinal) from icash_research_private.owner_export_quota_requests where batch_id='{ordinary_batch}';") == "6:0"
sql("update public.native_fixture_quota set available=true;"+due(ordinary_batch))
for attempt in range(1, 7):
    ordinary_claims = [json.loads(r) for r in contend(claim(ordinary_batch, True)) if r]
    assert len(ordinary_claims) == 1, ordinary_claims
    current = ordinary_claims[0]
    assert current['atomicRecovery'] is True and current['localOnly'] is False
    if attempt == 1:
        assert not sql("begin;"+due(ordinary_batch)+"update icash_research_private.owner_export_quota_policy set enabled=false;"+claim(ordinary_batch, True)+"rollback;")
        assert sql("begin;"+finish(current, outcome="unknown")+due(ordinary_batch)+"update icash_research_private.owner_export_quota_policy set enabled=false;"+claim(ordinary_batch, True)+"rollback;") == "t"
    assert sql(f"select recovery_attempts from icash_research_private.owner_exports where id='{ordinary_batch}';") == str(attempt)
    assert not sql("begin;"+due(ordinary_batch)+claim(ordinary_batch, True)+"rollback;")
    assert sql(finish(current)+record(current)) == "t\nt"
    sql(due(ordinary_batch))
assert not any(contend(claim(ordinary_batch, True)))
assert not sql(claim(ordinary_batch)), "Admitted ordinary history is not exact-six never-admitted proof"
assert sql("select day_used from public.icash_dealmachine_request_budget;") == "12"

# Retention journal, original evidence, privacy and irreversible rollout gate.
sql("update icash_research_private.owner_export_quota_requests set phase='continuation';", error="immutable")
sql("delete from icash_research_private.owner_export_quota_continuations;", error="immutable")
sql("truncate icash_research_private.owner_export_quota_requests;", error="immutable")
sql(f"update icash_research_private.owner_exports set recovery_attempts=0 where id='{batch}';", error="immutable")
assert sql("begin;update icash_research_private.requests set created_at=now()-interval '31 days';select public.icash_prune_research_requests();rollback;") == "0"
for role in ["anon", "authenticated", "service_role"]:
    assert sql(f"select has_table_privilege('{role}','icash_research_private.requests','select,insert,update,delete') or has_table_privilege('{role}','icash_research_private.owner_export_quota_requests','select,insert,update,delete') or has_table_privilege('{role}','icash_research_private.owner_export_quota_policy','select,insert,update,delete');") == "f"
    assert sql(f"select has_function_privilege('{role}','icash_research_private.activate_owner_export_quota_recovery(text)','execute');") == "f"
for role in ["anon", "authenticated"]:
    assert sql(f"select has_function_privilege('{role}','public.icash_claim_owner_export_quota_recovery(uuid)','execute');") == "f"
assert sql("select has_function_privilege('service_role','public.icash_claim_owner_export_quota_recovery(uuid)','execute');") == "t"
sql("update icash_research_private.owner_export_quota_policy set enabled=false;")
assert sql(activation) == "f", "A disabled activated lane cannot silently reactivate"
assert not sql(claim(case_batch))
print(f"PASS native export quota recovery: predecessor six-refusal exhaustion reproduced; inactive/hash-gated rollout; {len(cases)} source/lease rejection cases; immutable denied requests; quota deferrals consume no allowance; 24-worker admission; exact known-response history; unknown/lost/expired outcomes held; six bounded original-ID reads; ordinary prospective accounting; saved-artifact path; retained evidence and private ACLs.")
