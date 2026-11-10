"""Real concurrent acquisition/estimate claims on the disposable CI database."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
from threading import Barrier

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql, read = fixture.sql, fixture.read


def race(query, count=8):
    barrier = Barrier(count)
    def contender(_):
        barrier.wait(timeout=10)
        return sql(query)
    with ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(contender, range(count)))


def main():
    assert sql('select current_database()') == 'icash_reliability'
    sql('drop schema if exists icash_research_private cascade;drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
    sql(read('tests/fixtures/discovery-hold-foundation.sql'))
    for definition in json.loads(read('tests/fixtures/discovery-hold-before.json')).values():
        sql(definition)
    sql(read('config/discovery-hold-backoff.sql'))
    sql(read('config/discovery-hold-backoff.sql'))
    a = sql('select fixture_discovery_seed(1)')
    b = sql('select fixture_discovery_seed(2)')
    sql(f"insert into icash_automation_tickets(account_id,kind,state,outcome,completed_at) values('{a}','discovery','held','inventory_held',now())")
    issue = "select coalesce(icash_next_acquisition()::text,'null')"
    issued = race(issue)
    assert sum(x != 'null' for x in issued) == 1, issued
    assert sql("select account_id from icash_automation_tickets where state='issued'") == b
    assert sql("select count(*) from icash_automation_tickets where state='issued'") == '1'
    original = sql(f"select to_jsonb(t) from icash_automation_tickets t where account_id='{a}'")
    sql(f"update fixture_acquisition set contact=md5('synthetic-contact')::uuid where account_id='{a}';update icash_discovery_configs set next_run_at=now()-interval '1 second'")
    assert sum(x != 'null' for x in race(issue)) == 1
    assert sql(f"select kind from icash_automation_tickets where account_id='{a}' and state='issued'") == 'contacts'
    assert sql(f"select to_jsonb(t) from icash_automation_tickets t where account_id='{a}' and state='held'") == original
    sql("delete from icash_automation_tickets where state='issued';update fixture_acquisition set contact=null;update icash_accounts set bot_paused=true;update icash_discovery_configs set next_run_at=now()-interval '1 second'")
    assert all(x == 'null' for x in race(issue)), 'Concurrent callers must retain customer Pause'
    sql('update icash_accounts set bot_paused=false')
    claim = f"select icash_claim_discovery_estimate('{a}','{{\"p_revision\":\"synthetic-revision\",\"p_page\":1}}',null,null,'{{\"estimate_cost\":true,\"contact_audience\":\"none\",\"anchor\":\"properties\"}}')->>'status'"
    outcomes = race(claim)
    assert outcomes.count('request') == 1 and outcomes.count('held') == 7, outcomes
    assert sql("select count(*) from icash_research_private.estimates where lease_until>now()+interval '80 seconds'") == '1'
    assert sql("select count(*) from icash_automation_tickets where state='issued'") == '0'
    sql('alter table icash_research_private.estimates add shared_from_operation text;truncate icash_research_private.estimates;')
    sql('create function icash_research_private.financial_query_valid(jsonb,jsonb,jsonb,jsonb) returns boolean language sql as $$select false$$;')
    sql(json.loads(read('tests/fixtures/discovery-financial-estimate-before.json'))['definition'])
    sql(read('config/discovery-hold-backoff.sql'))
    outcomes = race(claim)
    assert outcomes.count('request') == 1 and outcomes.count('held') == 7, outcomes
    assert sql("select count(*) from icash_research_private.estimates where lease_until>now()+interval '80 seconds'") == '1'
    print('Native discovery backoff: concurrent independent work, one-use tickets, Pause, immutable holds and coalesced free leases passed.')


if __name__ == '__main__':
    main()
