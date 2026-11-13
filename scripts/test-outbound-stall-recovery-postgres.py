"""Disposable localhost races; no provider requests, credentials or production data."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import json
import os
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PORT = os.environ.get('ICASH_OUTBOUND_FIXTURE_PORT', '55443')
assert PORT in ('55443', '55457')
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', 'icash_reliability']
ENV = {**os.environ, 'PGPASSWORD': 'isolated-fixture-only', 'PGCONNECT_TIMEOUT': '5'}
def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='8s';set timezone='UTC';\n"+query, env=ENV, text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()
def read(path):
    return (ROOT/path).read_text()
def race(queries):
    start = Barrier(len(queries))
    def run(query):
        start.wait()
        return sql(query)
    with ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(run, queries))
def clean():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_reliability_private cascade;drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')

try:
    clean()
    sql(read('tests/fixtures/export-capacity-wait-foundation.sql'))
    sql(json.loads(read('tests/fixtures/export-capacity-wait-before.json'))['public.icash_next_acquisition()'])
    sql(read('config/export-capacity-wait-fairness.sql'))
    sql("create function icash_work_private.warm_seller_due(uuid) returns boolean language sql as $$select false$$;create function public.icash_acquisition_capacity_available(uuid) returns boolean language sql as $$select public.icash_dealmachine_capacity_available(2,$1)$$;")
    sql(read('tests/fixtures/outbound-acquisition-current.sql'))
    sql(read('config/outbound-quota-wait-aging.sql'))
    sql("select fixture_export_wait_seed(n,true,interval '12 minutes') from generate_series(1,8) n;update fixture_export_wait_policy set export_capacity='quota_wait';")
    due = sql('select jsonb_object_agg(account_id,next_run_at) from icash_discovery_configs;')
    claim = 'set role service_role;select coalesce(icash_next_acquisition()::text,\'null\');'
    assert race([claim]*8) == ['null']*8
    assert json.loads(sql('select jsonb_object_agg(account_id,waiting_since) from icash_work_private.acquisition_export_waits;')) == json.loads(due)
    sql("update fixture_export_wait_policy set export_capacity='ready';update icash_discovery_configs set next_run_at=now()-interval '1 second';")
    issued = [json.loads(x)['token'] for x in race([claim]*8)]
    assert len(set(issued)) == 8
    assert sql('select count(distinct account_id) from icash_automation_tickets;') == '8'
    assert sql("select count(*) from icash_operation_spend where operation_key<>'synthetic-unknown';") == '0'
    assert sql('select count(*) from icash_work_private.acquisition_export_waits;') == '0'
    clean()
    sql(read('tests/fixtures/reliability-reset-foundation.sql'))
    for name in ('workspace-experience-and-incidents', 'reliability-incident-severity', 'reliability-incident-stable-recovery', 'reliability-component-outages'):
        sql(read('config/'+name+'.sql'))
    sql("alter table icash_reliability_private.component_outages drop constraint component_outages_component_check;insert into icash_reliability_private.component_outages(component) values('account_progress');")
    sql(json.loads(read('tests/fixtures/outbound-recovery-before.json'))['icash_refresh_reliability_incident'])
    sql(read('config/reliability-email-reset.sql'))
    sql("insert into fixture_monitor select jsonb_build_object('status','degraded','fresh',true,'components',jsonb_build_object('worker',jsonb_build_object('status','ok'),'maintenance',jsonb_build_object('status','ok')),'snapshot',jsonb_build_object('checkedAt',now(),'issueCount',88,'issues','[]'::jsonb,'accountProgress',jsonb_build_object('checkedAt',now(),'affectedAccounts',88)));select icash_refresh_reliability_incident('ready');")
    notice = json.loads(sql('select icash_claim_reliability_notification_v2();'))
    sql(f"select icash_finish_reliability_notification('{notice['id']}','00000000-0000-4000-8000-000000000001');")
    before = sql('select jsonb_build_object(\'health\',(select report from fixture_monitor),\'incidents\',(select jsonb_agg(i) from icash_reliability_private.incidents i),\'notifications\',(select jsonb_agg(n) from icash_reliability_private.incident_notifications n));')
    args = "(select id from icash_reliability_private.incidents where recovered_at is null),(select (report->'snapshot'->>'checkedAt')::timestamptz from fixture_monitor),repeat('a',40)"
    reset = "select icash_reliability_private.reset_notification_baseline('owner-reset-native-fixture',"+args+');'
    assert race([reset]*16) == ['t']*16
    assert sql('select count(*) from icash_reliability_private.notification_baselines;') == '1'
    assert sql('select jsonb_build_object(\'health\',(select report from fixture_monitor),\'incidents\',(select jsonb_agg(i) from icash_reliability_private.incidents i),\'notifications\',(select jsonb_agg(n) from icash_reliability_private.incident_notifications n));') == before
    sql("insert into icash_reliability_private.incident_notifications(incident_id,event,revision,created_at) select id,'detected',2,(select (report->'snapshot'->>'checkedAt')::timestamptz-interval '1 second' from fixture_monitor) from icash_reliability_private.incidents where recovered_at is null;")
    reset2 = "select icash_reliability_private.reset_notification_baseline('owner-reset-claim-race',"+args+');'
    outcomes = race([reset2, 'set role service_role;select coalesce(icash_claim_reliability_notification_v2()::text,\'null\');'])
    assert outcomes[0] == 't'
    state = sql('select state from icash_reliability_private.incident_notifications where revision=2;')
    assert (outcomes[1] == 'null' and state == 'cancelled') or (outcomes[1] != 'null' and state == 'dispatching')
    assert sql('select count(*) from icash_reliability_private.incidents where recovered_at is null;') == '1'
    assert sql("select has_function_privilege('service_role','icash_reliability_private.reset_notification_baseline(text,uuid,timestamptz,text)','execute');") == 'f'
    print('PASS native outbound recovery: eight competing queue polls and fair resumptions; sixteen idempotent notification resets; claim/reset race; unchanged health, receipts and money.')
finally:
    clean()
