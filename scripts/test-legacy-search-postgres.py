"""Concurrent legacy quarantine and Pause; isolated synthetic PostgreSQL only."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]

def sql(query):
    r = subprocess.run(CMD, input="set statement_timeout='8s';\n"+query, env=ENV, text=True, capture_output=True, timeout=15)
    if r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()

assert sql("select current_database();") == "icash_reliability"
sql("drop schema if exists icash_reliability_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public;")
for path in ["tests/fixtures/account-work-repair.sql", "tests/fixtures/legacy-search-recovery.sql", "config/standing-research-continuity.sql", "config/legacy-search-continuation.sql"]:
    sql((ROOT/path).read_text())
account = "00000000-0000-4000-8000-000000000021"
operation = "discovery:"+account+":00000000-0000-4000-8000-000000000121:7"
ticket = "00000000-0000-4000-8000-000000000221"
hashes = json.loads(sql("select jsonb_build_array(md5(to_jsonb(c)::text),md5((to_jsonb(o)-array['estimate_checked_at','financial_checked_at'])::text)) from icash_discovery_configs c,icash_operation_spend o"))
resume = f"select icash_continue_legacy_research('{account}','{operation}','{hashes[0]}','{hashes[1]}','{ticket}')"
sql("update icash_research_private.settings set legacy_continuation_enabled=true")
holder = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
holder.stdin.write(f"begin;select 1 from icash_operating_budget where id=1 for update;update icash_accounts set bot_paused=true where id='{account}';select 'pause_locked';\n")
holder.stdin.flush()
assert holder.stdout.readline().strip() == "1"
assert holder.stdout.readline().strip() == "pause_locked"
with ThreadPoolExecutor(max_workers=2) as pool:
    waiting = pool.submit(sql, resume)
    holder.stdin.write("commit;\n");holder.stdin.flush();holder.stdin.close()
    assert waiting.result(timeout=12) == "f"
holder.wait(timeout=10)
assert holder.returncode == 0
assert sql("select count(*) from icash_research_private.stalled_searches") == "0"
sql("update icash_accounts set bot_paused=false")
before = sql("select md5(jsonb_build_object('operations',(select jsonb_agg(to_jsonb(o)) from icash_operation_spend o),'wallets',(select jsonb_agg(to_jsonb(w)) from icash_wallets w))::text)")
with ThreadPoolExecutor(max_workers=12) as pool:
    results = list(pool.map(lambda _: sql(resume), range(24)))
assert results.count("t") == 1 and results.count("f") == 23
assert sql("select count(*) from icash_research_private.stalled_searches") == "1"
assert sql("select zip from icash_discovery_configs") == "75202"
assert sql("select zip from icash_research_private.stalled_searches") == "75201"
assert sql("select request_id is null and legacy_evidence->'ticket'->>'id'='"+ticket+"' from icash_research_private.stalled_searches") == "t"
assert before == sql("select md5(jsonb_build_object('operations',(select jsonb_agg(to_jsonb(o)) from icash_operation_spend o),'wallets',(select jsonb_agg(to_jsonb(w)) from icash_wallets w))::text)")
print("PASS native PostgreSQL: 24 competing legacy continuations create one immutable quarantine; Pause wins, original operation and wallet unchanged.")
