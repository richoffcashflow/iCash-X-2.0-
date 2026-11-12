"""Native starter-dependency races on the fixed disposable local database."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pacing_fixture", ROOT / "scripts/test-research-request-pacing-postgres.py")
pacing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pacing)
pacing.setup()
sql, contend = pacing.sql, pacing.contend
sql("""create table icash_research_private.targeting_query_settings(id int primary key,enabled boolean,list_id text);
 insert into icash_research_private.targeting_query_settings values(1,true,'fixture-list');
 update icash_research_private.settings set exclusions_enabled=false,exclusion_sync_enabled=true;
 update icash_research_private.request_pacing_policy set activate_after=now()+interval '1 hour';
 update icash_dealmachine_request_budget set day_used=8820,minute_used=0;
 insert into icash_research_private.targeting_acquired_properties values('prop_2',null);""")
a, b = pacing.fixture.seed(901), pacing.fixture.seed(902)
sql(f"insert into icash_discovery_configs(account_id,research_list_id) values('{a}',null),('{b}',null);")
before = sql("select to_jsonb(b) from icash_dealmachine_request_budget b;")
sql((ROOT / "config/research-feed-request-efficiency.sql").read_text())
assert sql("select to_jsonb(b) from icash_dealmachine_request_budget b;") == before
claims = contend([f"set role service_role;select icash_claim_starter_research_exclusions('{a if i % 2 else b}');" for i in range(24)])
claimed = [json.loads(c) for c in claims if c]
assert len(claimed) == 1, claims
c = claimed[0]
assert c["action"] == "sync" and c["ids"] == ["prop_1", "prop_2"], c
operation = "starter-exclusion:" + c["token"]
queries = [pacing.request(c["accountId"], operation, "exclusion_sync") for _ in range(24)]
results = contend(queries)
assert results.count("t") == 1 and results.count("f") == 23, results
assert sql("select day_used from icash_dealmachine_request_budget;") == "8821"
assert sql("select count(*) from icash_research_private.request_reserve_admissions;") == "1"
assert sql("select count(*) from icash_research_private.maintenance_request_admissions;") == "0"
assert sql("select exclusions_enabled from icash_research_private.settings;") == "f"
print("PASS native financial starter sync: 24 workers share one exact list lease; 24 request UUIDs consume one starter slot, with unchanged ordinary/maintenance limits and legacy switch.")
