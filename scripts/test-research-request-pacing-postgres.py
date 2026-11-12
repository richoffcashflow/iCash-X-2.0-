"""Native pacing races. Fixed disposable localhost database only; no providers."""
import importlib.util
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("reserve_fixture", ROOT / "scripts/test-new-user-request-reserve-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql, contend = fixture.sql, fixture.contend


def setup():
    # Reuse the runner's fixed localhost:55443 / icash_reliability target and
    # database identity assertion; no environment-controlled production URL.
    fixture.setup()
    sql((ROOT / "tests/fixtures/new-user-request-reserve-exclusions-foundation.sql").read_text())
    sql("""alter table icash_research_private.settings add column exclusion_sync_enabled boolean default false;
      create table icash_research_private.financial_settings(id int primary key,enabled boolean);
      insert into icash_research_private.financial_settings values(1,true);
      create table icash_research_private.request_reserve_exclusion_claims(token uuid primary key,account_id uuid,list_id text,created_at timestamptz default clock_timestamp());""")
    for function in json.loads((ROOT / "tests/fixtures/request-budget-pacing-before.json").read_text()):
        sql(function["definition"])
    sql("begin;" + (ROOT / "config/research-request-pacing.sql").read_text() + "commit;")
    sql("""update icash_research_private.request_pacing_policy set enabled=true,activate_after=now()-interval '2 days';
      grant execute on function public.icash_claim_research_exclusions() to service_role;""")


def reset(used, starter=0, maintenance=0, hours=23):
    fixture.reset_window(used)
    sql(f"""truncate icash_research_private.maintenance_request_admissions;
      update public.icash_dealmachine_request_budget set day_start=now()-interval '{hours} hours';
      update icash_research_private.exclusions set token=null,lease_until=null,next_at=now()-interval '1 minute',batch='{{}}',state='ready',list_id='fixture-list';
      insert into icash_research_private.request_reserve_admissions(request_id,account_id,day_start,first_funded_at)
       select gen_random_uuid(),'{historical}',b.day_start,now()-interval '1 hour'
       from public.icash_dealmachine_request_budget b cross join generate_series(1,{starter});
      insert into icash_research_private.maintenance_request_admissions(request_id,token,list_id,protected,day_start)
       select gen_random_uuid(),gen_random_uuid(),'fixture-list',true,b.day_start
       from public.icash_dealmachine_request_budget b cross join generate_series(1,{maintenance});""")


def request(account=None, operation="fixture", kind="owner_preview", request_id=None):
    account_sql = "null" if account is None else f"'{account}'"
    return ("set role service_role;select public.icash_take_dealmachine_request("
            f"'{kind}',{account_sql},'{operation}','{request_id or uuid.uuid4()}');")


def claim():
    raw = sql("set role service_role;select public.icash_claim_research_exclusions();")
    result = json.loads(raw)
    assert result["action"] == "sync", result
    return "maintenance-exclusion:" + result["token"]


def check(results, admitted, used, starter, maintenance):
    assert results.count("t") == admitted and results.count("f") == len(results)-admitted, results
    counters = json.loads(sql("""select jsonb_build_object('day',day_used,'minute',minute_used,
      'starter',(select count(*) from icash_research_private.request_reserve_admissions),
      'maintenance',(select count(*) from icash_research_private.maintenance_request_admissions where protected),
      'ledger',(select count(*) from icash_research_private.requests where admitted))
      from public.icash_dealmachine_request_budget;"""))
    assert counters == dict(day=used, minute=admitted, starter=starter, maintenance=maintenance, ledger=admitted), counters


if __name__ == "__main__":
    setup()
    historical, fresh = fixture.seed(900), fixture.seed(901)
    # Final ordinary day slot cannot spill into either reserved lane.
    reset(8623)
    check(contend([request() for _ in range(24)]), 1, 8624, 0, 0)
    # One final starter slot remains independently of maintenance.
    reset(9603, starter=979)
    check(contend([request(fresh) for _ in range(24)]), 1, 9604, 980, 0)
    # One final maintenance slot and one exact lease: different UUIDs cannot
    # replay it, even though multiple concurrent callers saw the same token.
    reset(8819, maintenance=195)
    operation = claim()
    check(contend([request(operation=operation, kind="exclusion_sync") for _ in range(24)]), 1, 8820, 0, 196)
    # Both independent lanes race for the last two hard-day slots.
    reset(9798, starter=979, maintenance=195)
    operation = claim()
    results = contend([request(fresh) if i % 2 else request(operation=operation, kind="exclusion_sync") for i in range(32)])
    check(results, 2, 9800, 980, 196)
    assert results[1::2].count("t") == 1 and results[::2].count("t") == 1, results
    # One-use maintenance proof also applies when paid by ordinary capacity.
    reset(196, maintenance=196)
    operation = claim()
    check(contend([request(operation=operation, kind="exclusion_sync") for _ in range(24)]), 1, 197, 0, 196)
    sql("delete from icash_research_private.requests;")
    assert sql(request(operation=operation, kind="exclusion_sync")) == "f"
    # Same UUID contention must not charge twice.
    reset(0)
    duplicate = str(uuid.uuid4())
    check(contend([request(request_id=duplicate) for _ in range(24)]), 1, 1, 0, 0)
    print("PASS native pacing: final ordinary/starter/maintenance slots, shared hard-day contention, exact one-use maintenance token, durable replay prevention and UUID races. No providers.")
