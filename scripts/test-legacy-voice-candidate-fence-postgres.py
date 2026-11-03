"""Native legacy voice fence checks in disposable localhost PostgreSQL only."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import subprocess
from threading import Barrier

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
COMMAND = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
           "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]


def sql(query):
    result = subprocess.run(COMMAND, input="set statement_timeout='8s';"+query, env=ENV,
                            text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


assert sql("select current_database();") == "icash_reliability"
sql("drop schema public cascade;create schema public;")
sql((ROOT/"tests/fixtures/legacy-voice-candidate-fence.sql").read_text())
sql((ROOT/"tests/fixtures/legacy-voice-before-candidate-fence.sql").read_text())
original = sql("select pg_get_functiondef('public.icash_queue_voice_jobs_before_operational()'::regprocedure);")
assert sql("select md5(pg_get_functiondef('public.icash_queue_voice_jobs_before_operational()'::regprocedure));") == "a8eb1f89eb58fa1cd9aac427af6e7252"
migration = (ROOT/"config/legacy-voice-candidate-fence.sql").read_text()
before = re.search(r"original_query text:=\$old\$([\s\S]*?)\$old\$", migration).group(1)
after = re.search(r"replacement_query text:=\$new\$([\s\S]*?)\$new\$", migration).group(1)
sql("select fixture_seed(n) from generate_series(100,1099)n;"
    "insert into icash_voice_jobs(account_id,permission_id,state,outcome) select account_id,id,'held','original_unknown_receipt' from icash_contact_permissions;"
    "update fixture_evidence set explode=true;analyze;")
# The observed production plan pushed the evidence function ahead of this
# exclusion. The fixed query must fence it under native custom/generic plans.
sql(migration)
assert sql("select pg_get_functiondef('public.icash_queue_voice_jobs_before_operational()'::regprocedure);") == original.replace(before, after)
history = sql("select md5(string_agg(to_jsonb(j)::text,',' order by id)) from icash_voice_jobs j;")
for mode in ["force_custom_plan", "force_generic_plan"]:
    plan = json.loads(sql("set plan_cache_mode="+mode+";explain (analyze,format json) "+after+";"))[0]
    assert plan["Plan"]["Actual Rows"] == 0
    assert sql("select is_called from fixture_evidence_reads;") == "f", "No historical evidence may be evaluated"
    sql("set plan_cache_mode="+mode+";select icash_queue_voice_jobs_before_operational();")
    assert sql("select is_called from fixture_evidence_reads;") == "f"

sql("select fixture_seed(2000);")
barrier = Barrier(24)


def queue_once(_):
    barrier.wait(timeout=10)
    # The parent queue retains this exact scheduler lock; no new lock policy.
    sql("begin;select pg_advisory_xact_lock(726341927);select icash_queue_voice_jobs_before_operational();commit;")


with ThreadPoolExecutor(max_workers=24) as pool:
    list(pool.map(queue_once, range(24)))
assert sql("select count(*) from icash_voice_jobs where permission_id=fixture_id(2000);") == "1"
assert sql("select md5(string_agg(to_jsonb(j)::text,',' order by id)) from icash_voice_jobs j where permission_id<>fixture_id(2000);") == history
assert sql("select last_value from fixture_evidence_reads;") == "1", "New work evaluated once under unchanged scheduler lock"
sql("update fixture_evidence set explode=true where id=fixture_id(2000);select icash_queue_voice_jobs_before_operational();")

# Preserve exact operational route matching, the late eligible account, Pause,
# current policy, evidence, funding eligibility and the final 100-row limit.
sql("select fixture_seed(2100);"
    "insert into icash_operational_contacts select id,account_id,screening_id,contact_key from icash_contact_permissions where id=fixture_id(2100);"
    "insert into icash_voice_jobs(account_id,operational_contact_id,state) values(fixture_id(1),fixture_id(2100),'held');"
    "update fixture_evidence set explode=true where id=fixture_id(2100);select icash_queue_voice_jobs_before_operational();")
assert sql("select count(*) from icash_voice_jobs where permission_id=fixture_id(2100);") == "0"
sql("select fixture_seed(n) from generate_series(2200,2319)n;"
    "update fixture_evidence set allowed=false where id>=fixture_id(2200);"
    "select fixture_seed(2400,2);update icash_accounts set bot_paused=true where id=fixture_id(2);"
    "select icash_queue_voice_jobs_before_operational();")
assert sql("select count(*) from icash_voice_jobs where permission_id>=fixture_id(2200);") == "0"
sql("update icash_accounts set bot_paused=false where id=fixture_id(2);select icash_queue_voice_jobs_before_operational();")
assert sql("select count(*) from icash_voice_jobs where permission_id=fixture_id(2400);") == "1"
sql("update fixture_evidence set allowed=true where id between fixture_id(2200) and fixture_id(2319);select icash_queue_voice_jobs_before_operational();")
assert sql("select count(*) from icash_voice_jobs where permission_id between fixture_id(2200) and fixture_id(2319);") == "100"
sql("select icash_queue_voice_jobs_before_operational();")
assert sql("select count(*) from icash_voice_jobs where permission_id between fixture_id(2200) and fixture_id(2319);") == "120"
print("PASS native legacy voice materialization bypasses 1,000 historical routes; 24 concurrent queue calls create one job; exact source, Pause, late eligible work, final 100-row limit and saved receipts preserved")
