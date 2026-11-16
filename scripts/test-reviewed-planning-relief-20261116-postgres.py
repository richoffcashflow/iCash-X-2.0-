"""Native races on disposable localhost:55443/icash_reliability only; no providers.

Run exclusively: this suite rebuilds the shared local fixture database schemas.
Generic lifecycle cases use explicit synthetic source/control gates. The final
source-lock cases use shipped predicates and actual FK relationships on minimal
source projections. Request/estimate writers model only their lock protocol;
the full canonical request/estimate RPCs are not executed. Credit, final spend
guard, reserve chain and settlement functions use captured production bodies.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
from threading import Barrier
import time
from disposable_planning_postgres_target import PSQL_COMMAND, fixture_environment, assert_fixture_client, assert_fixture_identity

ROOT = Path(__file__).resolve().parents[1]
ENV = fixture_environment(os.environ)
CMD = list(PSQL_COMMAND)
ACCOUNT = '10000000-0000-4000-8000-000000000001'
RATE = '10000000-0000-4000-8000-000000000011'
RELEASE = 'b' * 40
DIGEST = '2684b0bdd601bf9a63b4a1cc45cde4cc582404fefa830e47cafd4711de6dc322'
POLICY = 'icash_reliability_private.pending_work_relief_policy_20261116'
ROWS = 'icash_reliability_private.pending_work_relief_20261116'
DECISIONS = 'icash_reliability_private.pending_work_relief_activation_20261116'
HELPER = ROOT / 'tests/helpers/reviewed-planning-relief-20261116-fixture.mjs'


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


def stage(pool, selected):
    return f'select icash_reliability_private.stage_pending_work_relief_20261116({jsql(pool)},{jsql(selected)},{quote(RELEASE)});'


def activate(manifest):
    return f'select icash_reliability_private.activate_pending_work_relief_20261116({quote(manifest)},{quote(RELEASE)});'


def rollback(manifest):
    return f'select icash_reliability_private.rollback_pending_work_relief_20261116({quote(manifest)},{quote(RELEASE)});'


def admit(key):
    return f"set role service_role;select public.icash_reserve_operation('{ACCOUNT}',{quote(key)},'{RATE}',now()+interval '1 day',null,false);"


def refused(query, fragments):
    try:
        sql(query)
    except AssertionError as error:
        assert any(word.lower() in str(error).lower() for word in fragments), str(error)
        return
    raise AssertionError('Expected refusal: ' + query[:180])


def marker(process):
    pending = b''
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(process.stderr.read().decode())
        if select.select([process.stdout], [], [], 0.1)[0]:
            pending += os.read(process.stdout.fileno(), 65536)
            if b'RELIEF_LOCK_READY\n' in pending:
                return
    raise AssertionError('Fixture lock holder did not become ready')


@contextmanager
def locked(query, commit=False):
    """Hold deterministic row/table state; never infer a race from a sleep."""
    assert_fixture_client(CMD, ENV)
    process = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV)
    try:
        process.stdin.write(("set statement_timeout='8s';set timezone='UTC';begin;" + query + ";select 'RELIEF_LOCK_READY';\n").encode())
        process.stdin.flush()
        marker(process)
        yield process
        process.stdin.write(('commit;\n' if commit else 'rollback;\n').encode())
        process.stdin.close()
        assert process.wait(timeout=10) == 0, process.stderr.read().decode()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def parallel(count, action):
    barrier = Barrier(count)
    def run(index):
        barrier.wait(timeout=10)
        return action(index)
    with ThreadPoolExecutor(max_workers=count) as executor:
        return list(executor.map(run, range(count)))


def attempt(query, expected=('could not obtain lock', 'lock timeout', 'one-use', 'already', 'Prospecting budget reached', 'terminal')):
    try:
        result = sql(query)
        return json.loads(result) if result.startswith('{') else result
    except AssertionError as error:
        assert any(word.lower() in str(error).lower() for word in expected), str(error)
        return None


BASE = subprocess.check_output(['node', str(HELPER), '--emit-base'], cwd=ROOT, text=True)
GATES = subprocess.check_output(['node', str(HELPER), '--emit-gates'], cwd=ROOT, text=True)
PEER = subprocess.check_output(['node', str(HELPER), '--emit-peer'], cwd=ROOT, text=True)


def real_source_seed(kind):
    """Fictional old evidence for the actual shipped per-kind source helpers."""
    identifier = '20000000-0000-4000-8000-000000000001'
    key = ('voice:' if kind == 'seller_call' else 'text:') + identifier if kind in ('seller_call', 'sms_send') else 'fixture-original'
    stamp = "'2026-11-14T02:00Z'::timestamptz"
    common = f"""
    update public.icash_operation_rates set operation={quote(kind)} where id='{RATE}';
    update public.icash_operation_spend set operation_key={quote(key)} where operation_key='fixture-original';
    update public.icash_credit_reservations set operation_key={quote(key)} where operation_key='fixture-original';
    update public.fixture_relief_sources set operation_key={quote(key)} where operation_key='fixture-original';
    update public.icash_accounts set workspace_ack_version='SYNTHETIC accepted workspace' where id='{ACCOUNT}';
    insert into public.icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents)
    values('{ACCOUNT}',true,true,true,'90210','{RATE}',10000,now()+interval '1 day',0);
    """
    if kind == 'owner_enrichment':
        evidence = f"""
        insert into icash_research_private.owner_batches(id,account_id,primary_screening,state,created_at,items,preview_receipt)
        values('{identifier}','{ACCOUNT}','{identifier}','claimed',{stamp},'[]','{{}}');
        insert into icash_research_private.owner_batch_items(screening_id,batch_id,operation_key)
        values('{identifier}','{identifier}',{quote(key)});
        insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result)
        values('{identifier}','owner_lookup','{ACCOUNT}','owner-batch:{identifier}',true,{stamp},{stamp},'{{"outcome":"unknown"}}');
        insert into icash_research_private.owner_exports(id,request,recovery_history,recovery_attempts)
        values('{identifier}','{{}}','[]',0);
        """
    elif kind == 'seller_call':
        evidence = f"""
        insert into public.icash_voice_jobs(id,account_id,permission_id,state,outcome,operation_key,created_at,updated_at)
        values('{identifier}','{ACCOUNT}','{identifier}','held','recording_admission_held',{quote(key)},{stamp},{stamp});
        insert into public.icash_automation_tickets(id,account_id,kind,state,voice_job_id,created_at,expires_at,completed_at)
        values('{identifier}','{ACCOUNT}','voice_dispatch','held','{identifier}',{stamp},{stamp},{stamp});
        """
    elif kind == 'sms_send':
        evidence = f"""
        insert into public.icash_text_messages(id,account_id,direction,state,created_at,updated_at)
        values('{identifier}','{ACCOUNT}','outgoing','dispatching',{stamp},{stamp});
        insert into public.icash_automation_tickets(id,account_id,kind,state,opener_message_id,created_at,expires_at,completed_at)
        values('{identifier}','{ACCOUNT}','seller_opener','held','{identifier}',{stamp},{stamp},{stamp});
        """
    else:
        assert kind == 'property_search'
        evidence = f"""
        insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result)
        values('{identifier}','property_search','{ACCOUNT}',{quote(key)},true,{stamp},{stamp},'{{"outcome":"unknown"}}');
        """
    return common + evidence


def setup(peer=False, real_kind=None):
    assert_fixture_identity(json.loads(sql("select jsonb_build_object('database',current_database(),'user',current_user,'application',current_setting('application_name'),'port',inet_server_port());")))
    sql('drop schema if exists icash_reliability_private cascade;drop schema if exists icash_work_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_text_receipt_private cascade;drop schema public cascade;create schema public;')
    sql(BASE)
    if peer:
        sql(PEER)
    if real_kind:
        sql((ROOT / 'tests/fixtures/reviewed-planning-relief-source-locks.sql').read_text())
        sql(real_source_seed(real_kind))
    pool = json.loads(sql("""select jsonb_agg(jsonb_build_object('operation_key',o.operation_key,'account_id',o.account_id,
      'source_sha256',encode(sha256(convert_to((to_jsonb(o)-'estimate_checked_at')::text,'UTF8')),'hex')) order by o.operation_key collate "C")
      from public.icash_operation_spend o join public.fixture_relief_sources s using(operation_key);"""))
    canonical = '\n'.join(sorted(p['operation_key'] + '\t' + p['account_id'] + '\t' + p['source_sha256'] for p in pool))
    source = (ROOT / 'config/reviewed-planning-relief-20261116.sql').read_text()
    assert source.count(DIGEST) == 1, 'Only the public scalar digest is adapted to synthetic data'
    sql('begin;' + source.replace(DIGEST, hashlib.sha256(canonical.encode()).hexdigest()) + 'commit;')
    if not real_kind:
        sql(GATES)
    selected = json.loads(sql("""select jsonb_agg(jsonb_build_object('operation_key',o.operation_key,
      'idle_source_sha256',encode(sha256(convert_to(icash_reliability_private.pending_work_relief_idle_source_20261116(o)::text,'UTF8')),'hex')) order by o.operation_key collate "C")
      from public.icash_operation_spend o join public.fixture_relief_sources s using(operation_key);"""))
    assert all(item['idle_source_sha256'] is not None for item in selected), 'Every fixture original must have positive source proof'
    return pool, selected


def accounting():
    return json.loads(sql("""select jsonb_build_object(
      'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from public.icash_wallets w),
      'accounts',(select jsonb_agg(to_jsonb(a) order by id) from public.icash_accounts a),
      'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from public.icash_operation_spend o),
      'credits',(select jsonb_agg(to_jsonb(c) order by operation_key) from public.icash_credit_reservations c),
      'budget',(select to_jsonb(b) from public.icash_operating_budget b),
      'oldPolicy',(select to_jsonb(p) from icash_reliability_private.pending_work_relief_policy p),
      'oldRows',(select jsonb_agg(to_jsonb(r) order by operation_key) from icash_reliability_private.pending_work_relief r),
      'nov13Policy',(select to_jsonb(p) from icash_reliability_private.pending_work_relief_policy_20261113 p),
      'nov13Rows',(select jsonb_agg(to_jsonb(r) order by operation_key) from icash_reliability_private.pending_work_relief_20261113 r));"""))


pool, selected = setup()
original = accounting()
for held in ["select 1 from public.icash_operating_budget where id=1 for update",
             "select 1 from public.icash_dealmachine_request_budget where id=1 for update",
             "select 1 from public.icash_operation_spend where operation_key='fixture-original' for update",
             "select 1 from public.fixture_relief_sources where operation_key='fixture-original' for update",
             f"select 1 from public.icash_wallets where account_id='{ACCOUNT}' for update",
             "update public.icash_credit_reservations set status='released' where operation_key='fixture-original'"]:
    with locked(held):
        refused(stage(pool, selected), ('could not obtain lock', 'lock timeout'))
    assert sql(f'select count(*) from {POLICY};') == '0'
    assert sql(f'select count(*) from {ROWS};') == '0'
refused('begin isolation level repeatable read;' + stage(pool, selected), ('READ COMMITTED',))

# A privileged INSERT already in flight must conflict with the stage/seal lock.
with locked(f"insert into {ROWS} select o.operation_key,o.account_id,to_jsonb(o)-'estimate_checked_at',to_jsonb(s) from public.icash_operation_spend o join public.fixture_relief_sources s using(operation_key)"):
    refused(stage(pool, selected), ('could not obtain lock', 'lock timeout', 'one-use'))
assert sql(f'select count(*) from {ROWS};') == '0'
results = parallel(16, lambda _: attempt(stage(pool, selected)))
assert sum(isinstance(r, dict) and r.get('staged') is True for r in results) == 1
assert accounting() == original, 'Competing capture never changes the original financial state'
manifest = sql(f'select manifest_sha256 from {POLICY};')
assert sql(f'select count(*) from {ROWS};') == '1'
for mutation in [f"insert into {ROWS} select 'late-row',account_id,operation_snapshot,source_snapshot from {ROWS}",
                 f'delete from {ROWS}', f'truncate {ROWS} cascade', f"update {ROWS} set source_snapshot='{{}}'::jsonb"]:
    refused(mutation, ('immutable', 'sealed'))

for held in ["select 1 from public.fixture_relief_sources where operation_key='fixture-original' for update",
             "update public.icash_credit_reservations set status='released' where operation_key='fixture-original'"]:
    with locked(held):
        refused(activate(manifest), ('could not obtain lock', 'lock timeout'))
assert sql(f'select enabled from {POLICY};') == 'f'
refused('begin isolation level repeatable read;' + activate(manifest), ('READ COMMITTED',))
results = parallel(16, lambda _: attempt(activate(manifest)))
assert sum(isinstance(r, dict) and r.get('activated') is True for r in results) == 1
assert accounting() == original
assert sql(f"select public.icash_prospecting_total_available('{ACCOUNT}');") == '1000'

# Actual production reserve chain and final guard serialize competing workers.
results = parallel(16, lambda n: attempt(admit('native-admission-' + str(n))))
assert sum(isinstance(r, dict) and r.get('state') == 'reserved' for r in results) == 5
assert sql("select count(*) from public.icash_credit_reservations where operation_key like 'native-admission-%';") == '5'
assert sql(f"select public.icash_prospecting_total_available('{ACCOUNT}');") == '0'
assert int(sql('select reserved_micros from public.icash_operating_budget;')) == original['budget']['reserved_micros'] + 50000
sql(f"update public.icash_wallets set balance_cents=20 where account_id='{ACCOUNT}';")
supplier = json.loads(sql("select jsonb_build_object('reserved',reserved_micros,'spent',spent_micros) from public.icash_operating_budget;"))
receipt = "select public.icash_settle_operation('fixture-original',100,10000,'SYNTHETIC exact late provider receipt');"
assert all(r == '' for r in parallel(8, lambda _: sql(receipt)))
assert sql(f"select balance_cents from public.icash_wallets where account_id='{ACCOUNT}';") == '0'
assert json.loads(sql("select jsonb_build_object('gross',gross_cents,'customer',customer_cents,'covered',covered_cents) from public.icash_usage_coverage where operation_key='fixture-original';")) == {'gross': 100, 'customer': 20, 'covered': 80}
assert sql("select count(*) from public.icash_credit_ledger where event_key in ('usage:fixture-original','usage-coverage:fixture-original');") == '2'
assert int(sql('select reserved_micros from public.icash_operating_budget;')) == supplier['reserved'] - 50000
assert int(sql('select spent_micros from public.icash_operating_budget;')) == supplier['spent'] + 10000
refused("select public.icash_settle_operation('fixture-original',99,10000,'SYNTHETIC conflicting late receipt');", ('Settlement conflict',))

# Concurrent rollback and exact activation replay can never reenable the policy.
results = parallel(8, lambda n: attempt(rollback(manifest) if n == 0 else activate(manifest)))
if sql(f'select enabled from {POLICY};') == 't':
    # A fail-fast rollback losing the budget lock remains an explicit refusal;
    # complete this separately requested local test rollback once contenders end.
    sql(rollback(manifest))
refused(activate(manifest), ('terminal',))
refused(f'update {POLICY} set enabled=true;', ('one-use', 'immutable'))

# Mixed activation and real admissions: both pre- and post-activation orderings
# are valid, but no ordering may admit six 200c quotes against a 1000c wallet.
pool, selected = setup()
sql(stage(pool, selected))
manifest = sql(f'select manifest_sha256 from {POLICY};')
results = parallel(17, lambda n: attempt(activate(manifest) if n == 0 else admit('mixed-admission-' + str(n))))
if sql(f'select enabled from {POLICY};') == 'f':
    sql(activate(manifest))
count = int(sql("select count(*) from public.icash_operation_spend where operation_key like 'mixed-admission-%';"))
assert count in (4, 5), count
assert int(sql(f"select public.icash_prospecting_total_available('{ACCOUNT}');")) == 1000 - 200 * count
assert int(sql("select count(*) from public.icash_credit_reservations where operation_key like 'mixed-admission-%';")) == count
for role in ('anon', 'authenticated', 'service_role'):
    for signature in ('stage_pending_work_relief_20261116(jsonb,jsonb,text)', 'activate_pending_work_relief_20261116(text,text)', 'rollback_pending_work_relief_20261116(text,text)'):
        assert sql(f"select has_function_privilege('{role}','icash_reliability_private.{signature}','execute');") == 'f'

# A legitimate late settlement or independently active source excludes only
# that sealed original. Its unchanged peer remains eligible without restaging.
for mutation, reason in [
    ("select public.icash_settle_operation('fixture-original',25,10000,'SYNTHETIC actual receipt before activation');", 'original_changed'),
    ("update public.fixture_relief_sources set eligible=false where operation_key='fixture-original';", 'source_changed'),
]:
    pool, selected = setup(peer=True)
    sql(stage(pool, selected))
    manifest = sql(f'select manifest_sha256 from {POLICY};')
    sql(mutation)
    result = json.loads(sql(activate(manifest)))
    assert result['eligibleOperations'] == 1 and result['excludedOperations'] == 1 and result['enabled'] is True
    assert sql(f"select reason from {DECISIONS} where operation_key='fixture-original';") == reason
    assert sql(f"select eligible from {DECISIONS} where operation_key='fixture-peer';") == 't'
    if reason == 'source_changed':
        sql("update public.fixture_relief_sources set eligible=true where operation_key='fixture-original';")
        assert sql("select icash_reliability_private.pending_planning_cents(o) from public.icash_operation_spend o where operation_key='fixture-original';") == '100'
    assert sql("select icash_reliability_private.pending_planning_cents(o) from public.icash_operation_spend o where operation_key='fixture-peer';") == '0'
    before_replay = sql(f'select activation_manifest_sha256 from {POLICY};')
    sql(activate(manifest))
    assert sql(f'select activation_manifest_sha256 from {POLICY};') == before_replay


def stale_insert_after(snapshot_query, action, insertion):
    assert_fixture_client(CMD, ENV)
    process = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV)
    try:
        process.stdin.write(("begin isolation level repeatable read;" + snapshot_query + ";select 'RELIEF_LOCK_READY';\n").encode())
        process.stdin.flush()
        marker(process)
        action()
        process.stdin.write((insertion + ';commit;\n').encode())
        process.stdin.close()
        assert process.wait(timeout=10) != 0, 'A stale privileged transaction must not extend a sealed cohort'
        assert 'immutable' in process.stderr.read().decode().lower()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


# Direct owner SQL receives the same stale-snapshot fence, including insertion
# into the activation decisions table after a peer has sealed its final subset.
pool, selected = setup()
stale_insert_after(f'select count(*) from {POLICY}', lambda: sql(stage(pool, selected)),
    f"insert into {ROWS} select operation_key,account_id,to_jsonb(o)-'estimate_checked_at','{{}}'::jsonb from public.icash_operation_spend o where operation_key='fixture-original'")
manifest = sql(f'select manifest_sha256 from {POLICY};')
stale_insert_after(f'select count(*) from {DECISIONS}', lambda: sql(activate(manifest)),
    f"insert into {DECISIONS}(operation_key,account_id,eligible,reason,checked_at) values('fixture-original','{ACCOUNT}',true,'eligible',clock_timestamp())")
assert sql(f'select count(*) from {ROWS};') == '1'
assert sql(f'select count(*) from {DECISIONS};') == '1'


def blocked_insert(query, relation, foreign_key=False):
    """Prove a valid writer waits on the intended live lock, not another error."""
    try:
        sql("begin;set local lock_timeout='150ms';" + query + ';rollback;')
    except AssertionError as error:
        message = str(error).lower()
        assert 'lock timeout' in message and relation in message, message
        if foreign_key:
            assert 'for key share' in message, message
        return
    raise AssertionError('Expected source insert to wait on ' + relation)


def real_source_writers(kind, key):
    identifier = '20000000-0000-4000-8000-000000000001'
    child = '20000000-0000-4000-8000-000000000099'
    children = []
    if kind == 'seller_call':
        children = [
            (f"insert into public.icash_automation_tickets(id,account_id,kind,voice_job_id) values('{child}','{ACCOUNT}','voice_dispatch','{identifier}')", 'icash_voice_jobs', True),
            (f"insert into public.icash_call_recordings(id,account_id,operation_key,voice_job_id,state) values('{child}','{ACCOUNT}',{quote(key)},'{identifier}','stopping')", 'icash_voice_jobs', True),
        ]
    elif kind == 'sms_send':
        children = [
            (f"insert into public.icash_automation_tickets(id,account_id,kind,opener_message_id) values('{child}','{ACCOUNT}','seller_opener','{identifier}')", 'icash_text_messages', True),
            (f"insert into icash_text_receipt_private.attempts(id,message_id,account_id) values('{child}','{identifier}','{ACCOUNT}')", 'icash_text_messages', True),
        ]
    writers = list(children)
    if kind == 'seller_call':
        writers.append((f"""insert into public.icash_live_conversations(id,account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key)
          values('{child}','{ACCOUNT}','{identifier}','seller','agent_synthetic','conv_synthetic',{quote(key)},'synthetic-contact-key','cash_interest')""", 'icash_operation_spend', True))
    elif kind == 'property_search':
        writers.append((f"insert into public.icash_discovery_results(operation_key,account_id,result) values({quote(key)},'{ACCOUNT}','{{}}')", 'icash_operation_spend', True))
        # Protocol projection from icash_claim_discovery_estimate in
        # config/research-request-reuse.sql, not execution of its full RPC.
        writers.append((f"""select 1 from public.icash_operating_budget where id=1 for update;
          insert into icash_research_private.estimates(operation_key,account_id) values({quote(key)},'{ACCOUNT}')""", 'icash_operating_budget', False))
    if kind in ('owner_enrichment', 'property_search'):
        request_key = 'owner-batch:' + identifier if kind == 'owner_enrichment' else key
        request_kind = 'owner_lookup' if kind == 'owner_enrichment' else 'property_search'
        # Canonical quota-lock-before-INSERT protocol from take_reserved_request
        # in config/research-request-pacing.sql. No claim to run all its gates.
        writers.append((f"""select 1 from public.icash_dealmachine_request_budget where id=1 for update;
          insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at)
          values('{child}','{request_kind}','{ACCOUNT}',{quote(request_key)},true,now())""", 'icash_dealmachine_request_budget', False))
    return children, writers


# Exercise the shipped source/check/control helpers, never the generic overrides.
# Every INSERT below is also executed successfully after releasing its blocker,
# then rolled back, proving failures are live lock conflicts rather than invalid
# fixtures. This covers actual stage AND activation retaining their locks until
# transaction end, plus the source helper's independent exact parent fence.
for kind in ('owner_enrichment', 'seller_call', 'sms_send', 'property_search'):
    pool, selected = setup(real_kind=kind)
    key = pool[0]['operation_key']
    children, writers = real_source_writers(kind, key)
    assert sql(f"select icash_reliability_private.pending_work_relief_controls_20261116('{ACCOUNT}');") == 't'
    original = accounting()
    if children:
        helper_call = f"select icash_reliability_private.pending_work_relief_lock_source_20261116(o) from public.icash_operation_spend o where operation_key={quote(key)}"
        with locked(helper_call):
            for insertion, relation, foreign_key in children:
                blocked_insert(insertion, relation, foreign_key)
        for insertion, _, _ in children:
            sql('begin;' + insertion + ';rollback;')
    with locked(stage(pool, selected), commit=True):
        for insertion, relation, foreign_key in writers:
            blocked_insert(insertion, relation, foreign_key)
    assert accounting() == original
    for insertion, _, _ in writers:
        sql('begin;' + insertion + ';rollback;')
    manifest = sql(f'select manifest_sha256 from {POLICY};')
    with locked(activate(manifest), commit=True):
        for insertion, relation, foreign_key in writers:
            blocked_insert(insertion, relation, foreign_key)
    assert accounting() == original
    assert sql(f'select eligible from {DECISIONS};') == 't'
    assert sql(f"select public.icash_prospecting_total_available('{ACCOUNT}');") == '1000'
    for insertion, _, _ in writers:
        sql('begin;' + insertion + ';rollback;')

print('PASS native November 16 relief: generic lifecycle races, terminal rollback, actual concurrent final admission and once-only late coverage/supplier settlement; shipped four-kind source capture/activation with actual parent FK insert fences and request/estimate lock protocols. Generic cases use synthetic gates; full canonical source-writer RPCs and providers are not exercised.')
