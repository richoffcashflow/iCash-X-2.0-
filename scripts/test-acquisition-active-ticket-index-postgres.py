"""Production acquisition selection over historical tickets, on localhost only."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'priority_fixture', ROOT / 'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql


def plan(query):
    return json.loads(sql('explain(analyze,buffers,format json) '+query))[0]


def walk(node):
    yield node
    for child in node.get('Plans', []):
        yield from walk(child)


def run():
    fixture.setup()
    sql("""
      select fixture_preflight_seed(n,false,interval '6 minutes')
       from generate_series(1,100) n;
      create index icash_automation_account
       on public.icash_automation_tickets(account_id,created_at desc);
      insert into public.icash_automation_tickets(account_id,kind,state,created_at,expires_at)
      select d.account_id,'contacts',case when n%2=0 then 'complete' else 'held' end,
       now()-interval '1 day',now()+interval '1 hour'
      from public.icash_discovery_configs d cross join generate_series(1,1000) n;
      -- Expired issued and stale consumed remain historical holds, not blockers.
      insert into public.icash_automation_tickets(account_id,kind,state,created_at,expires_at)
      select d.account_id,'contacts',state,now()-interval '6 minutes',now()-interval '1 second'
      from public.icash_discovery_configs d cross join (values('issued'),('consumed')) s(state);
      analyze public.icash_automation_tickets;
    """)
    definition = sql("select pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);")
    # Exercise the production selector, not a simplified copy of its predicate.
    start = definition.index('for c in select ')+len('for c in ')
    end = definition.index(' limit 5 for update of d skip locked loop',start)
    query = definition[start:end].replace('select d.* from','select d.account_id from',1)
    assert "x.state='issued' and x.expires_at>now()" in query
    assert "x.state='consumed' and x.created_at>now()-interval '5 minutes'" in query
    before_definition = definition
    before_hash = sql("select md5(string_agg(to_jsonb(t)::text,',' order by id)) from public.icash_automation_tickets t;")
    before_rows = sql(query)
    before = plan(query)
    migration = (ROOT/'config/acquisition-active-ticket-index.sql').read_text()
    versions = list((ROOT/'supabase/migrations').glob('*_acquisition_active_ticket_index.sql'))
    assert len(versions) == 1 and versions[0].read_text() == migration
    sql(migration)
    sql('analyze public.icash_automation_tickets;')
    after = plan(query)
    assert sql(query) == before_rows
    assert sql("select pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);") == before_definition
    assert sql("select md5(string_agg(to_jsonb(t)::text,',' order by id)) from public.icash_automation_tickets t;") == before_hash
    nodes = list(walk(after['Plan']))
    assert any(n.get('Index Name') == 'icash_automation_account_active' for n in nodes), after
    before_hits = before['Plan']['Shared Hit Blocks']
    after_hits = after['Plan']['Shared Hit Blocks']
    assert after_hits*3 < before_hits, (before_hits,after_hits)
    account = sql('select account_id from public.icash_discovery_configs order by account_id limit 1;')
    another = sql('select account_id from public.icash_discovery_configs order by account_id offset 1 limit 1;')
    base_count = len(before_rows.splitlines())
    assert base_count == 100
    for state,created,expires,blocked in [
        ('issued',"now()-interval '1 day'","now()+interval '1 minute'",True),
        ('issued','now()','now()',False),
        ('consumed',"now()-interval '4 minutes'","now()-interval '1 minute'",True),
        ('consumed',"now()-interval '5 minutes'","now()+interval '1 minute'",False),
        ('complete','now()',"now()+interval '1 minute'",False),
        ('held','now()',"now()+interval '1 minute'",False),
    ]:
        output = sql(f"begin;set local plan_cache_mode=force_generic_plan;insert into public.icash_automation_tickets(account_id,kind,state,created_at,expires_at) values('{account}','contacts','{state}',{created},{expires});{query};rollback;")
        rows = output.splitlines()
        assert (account not in rows) == blocked, (state,created,expires,rows)
        assert another in rows, 'A ticket must affect only its own account'
        assert len(rows) == base_count-int(blocked)
    # A reused prepared plan must reflect ticket-state transitions immediately.
    transition = sql(f"begin;set local plan_cache_mode=force_generic_plan;prepare selection as {query};insert into public.icash_automation_tickets(account_id,kind,state) values('{account}','contacts','issued');select count(*) from public.icash_automation_tickets where account_id='{account}' and state='issued' and expires_at>now();update public.icash_automation_tickets set state='held' where account_id='{account}' and state='issued' and expires_at>now();execute selection;rollback;").splitlines()
    assert transition[0] == '1' and account in transition[1:] and len(transition[1:]) == base_count
    assert sql("select md5(string_agg(to_jsonb(t)::text,',' order by id)) from public.icash_automation_tickets t;") == before_hash
    print(f'PASS acquisition active ticket index: exact production selection unchanged across 100 accounts/100,200 historical tickets; original function and rows untouched; live/expired/consumed/state-transition/account boundaries retained; shared hits {before_hits} -> {after_hits}. No providers.')


if __name__ == '__main__':
    run()
