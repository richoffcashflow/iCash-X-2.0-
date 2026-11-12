"""Race original free export recovery against the real starter request budget."""
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pacing_fixture", ROOT / "scripts/test-research-request-pacing-postgres.py")
pacing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pacing)
pacing.setup()
sql, contend = pacing.sql, pacing.contend
foundation = subprocess.run(["node", str(ROOT / "scripts/starter-export-test-fixture.mjs")],
                            check=True, capture_output=True, text=True).stdout
sql(foundation)
a, b, old = pacing.fixture.seed(901), pacing.fixture.seed(902), pacing.fixture.seed(903, "25 hours")
batch = "00000000-0000-4000-9000-000000000001"
literal = lambda value: "'" + json.dumps(value).replace("'", "''") + "'::jsonb"
raw = {"error": {"code": "invalid_request", "request_id": "req_fixture", "message": 'No records matched this export. Filters and scrub settings (like "Active phone numbers only") may have excluded every record — adjust them and try again.'}}
original = {"httpStatus": 400, "raw": raw, "rawText": json.dumps(raw)}
sql(f"""insert into icash_discovery_configs(account_id) values('{a}'),('{b}'),('{old}');
 insert into icash_research_private.owner_batches(id,account_id,paid_receipt) values('{batch}','{old}',{literal(raw)});
 insert into icash_research_private.owner_exports(id,request,receipt) values('{batch}','{{"people_ids":["held-owner"]}}',{literal(original)});
 insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result)
  values('{batch}','owner_lookup','{old}','owner-batch:{batch}',true,now()-interval '1 second',now(),'{{"outcome":"http_error","httpStatus":400}}');
 insert into icash_operation_spend values('original','dispatched',100);
 update icash_research_private.export_capacity_automation set enabled=true,empty_enabled=true,unknown_enabled=true;
 update icash_research_private.request_pacing_policy set activate_after=now()+interval '1 hour';
 update icash_research_private.request_reserve_policy set account_requests=3;
 update icash_dealmachine_request_budget set day_used=8820,minute_used=0;""")
assert sql("select icash_claim_automatic_export_capacity(repeat('a',40));") == ""
before = sql("select to_jsonb(b) from icash_dealmachine_request_budget b;")
money = sql("select to_jsonb(s) from icash_operation_spend s;")
source = sql("select to_jsonb(e)-'capacity_review_id' from icash_research_private.owner_exports e;")
sql((ROOT / "config/starter-export-dependency.sql").read_text())
sql((ROOT / "config/completion-reliability.sql").read_text().split('-- BEGIN export recovery')[1].split('-- END export recovery')[0])
assert sql("select to_jsonb(b) from icash_dealmachine_request_budget b;") == before
claims = contend(["set role service_role;select icash_claim_automatic_export_capacity(repeat('a',40));"] * 24)
claims = [json.loads(c) for c in claims if c]
assert len(claims) == 1, claims
c = claims[0]
for probe in ["inventory", "pending", "processing"]:
    if probe == "pending":
        # Admission is sequential because it uses a nonblocking shared lock.
        # Both status views are admitted before saving either response.
        for p in ["pending", "processing"]:
            admitted = contend([f"set role service_role;select icash_claim_export_capacity_probe('{c['reviewId']}','{p}');"] * 24)
            assert len([x for x in admitted if x]) == 1, admitted
        assert sql("select count(*) from icash_research_private.export_capacity_probes where receipt is not null;") == "1"
    data = [{"export_id": "old-terminal", "status": "completed", "created_at": "2000-01-01T00:00:00Z"}] if probe == "inventory" else []
    raw = {"data": data, "pagination": {"limit": 100, "offset": 0, "total": len(data), "has_more": False}}
    receipt = {"httpStatus": 200, "raw": raw, "rawText": json.dumps(raw), "headers": {"minuteRemaining": 49, "dayRemaining": 700}}
    assert sql(f"select icash_record_export_capacity_probe('{c['reviewId']}','{probe}',{literal(receipt)});") == "t"
results = contend([f"set role service_role;select icash_finish_automatic_export_capacity('{c['reviewId']}');"] * 24)
assert "capacity_verified" in results and set(results) <= {"capacity_verified", "capacity_review_held"}, results
assert sql("select day_used from icash_dealmachine_request_budget;") == "8823"
assert sql("select count(*) from icash_research_private.request_reserve_admissions;") == "3"
assert sql(f"select count(*) from icash_research_private.request_reserve_admissions where account_id='{a}';") == "3"
assert sql("select count(*) from icash_research_private.maintenance_request_admissions;") == "0"
assert sql(f"select icash_research_private.starter_request_allowance('{a}');") == "0"
assert sql("select to_jsonb(s) from icash_operation_spend s;") == money
assert sql("select to_jsonb(e)-'capacity_review_id' from icash_research_private.owner_exports e;") == source
assert sql("select icash_owner_export_people_available('[\"held-owner\"]');") == "f"
print("PASS native startup export recovery: 24 claimants and 24 workers per probe consume exactly three existing reserved slots for one account; original paid source, money and held owners remain unchanged.")
