"""A locked historical receipt cannot block unrelated acquisition; localhost only."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql, read = fixture.sql, fixture.read


def uid(number):
    return f'00000000-0000-4000-8000-{number:012d}'


def run():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_work_private cascade;drop schema if exists icash_reliability_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public;')
    sql(read('tests/fixtures/account-work-repair.sql'))
    sql(read('tests/fixtures/acquisition-settlement-isolation-foundation.sql'))
    parallel = read('config/parallel-work-throughput.sql')
    sql(parallel[parallel.index('create schema if not exists icash_work_private;'):parallel.index('do $patch$')])
    for definition in json.loads(read('tests/fixtures/acquisition-settlement-isolation-before.json')):
        sql(definition['definition'])
    sweep = read('config/opportunity-queue.sql')
    sql(sweep[sweep.index('create function public.icash_settle_pending_dealmachine()'):sweep.index('revoke all on function public.icash_pending_opportunity_count')])
    old, eligible, rate = uid(1), uid(2), uid(100)
    sql(f"""
      update icash_work_private.dispatch_policy set enabled=true;
      insert into icash_accounts(id,owner_user_id,bot_paused) values('{old}','{old}',false),('{eligible}','{eligible}',false);
      insert into icash_wallets(account_id,balance_cents,reserved_cents) values('{old}',1000,0),('{eligible}',1000,0);
      insert into icash_operation_rates(id,operation,version,costs_micros,charge_cents,enabled,verified_at,expires_at)
       values('{rate}','property_search','synthetic','{{"dealmachine":250000}}',105,true,now()-interval '1 day',now()+interval '1 day');
      insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents,reserved_micros,dealmachine_cost_multiplier,data_unit_cost_micros,dispatched_at)
       values('synthetic-held-receipt','{old}','{rate}','dispatched',105,350000,3,10000,now());
      insert into icash_discovery_configs(account_id,enabled,auto_enabled,next_run_at,data_rights_until,contacts_enabled,rate_id,exhausted,max_open_prospects)
       values('{eligible}',true,true,now()-interval '1 minute',now()+interval '1 day',false,'{rate}',false,10);
      revoke all on function icash_next_acquisition() from public,anon,authenticated;
      grant execute on function icash_next_acquisition() to service_role;
    """)
    original = sql("select pg_get_functiondef('icash_next_acquisition()'::regprocedure);")
    before = sql("select to_jsonb(o) from icash_operation_spend o where operation_key='synthetic-held-receipt';")
    blocker = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        # Deliberately hold only the operation row. The shared financial budget
        # is an authoritative lock and remains unchanged by this migration.
        blocker.stdin.write("begin;set local statement_timeout='15s';do $$begin perform 1 from public.icash_operation_spend where operation_key='synthetic-held-receipt' for update;end$$;select 'receipt_locked';\n")
        blocker.stdin.flush()
        fixture.wait_for_marker(blocker, 'receipt_locked')
        try:
            sql("set lock_timeout='500ms';select icash_next_acquisition();")
            raise AssertionError('Expected original acquisition to wait on unrelated receipt')
        except AssertionError as error:
            assert 'lock timeout' in str(error), str(error)
        assert sql('select count(*) from icash_automation_tickets;') == '0'
        sql(read('config/acquisition-settlement-isolation.sql'))
        result = json.loads(sql("set lock_timeout='500ms';select icash_next_acquisition();"))
        assert result.get('token')
        assert sql(f"select account_id from icash_automation_tickets where token='{result['token']}';") == eligible
        assert sql("select to_jsonb(o) from icash_operation_spend o where operation_key='synthetic-held-receipt';") == before
        assert blocker.poll() is None, 'Other transaction must still own the receipt lock'
        sql('update icash_work_private.dispatch_policy set enabled=false;')
        try:
            sql("set lock_timeout='500ms';select icash_next_acquisition();")
            raise AssertionError('Expected compatible legacy settlement path')
        except AssertionError as error:
            assert 'lock timeout' in str(error), str(error)
    finally:
        if blocker.poll() is None:
            blocker.stdin.write('rollback;\n\\q\n')
            blocker.stdin.flush()
            blocker.wait(timeout=5)
        assert blocker.returncode == 0, blocker.stderr.read()
    sql(f"update icash_work_private.dispatch_policy set enabled=true;delete from icash_automation_tickets;update icash_discovery_configs set next_run_at=now()-interval '1 minute' where account_id='{eligible}';")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: sql('select coalesce(icash_next_acquisition()::text,\'null\');'), range(16)))
    assert sum(result != 'null' for result in results) == 1, results
    assert sql('select count(*) from icash_automation_tickets;') == '1'
    assert sql("select to_jsonb(o) from icash_operation_spend o where operation_key='synthetic-held-receipt';") == before
    assert sql('select count(*) from icash_credit_ledger;') == '0'
    for role in ['anon', 'authenticated']:
        assert sql(f"select has_function_privilege('{role}','icash_next_acquisition()','execute');") == 'f'
    patched = sql("select pg_get_functiondef('icash_next_acquisition()'::regprocedure);")
    migration = read('config/acquisition-settlement-isolation.sql')
    replacement = migration.split('replacement text:=$replacement$', 1)[1].split('$replacement$;', 1)[0]
    assert patched == original.replace(' perform public.icash_settle_pending_dealmachine();', replacement)
    print('PASS native acquisition isolation: locked historical receipt reproduces global selection failure; unrelated account progresses while original lock remains held; legacy fallback retained;16 concurrent issuers create one ticket; holds, balances and original selection unchanged.')


if __name__ == '__main__':
    run()
