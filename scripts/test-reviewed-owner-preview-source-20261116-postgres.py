"""Native owner-preview proof races on the fixed disposable PostgreSQL target.

The original migration and forward correction execute byte-for-byte. Only after
their guards pass is the public pool digest adapted to a fictional row.
Source, locking, stage, activation and financial functions are shipped bodies.
Request INSERTs project the canonical request-budget lock protocol, not the full
provider admission RPC. No provider, production database or paid test is used.
Run exclusively: this suite rebuilds localhost:55443/icash_reliability schemas.
"""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import time

from disposable_planning_postgres_target import (
    PSQL_COMMAND, fixture_environment, assert_fixture_client, assert_fixture_identity,
)

ROOT = Path(__file__).resolve().parents[1]
ENV = fixture_environment(os.environ)
CMD = list(PSQL_COMMAND)
ACCOUNT = '10000000-0000-4000-8000-000000000001'
RATE = '10000000-0000-4000-8000-000000000011'
BATCH = '20000000-0000-4000-8000-000000000001'
PREVIEW = '20000000-0000-4000-8000-000000000002'
EXTRA = '20000000-0000-4000-8000-000000000003'
KEY = 'owner-batch:' + BATCH
RELEASE = 'b' * 40
DIGEST = '2684b0bdd601bf9a63b4a1cc45cde4cc582404fefa830e47cafd4711de6dc322'
SCHEMA = 'icash_reliability_private.'
POLICY = SCHEMA + 'pending_work_relief_policy_20261116'
ROWS = SCHEMA + 'pending_work_relief_20261116'
DECISIONS = SCHEMA + 'pending_work_relief_activation_20261116'
CHECK = SCHEMA + 'pending_work_relief_idle_source_20261116'
LOCK = SCHEMA + 'pending_work_relief_lock_source_20261116'
BASE = subprocess.check_output(
    ['node', str(ROOT / 'tests/helpers/reviewed-planning-relief-20261116-fixture.mjs'), '--emit-base'],
    cwd=ROOT, text=True,
)


def sql(query):
    assert_fixture_client(CMD, ENV)
    result = subprocess.run(CMD, input="set statement_timeout='8s';set timezone='UTC';\n" + query,
                            env=ENV, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def jsql(value):
    return quote(json.dumps(value, separators=(',', ':'))) + '::jsonb'


def refused(query, fragments):
    started = time.monotonic()
    try:
        sql(query)
    except AssertionError as error:
        assert any(word.lower() in str(error).lower() for word in fragments), str(error)
        assert time.monotonic() - started < 2, 'Proof contention must refuse promptly'
        return str(error).lower()
    raise AssertionError('Expected refusal: ' + query[:160])


@contextmanager
def locked(query, commit=False):
    """Wait for a SQL marker proving the transaction holds its locks."""
    assert_fixture_client(CMD, ENV)
    process = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV)
    try:
        process.stdin.write(("set statement_timeout='8s';set timezone='UTC';begin;" + query + ";select 'PREVIEW_LOCK_READY';\n").encode())
        process.stdin.flush()
        pending = b''
        deadline = time.monotonic() + 5
        while b'PREVIEW_LOCK_READY\n' not in pending:
            assert time.monotonic() < deadline, 'Fixture lock holder did not become ready'
            if process.poll() is not None:
                raise AssertionError(process.stderr.read().decode())
            if select.select([process.stdout], [], [], 0.1)[0]:
                pending += os.read(process.stdout.fileno(), 65536)
        yield
        process.stdin.write(('commit;\n' if commit else 'rollback;\n').encode())
        process.stdin.close()
        assert process.wait(timeout=10) == 0, process.stderr.read().decode()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def source():
    return json.loads(sql(f"select coalesce({CHECK}(o),'null'::jsonb) from public.icash_operation_spend o where operation_key='fixture-original';"))


def stage(pool, selected):
    return f'select {SCHEMA}stage_pending_work_relief_20261116({jsql(pool)},{jsql(selected)},{quote(RELEASE)});'


def activate(manifest):
    return f'select {SCHEMA}activate_pending_work_relief_20261116({quote(manifest)},{quote(RELEASE)});'


def snapshot():
    tables = [
        'public.icash_accounts', 'public.icash_wallets', 'public.icash_operation_spend',
        'public.icash_credit_reservations', 'public.icash_operating_budget',
        'public.icash_credit_ledger', 'public.icash_usage_coverage',
        'icash_research_private.requests', 'icash_research_private.owner_batches',
        'icash_research_private.owner_batch_items', 'icash_research_private.owner_exports',
        SCHEMA + 'pending_work_relief_policy', SCHEMA + 'pending_work_relief',
        SCHEMA + 'pending_work_relief_policy_20261113', SCHEMA + 'pending_work_relief_20261113',
    ]
    return {table: json.loads(sql(f"select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from {table} t;")) for table in tables}


def function_security():
    return json.loads(sql(f"""select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
      'owner',pg_get_userbyid(p.proowner),'acl',p.proacl,'securityDefiner',p.prosecdef,
      'configuration',p.proconfig,'volatility',p.provolatile,'parallel',p.proparallel) order by p.oid)
      from pg_proc p where p.oid in ('{CHECK}(public.icash_operation_spend)'::regprocedure,
      '{LOCK}(public.icash_operation_spend)'::regprocedure);"""))


def setup(preview=True):
    assert_fixture_identity(json.loads(sql("select jsonb_build_object('database',current_database(),'user',current_user,'application',current_setting('application_name'),'port',inet_server_port());")))
    sql('drop schema if exists icash_reliability_private cascade;drop schema if exists icash_work_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_text_receipt_private cascade;drop schema public cascade;create schema public;')
    sql(BASE)
    sql((ROOT / 'tests/fixtures/reviewed-planning-relief-source-locks.sql').read_text())
    sql('create index research_requests_operation_started on icash_research_private.requests(operation_key,created_at) where admitted;')
    sql(f"""
    update public.icash_operation_rates set operation='owner_enrichment' where id='{RATE}';
    update public.icash_accounts set workspace_ack_version='SYNTHETIC accepted workspace' where id='{ACCOUNT}';
    insert into public.icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents)
    values('{ACCOUNT}',true,true,true,'90210','{RATE}',10000,now()+interval '1 day',0);
    insert into icash_research_private.owner_batches(id,account_id,primary_screening,state,created_at,items,preview_receipt)
    values('{BATCH}','{ACCOUNT}','{BATCH}','claimed','2026-11-14T01:57Z','[]','{{}}');
    insert into icash_research_private.owner_batch_items(screening_id,batch_id,operation_key)
    values('{BATCH}','{BATCH}','fixture-original');
    insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result)
    values('{BATCH}','owner_lookup','{ACCOUNT}','{KEY}',true,'2026-11-14T02:00Z','2026-11-14T02:01Z','{{"outcome":"unknown"}}');
    insert into icash_research_private.owner_exports(id,request,recovery_history,recovery_attempts)
    values('{BATCH}','{{}}','[]',0);
    """)
    if preview:
        sql(f"""insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result)
        values('{PREVIEW}','owner_preview','{ACCOUNT}','{KEY}',true,'2026-11-14T01:58Z','2026-11-14T01:59Z','{{"outcome":"response","httpStatus":200,"creditsUsed":0}}');""")
    pool = json.loads(sql("""select jsonb_agg(jsonb_build_object('operation_key',o.operation_key,'account_id',o.account_id,
      'source_sha256',encode(sha256(convert_to((to_jsonb(o)-'estimate_checked_at')::text,'UTF8')),'hex')))
      from public.icash_operation_spend o where operation_key='fixture-original';"""))
    canonical = '\n'.join(sorted(x['operation_key'] + '\t' + x['account_id'] + '\t' + x['source_sha256'] for x in pool))
    original = (ROOT / 'config/reviewed-planning-relief-20261116.sql').read_text()
    assert hashlib.sha256(original.encode()).hexdigest() == '3796f836f899bb71f8e9a09416a168b3e4fc3d477d3aa96c8ded539ae7694f93'
    assert original.count(DIGEST) == 1
    sql('begin;' + original + 'commit;')
    assert (source() is None) == preview, 'Reproduce original completed-preview rejection and no-preview acceptance'
    before = snapshot()
    security_before = function_security()
    correction = (ROOT / 'config/reviewed-owner-preview-source-20261116.sql').read_text()
    copies = list((ROOT / 'supabase/migrations').glob('*_reviewed_owner_preview_source_20261116.sql'))
    assert len(copies) == 1 and copies[0].read_text() == correction, 'Execute exact canonical forward migration'
    sql('begin;' + correction + 'commit;')
    assert snapshot() == before, 'Forward correction never changes original evidence, money or older relief'
    assert function_security() == security_before, 'Exact function owner/ACL/security/configuration preserved'
    assert source() is not None, 'Actual corrected source accepts coherent completed preview or no preview'
    # All 18 real predecessor hashes must pass before adapting this one public
    # scalar. The stage/activation/source/lock logic and every other byte remain.
    pool_definition = sql(f"select pg_get_functiondef('{SCHEMA}relief_pool_sha_20261116()'::regprocedure);")
    assert pool_definition.count(DIGEST) == 1
    sql(pool_definition.replace(DIGEST, hashlib.sha256(canonical.encode()).hexdigest()))
    selected = json.loads(sql(f"""select jsonb_agg(jsonb_build_object('operation_key',o.operation_key,
      'idle_source_sha256',encode(sha256(convert_to({CHECK}(o)::text,'UTF8')),'hex')))
      from public.icash_operation_spend o where operation_key='fixture-original';"""))
    assert sql(f"select {SCHEMA}pending_work_relief_controls_20261116('{ACCOUNT}');") == 't'
    return pool, selected


def blocked_writer(query, relation):
    error = refused("begin;set local lock_timeout='150ms';" + query + ';rollback;', ('lock timeout',))
    assert relation in error, error


def request_writer(kind):
    # Exact first lock from take_reserved_request in research-request-pacing.sql.
    # This projection proves insertion serialization, not complete paid admission.
    return f"""select 1 from public.icash_dealmachine_request_budget where id=1 for update;
      insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result)
      values('{EXTRA}','{kind}','{ACCOUNT}','{KEY}',true,'2026-11-14T01:58Z','2026-11-14T01:59Z','{{"outcome":"response","httpStatus":200,"creditsUsed":0}}')"""


# Both legitimate historical shapes execute the complete canonical correction.
setup(preview=False)
pool, selected = setup()
original = snapshot()
valid_source = source()
for change in ["kind='owner_lookup'", "finished_at=null", "finished_at='2026-11-14T02:00:01Z'",
               "created_at='2026-11-14T02:01Z'", "result='{}'", "result='{\"outcome\":\"unknown\"}'",
               "result=result||'{\"creditsUsed\":1}'::jsonb", "result=result-'creditsUsed'",
               "result=result||'{\"creditsUsed\":\"0\"}'::jsonb", "result=result||'{\"httpStatus\":500}'::jsonb"]:
    # A committed source change must fail closed; restore only this local fixture.
    saved = sql(f"select to_jsonb(q) from icash_research_private.requests q where id='{PREVIEW}';")
    sql(f"update icash_research_private.requests set {change} where id='{PREVIEW}';")
    assert source() is None, change
    sql(f"delete from icash_research_private.requests where id='{PREVIEW}';insert into icash_research_private.requests select * from jsonb_populate_record(null::icash_research_private.requests,{quote(saved)}::jsonb);")
assert source() == valid_source
for kind in ('owner_lookup', 'owner_preview'):
    sql(request_writer(kind) + ';')
    assert source() is None, 'An additional ' + kind + ' still refuses relief'
    sql(f"delete from icash_research_private.requests where id='{EXTRA}';")
assert snapshot() == original

# A full preview receipt is fingerprinted, even when its eligibility stays true.
sql(f"update icash_research_private.requests set result=result||'{{\"dayRemaining\":9000}}'::jsonb where id='{PREVIEW}';")
assert source() is not None and source() != valid_source
sql(f"update icash_research_private.requests set result=result-'dayRemaining' where id='{PREVIEW}';")
assert source() == valid_source

# Writer first: NOWAIT must refuse both UPDATE and DELETE, with no partial seal.
for mutation in [f"update icash_research_private.requests set result='{{\"outcome\":\"unknown\"}}' where id='{PREVIEW}'",
                 f"delete from icash_research_private.requests where id='{PREVIEW}'",
                 f"select 1 from icash_research_private.requests where id='{PREVIEW}' for update"]:
    with locked(mutation):
        refused(stage(pool, selected), ('could not obtain lock', 'lock timeout'))
    assert sql(f'select count(*) from {POLICY};') == '0'
    assert sql(f'select count(*) from {ROWS};') == '0'
with locked(request_writer('owner_preview')):
    refused(stage(pool, selected), ('could not obtain lock', 'lock timeout'))
assert snapshot() == original

# The exact shipped lock helper independently retains the accepted preview row.
row_writers = [f"update icash_research_private.requests set result='{{\"outcome\":\"unknown\"}}' where id='{PREVIEW}'",
               f"delete from icash_research_private.requests where id='{PREVIEW}'"]
with locked(f"select {LOCK}(o) from public.icash_operation_spend o where operation_key='fixture-original'"):
    for writer in row_writers:
        blocked_writer(writer, 'requests')
for writer in row_writers:
    sql('begin;' + writer + ';rollback;')

# Stage and activation must keep both preview UPDATE fences and quota INSERT
# fences until transaction end. Each writer succeeds after release and rolls back.
insert_writers = [request_writer('owner_preview'), request_writer('owner_lookup')]
with locked(stage(pool, selected), commit=True):
    for writer in row_writers:
        blocked_writer(writer, 'requests')
    for writer in insert_writers:
        blocked_writer(writer, 'icash_dealmachine_request_budget')
for writer in row_writers + insert_writers:
    sql('begin;' + writer + ';rollback;')
assert snapshot() == original
manifest = sql(f'select manifest_sha256 from {POLICY};')
for writer in row_writers + [request_writer('owner_preview')]:
    with locked(writer):
        refused(activate(manifest), ('could not obtain lock', 'lock timeout'))
    assert sql(f'select count(*) from {DECISIONS};') == '0'
with locked(activate(manifest), commit=True):
    for writer in row_writers:
        blocked_writer(writer, 'requests')
    for writer in insert_writers:
        blocked_writer(writer, 'icash_dealmachine_request_budget')
for writer in row_writers + insert_writers:
    sql('begin;' + writer + ';rollback;')
assert snapshot() == original
assert sql(f'select eligible from {DECISIONS};') == 't'
assert sql("select icash_reliability_private.pending_planning_cents(o) from public.icash_operation_spend o where operation_key='fixture-original';") == '0'

for role in ('anon', 'authenticated', 'service_role'):
    for signature in [CHECK + '(public.icash_operation_spend)', LOCK + '(public.icash_operation_spend)',
                      SCHEMA + 'stage_pending_work_relief_20261116(jsonb,jsonb,text)',
                      SCHEMA + 'activate_pending_work_relief_20261116(text,text)']:
        assert sql(f"select has_function_privilege('{role}',{quote(signature)},'execute');") == 'f'
    for table in (POLICY, ROWS, DECISIONS):
        assert sql(f"select has_table_privilege('{role}','{table}','insert,update,delete,truncate');") == 'f'
        assert sql(f"select relrowsecurity from pg_class where oid='{table}'::regclass;") == 't'

# Source changes after staging never silently alter the immutable selection.
for mutation in [f"update icash_research_private.requests set result=result||'{{\"dayRemaining\":9000}}'::jsonb where id='{PREVIEW}'",
                 f"delete from icash_research_private.requests where id='{PREVIEW}'",
                 request_writer('owner_preview'), request_writer('owner_lookup')]:
    pool, selected = setup()
    sql(stage(pool, selected))
    manifest = sql(f'select manifest_sha256 from {POLICY};')
    sql(mutation + ';')
    result = json.loads(sql(activate(manifest)))
    assert result['eligibleOperations'] == 0 and result['excludedOperations'] == 1 and result['enabled'] is False
    assert sql(f'select reason from {DECISIONS};') == 'source_changed'
    assert sql("select icash_reliability_private.pending_planning_cents(o) from public.icash_operation_spend o where operation_key='fixture-original';") == '100'

print('PASS native owner-preview correction: original rejection reproduced; shipped corrected source, complete preview identity, unchanged paid duplicate guards, NOWAIT UPDATE/DELETE races, stage/activation request-budget INSERT fences, post-stage drift exclusion, private permissions and unchanged original money/evidence. Request writers project canonical lock protocol; no provider RPC is exercised.')
