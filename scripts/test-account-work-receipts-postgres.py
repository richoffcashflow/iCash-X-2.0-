"""Inactive progress-v2 proof in one dedicated, disposable CI PostgreSQL 17 DB.

Fixed loopback/fixture credentials only. No configurable production URL, secrets,
provider calls, or resets of the shared icash_reliability fixture database.
"""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
DATABASE = "icash_receipt_progress_v2"
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres"]


def sql(query, database=DATABASE):
    result = subprocess.run(CMD + ["-d", database], input="set statement_timeout='12s';set timezone='UTC';\n"+query,
                            env=ENV, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def read(path):
    return (ROOT/path).read_text()


assert sql("select current_database()||':'||inet_server_port()||':'||current_setting('server_version_num')::int/10000", "icash_reliability") == 'icash_reliability:5432:17'
assert sql(f"select count(*) from pg_database where datname='{DATABASE}'", "icash_reliability") == '0', 'Dedicated fixture already exists; never reset another run'
sql(f'create database {DATABASE}', 'icash_reliability')
try:
    setup = subprocess.run(['node', '--input-type=module', '-e',
        "import {receiptProgressSetup} from './tests/helpers/receipt-progress-fixture.mjs';process.stdout.write(receiptProgressSetup());"],
        cwd=ROOT, capture_output=True, text=True, check=True).stdout
    sql(setup)
    before = sql('select fixture_progress_evidence()')
    public_before = sql("select pg_get_functiondef('public.icash_account_work_observations()'::regprocedure)")
    migration = read('config/account-work-receipts-v2.sql')
    # Full install rolled back first, in the same isolated native schema.
    sql(migration.removesuffix('commit;\n')+'rollback;')
    assert sql("select to_regprocedure('icash_reliability_private.account_work_observations_v2()')") == ''
    sql(migration)
    sql(read('tests/fixtures/receipt-progress-v2-assertions.sql'))
    with ThreadPoolExecutor(max_workers=12) as pool:
        assert set(pool.map(lambda _: sql('set role service_role;select reason from icash_reliability_private.account_work_observations_v2()'), range(36))) == {'pending_work'}
    assert sql('select fixture_progress_evidence()') == before
    assert sql("select pg_get_functiondef('public.icash_account_work_observations()'::regprocedure)") == public_before
    for role in ('anon', 'authenticated'):
        for signature in ('owner_work_output_v2(uuid,uuid,timestamptz)', 'account_work_receipts_v2(uuid,timestamptz)', 'account_work_observations_v2()'):
            assert sql(f"select has_function_privilege('{role}','icash_reliability_private.{signature}','execute')") == 'f'

    # 400 independently funded accounts and 80,000 settled costs must never be
    # mistaken for 80,000 outputs. The same full private reader has a time bound.
    sql("""insert into icash_accounts(id,owner_user_id,bot_paused,created_at,workspace_ack_version)
     select md5('progress-account-'||n)::uuid,md5('progress-account-'||n)::uuid,false,now()-interval '2 days','fixture' from generate_series(1,400)n;
     insert into icash_wallets(account_id,balance_cents,reserved_cents) select id,500,0 from icash_accounts where id<>'00000000-0000-4000-8000-000000000001';
     insert into icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,rate_id,contact_rate_id,data_rights_until)
     select id,true,true,true,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',now()+interval '1 day' from icash_accounts where id<>'00000000-0000-4000-8000-000000000001';
     insert into icash_operation_spend(operation_key,account_id,state,created_at,dispatched_at,settled_at,actual_micros,charged_cents)
     select 'fixture-history:'||id||':'||n,id,'settled',now()-interval '2 days',now()-interval '1 day',now(),10000,1
     from icash_accounts cross join generate_series(1,200)n where id<>'00000000-0000-4000-8000-000000000001';
     create table fixture_history as select a.id account_id,n,
      md5('receipt-history:'||a.id||':'||n)::uuid receipt_id
     from icash_accounts a cross join generate_series(1,25)n where a.id<>'00000000-0000-4000-8000-000000000001';
     insert into icash_operation_spend(operation_key,account_id,rate_id,state,created_at,dispatched_at,settled_at)
     select kind||':'||receipt_id,account_id,'00000000-0000-4000-8000-000000000002','settled',now()-interval '2 days',now()-interval '25 hours',now()
     from fixture_history cross join unnest(array['search','voice','text'])kind;
     insert into icash_operation_spend(operation_key,account_id,rate_id,state,created_at,dispatched_at,settled_at)
     select 'owners:'||account_id||':'||receipt_id,account_id,'00000000-0000-4000-8000-000000000003','settled',now()-interval '47 hours',now()-interval '25 hours',now() from fixture_history;
     insert into icash_discovery_results select 'search:'||receipt_id,account_id,jsonb_build_object('rows','[]'::jsonb,'fetchedAt',now()-interval '24 hours 30 minutes'),now()-interval '24 hours' from fixture_history;
     insert into icash_voice_jobs select receipt_id,account_id,'voice:'||receipt_id,'CA_fixture_'||receipt_id,'ended_before_recording' from fixture_history;
     insert into icash_call_recordings select receipt_id,account_id,receipt_id,'voice:'||receipt_id,'CA_fixture_'||receipt_id,now()-interval '24 hours',null,'ended_before_recording',now()-interval '25 hours' from fixture_history;
     insert into icash_text_messages(id,account_id,provider_id,state,direction,created_at) select receipt_id,account_id,'text_fixture_'||receipt_id,'accepted','outgoing',now()-interval '26 hours' from fixture_history;
     insert into icash_owner_contacts select receipt_id,account_id,'owners:'||account_id||':'||receipt_id,
      jsonb_build_object('fetchedAt',now()-interval '2 days','contacts','[]'::jsonb,'requestedPersonIds',jsonb_build_array('per_fixture'),
       'providerCredits',jsonb_build_object('used',0,'people',0,'properties',0,'deduplicated',0),'creditsUsed',0,'peopleCredits',0,'outreachAuthorized',false),
      now()-interval '24 hours' from fixture_history;
     analyze;""")
    started = time.monotonic()
    assert sql('set role service_role;select count(*) from icash_reliability_private.account_work_observations_v2()') == '401'
    assert time.monotonic()-started < 8, '401-account comparison reader exceeded 8-second native budget'
    # Parameterized generic-plan readers also preserve the late-settlement gap.
    assert sql("set role service_role;set plan_cache_mode=force_generic_plan;prepare receipt_read(uuid) as select last_completed_output_at<now()-interval '23 hours' and last_attempted_outreach_at<now()-interval '23 hours' from icash_reliability_private.account_work_receipts_v2($1,now());execute receipt_read(md5('progress-account-1')::uuid)") == 't'
    print('PASS PostgreSQL17 receipt progress v2: 36 concurrent readers, 401 accounts/80000 cost-only plus 40000 source-bound operations, original source regressions, private permissions, unchanged public/financial state and install rollback. Inactive only; no paid providers.')
finally:
    # Only the database created above by this run; shared fixtures are untouched.
    sql(f'drop database {DATABASE}', 'icash_reliability')
