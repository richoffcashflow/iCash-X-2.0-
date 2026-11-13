"""Unstarted-call recovery races on the fixed disposable localhost database."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
from threading import Barrier
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql
before = json.loads((ROOT/'tests/fixtures/automatic-outreach-before.json').read_text())
RECOVER = "set role service_role;select public.icash_recover_voice_configuration('agent_fixture',repeat('a',64),repeat('a',64),repeat('b',40),clock_timestamp());"
A = '00000000-0000-4000-8000-000000000001'
S = '00000000-0000-4000-8000-000000000002'


def setup():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_text_receipt_private cascade;drop schema if exists icash_recording_private cascade;drop schema public cascade;create schema public;')
    for path in ['tests/fixtures/voice-configuration-recovery-foundation.sql',
                 'config/unstarted-voice-configuration-recovery.sql',
                 'config/voice-configuration-recovery-schema-access.sql']:
        sql((ROOT/path).read_text())
    sql(before['selector'])
    sql((ROOT/'tests/fixtures/automatic-outreach-foundation.sql').read_text())
    sql(before['recovery'])
    sql((ROOT/'config/automatic-outreach-bottlenecks.sql').read_text())
    sql(f"""
      alter role service_role bypassrls;
      grant usage on schema public,icash_text_receipt_private to service_role;
      grant select on all tables in schema public to service_role;
      grant update on icash_operating_budget,icash_voice_jobs to service_role;
      insert into icash_accounts(id) values('{A}');
      insert into icash_wallets(account_id) values('{A}');
      insert into icash_voice_configs(account_id,agent_config_hash) values('{A}',repeat('a',64));
      insert into icash_voice_production_template(id,agent_config_hash) values(1,repeat('a',64));
      insert into icash_screening_jobs(id,account_id) values('{S}','{A}');
      insert into icash_text_senders values('+15127791343',true),('+18623812530',true);
      insert into icash_business_voice_numbers values('+15127791343',false,true,null),('+18623812530',true,true,'PN'||repeat('b',32));
    """)


def seed(n, key=None):
    job = f'00000000-0000-4000-8000-{n:012d}'
    key = key or 'person-'+str(n)
    sql(f"""insert into icash_voice_contact_targets(id,account_id,screening_id,contact_key) values('{job}','{A}','{S}','{key}');
      insert into icash_voice_jobs(id,account_id,operational_contact_id,outcome) values('{job}','{A}','{job}','business_number_verification_required');
      insert into icash_automation_tickets(id,account_id,voice_job_id,outcome) values('{job}','{A}','{job}','business_number_verification_required');""")
    return job


def race():
    start = Barrier(2)
    def contender():
        start.wait()
        return int(sql(RECOVER))
    with ThreadPoolExecutor(max_workers=2) as pool:
        return sorted(pool.map(lambda _: contender(), range(2)))


setup()
job = seed(10)
ticket = sql('select jsonb_agg(t) from icash_automation_tickets t;')
assert race() == [0, 1], 'Concurrent maintenance recovers a job exactly once'
assert sql('select count(*) from icash_recording_private.configuration_recoveries;') == '1'
assert sql('select jsonb_agg(t) from icash_automation_tickets t;') == ticket
assert sql('select count(*) from icash_operation_spend;') == '0'
assert sql('select balance_cents from icash_wallets;') == '10000'
sql(f"update icash_voice_jobs set state='held',outcome='business_number_verification_required' where id='{job}';")
assert race() == [0, 0], 'Repeated maintenance cannot loop after another failure'

setup()
seed(10, 'shared-person')
seed(11, 'shared-person')
assert race() == [0, 1], 'One recipient across different jobs gets one queued call'

for mutation in ["update icash_accounts set bot_paused=true;",
                 "update icash_wallets set reserved_cents=balance_cents;",
                 "update icash_business_voice_numbers set outbound_enabled=false;",
                 "insert into icash_text_suppressions values('+12025550101');",
                 "insert into icash_operation_spend select 'voice:'||id,'dispatched' from icash_voice_jobs;"]:
    setup()
    seed(10)
    with ThreadPoolExecutor(max_workers=2) as pool:
        control = pool.submit(sql, "set application_name='outreach-control-race';begin;select id from icash_operating_budget where id=1 for update;select pg_sleep(0.6);"+mutation+'commit;')
        deadline = time.monotonic()+3
        while sql("select count(*) from pg_stat_activity where application_name='outreach-control-race' and wait_event='PgSleep';") != '1':
            assert time.monotonic() < deadline, 'Control transaction did not acquire the original admission lock'
            time.sleep(0.02)
        recovered = pool.submit(sql, RECOVER)
        control.result()
        assert recovered.result() == '0', mutation
    assert sql('select count(*) from icash_recording_private.configuration_recoveries;') == '0'
print('PASS native automatic outreach: concurrent once-only recovery, shared-recipient fence, Pause, reserved wallet, disabled route, STOP and unknown admission races; no provider calls or charges.')
