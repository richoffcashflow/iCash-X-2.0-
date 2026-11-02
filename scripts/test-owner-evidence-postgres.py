"""Concurrent read guards and generic index plans on disposable local PostgreSQL."""
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
sql("drop schema if exists icash_private cascade;drop schema public cascade;create schema public;")
sql((ROOT / "tests/fixtures/owner-evidence-indexes.sql").read_text())
source = (ROOT / "config/owner-enrichment-deferral.sql").read_text()
sql(source[source.index("create function public.icash_owner_enrichment_unstarted("):source.index("create function public.icash_owner_enrichment_retry_safe(")])
sql((ROOT / "config/owner-enrichment-evidence-indexes.sql").read_text())
sql("insert into icash_cost_observations(event_key,source_ref) select 'unrelated:'||g,'provider:unrelated:'||g from generate_series(1,50000) g;analyze icash_cost_observations;")
account, screening = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
operation = f"owners:{account}:{screening}"
query = f"select icash_owner_enrichment_unstarted('{account}','{screening}','{operation}');"
with ThreadPoolExecutor(max_workers=12) as pool:
    assert set(pool.map(lambda _: sql(query), range(24))) == {"t"}
for field, prefix, name in [("event_key", operation, "event"), ("source_ref", "dealmachine:owners:"+operation, "source")]:
    plan = sql(f"set plan_cache_mode=force_generic_plan;prepare evidence(text) as select 1 from icash_cost_observations where {field} collate \"C\">=($1||':') collate \"C\" and {field} collate \"C\"<($1||';') collate \"C\";explain(analyze,buffers,format json) execute evidence('{prefix}');")
    assert "icash_cost_observation_"+name+"_prefix" in json.dumps(json.loads(plan)), plan
sql(f"insert into icash_cost_observations(provider,event_key,source_ref) values('other-provider','saved-original','dealmachine:owners:{operation}:évidence');")
before = sql("select md5(jsonb_agg(to_jsonb(o) order by provider,event_key)::text) from icash_cost_observations o;")
with ThreadPoolExecutor(max_workers=12) as pool:
    assert set(pool.map(lambda _: sql(query), range(24))) == {"f"}
assert before == sql("select md5(jsonb_agg(to_jsonb(o) order by provider,event_key)::text) from icash_cost_observations o;")
print("PASS native PostgreSQL: 48 concurrent reads honor committed original receipts, both generic prefix plans use indexes, and all 50,001 evidence rows remain unchanged.")
