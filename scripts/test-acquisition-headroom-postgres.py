"""Native activation/admission races in the fixed disposable quota fixture."""
import importlib.util
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pacing_fixture", ROOT / "scripts/test-research-request-pacing-postgres.py")
pacing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pacing)
sql, contend = pacing.sql, pacing.contend

if __name__ == "__main__":
    pacing.setup()
    old = pacing.fixture.seed(910, "3 days")
    fresh = pacing.fixture.seed(911)
    before = sql("select to_jsonb(b) from public.icash_dealmachine_request_budget b;")
    sql((ROOT / "config/acquisition-quota-headroom.sql").read_text())
    assert sql("select to_jsonb(b) from public.icash_dealmachine_request_budget b;") == before
    sql("""update public.icash_dealmachine_request_budget set
      day_start=now()-interval '11 hours 59 minutes 57 seconds',day_used=4669,minute_start=now(),minute_used=0;""")
    assert sql(f"select public.icash_dealmachine_capacity_available(2,'{old}');") == "t"
    activate = "select icash_research_private.activate_acquisition_headroom(repeat('a',40));"
    requests = [str(uuid.uuid4()) for _ in range(24)]
    results = contend([activate for _ in range(16)] + [pacing.request(old, request_id=r) for r in requests])
    assert results[:16] == ["t"] * 16, results
    assert results[16:].count("t") == 2, results
    counters = json.loads(sql("""select jsonb_build_object('used',day_used,'minute',minute_used,
      'admitted',(select count(*) from icash_research_private.requests where admitted),
      'starter',(select count(*) from icash_research_private.request_reserve_admissions))
      from public.icash_dealmachine_request_budget;"""))
    assert counters == dict(used=4671, minute=2, admitted=2, starter=0), counters
    receipt = sql("select to_jsonb(p) from icash_research_private.acquisition_headroom_policy p;")
    assert sql("select icash_research_private.activate_acquisition_headroom(repeat('b',40));") == "f"
    assert sql("select to_jsonb(p) from icash_research_private.acquisition_headroom_policy p;") == receipt
    ledger = sql("select md5(string_agg(to_jsonb(r)::text,E'\\n' order by id)) from icash_research_private.requests r;")
    assert all(x == "f" for x in contend([pacing.request(old, request_id=r) for r in requests]))
    assert sql("select md5(string_agg(to_jsonb(r)::text,E'\\n' order by id)) from icash_research_private.requests r;") == ledger
    sql("""update public.icash_dealmachine_request_budget set
      day_start=now()-interval '11 hours 59 minutes 57 seconds',day_used=4669,minute_start=now(),minute_used=0;""")
    original = sql("select to_jsonb(b) from public.icash_dealmachine_request_budget b;")
    reads = contend([f"set role service_role;select public.icash_dealmachine_capacity_available(2,'{old}');" for _ in range(24)])
    assert reads == ["f"] * 24, reads
    assert sql("select to_jsonb(b) from public.icash_dealmachine_request_budget b;") == original
    assert sql(f"select public.icash_dealmachine_capacity_available(2,'{fresh}');") == "t"
    assert sql(f"select public.icash_dealmachine_capacity_available(1,'{old}');") == "t"
    sql("update public.icash_dealmachine_request_budget set day_used=4668;")
    assert sql(f"select public.icash_dealmachine_capacity_available(2,'{old}');") == "t"
    assert sql(f"select public.icash_dealmachine_capacity_available(3,'{old}');") == "t"
    print("PASS native headroom: 16 concurrent activations, 24 final requests, exact counters, immutable replay evidence, read-only scheduling and independent starter allowance. No providers.")
