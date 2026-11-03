"""Reviewed local preview rejection recovery on disposable localhost; no providers."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from threading import Barrier
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('native_fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
sql = fixture.sql



def setup():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_owner_review_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_private cascade;drop schema public cascade;create schema public;')
    sql(fixture.read('tests/fixtures/opportunity-schema.sql'))
    sql(fixture.read('tests/fixtures/owner-preview-rejection-recovery.sql'))
    source = fixture.read('config/owner-enrichment-deferral.sql')
    sql(source[:source.index('create function public.icash_defer_owner_enrichment')]+'\ncommit;')
    sql(fixture.read('config/owner-enrichment-evidence-indexes.sql'))
    sql(source[source.index('create function public.icash_finish_owner_enrichment'):source.index('-- Older deployed workers')])
    consume = fixture.read('supabase/migrations/20260928222744_automatic_work_and_contacts.sql')
    start = consume.index('create function public.icash_consume_automation')
    sql(consume[start:consume.index('create function public.icash_finish_automation',start)])
    sql(fixture.read('config/owner-preview-empty.sql'))
    sql(fixture.read('config/owner-preview-empty-credit-shape.sql'))
    recovery = fixture.read('config/owner-preview-rejection-recovery.sql')
    versions = list((ROOT/'supabase/migrations').glob('*_owner_preview_rejection_recovery.sql'))
    assert len(versions) == 1 and versions[0].read_text() == recovery
    sql(recovery)
    assert sql('select count(*) from icash_research_private.preview_rejection_policy;') == '0', 'Deployment cannot enroll an unreviewed incident'
    sql("insert into icash_research_private.preview_rejection_policy values(1,repeat('a',40),'dpl_SyntheticFixture123',clock_timestamp()-interval '12 minutes',clock_timestamp()-interval '6 minutes','27af55c3f732c75a9edddc287bfd8d29');")
    # Execute the production issuer's upsert verbatim. Candidate selection is
    # deliberately outside this fixture: the already-reviewed ticket is explicit.
    definition = json.loads(fixture.read('tests/fixtures/owner-preflight-priority-before.json'))['public.icash_next_acquisition()']
    start = definition.index('insert into public.icash_automation_tickets(account_id,kind,screening_id)')
    end = definition.index("return jsonb_build_object('token',t.token);",start)+len("return jsonb_build_object('token',t.token);")
    upsert = definition[start:end]
    sql("create function public.fixture_preview_reissue(p_account uuid,p_screening uuid) returns jsonb language plpgsql as $$declare c public.icash_discovery_configs;j uuid;t public.icash_automation_tickets;begin perform 1 from public.icash_operating_budget where id=1 for update;select * into c from public.icash_discovery_configs where account_id=p_account;j:=p_screening;"+upsert+"end$$;")
    sql("grant select,update on public.icash_operating_budget,public.icash_automation_tickets to service_role;revoke all on function public.icash_finish_owner_enrichment(uuid,uuid,uuid,text,boolean,text) from public,anon,authenticated;grant execute on function public.icash_finish_owner_enrichment(uuid,uuid,uuid,text,boolean,text) to service_role;")



def literal(value):
    return "'"+json.dumps(value).replace("'", "''")+"'::jsonb"


def text_literal(value):
    return "'"+str(value).replace("'", "''")+"'"


def late_guard(case, query, mutation, evidence, approval_count):
    """Commit changed admission evidence while recovery waits on its real lock."""
    before = evidence(case)
    blocker = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write("begin;set local statement_timeout='8s';do $$begin perform 1 from public.icash_operating_budget where id=1 for update;end$$;"+mutation+"select 'preview-recovery-locked';\n")
        blocker.stdin.flush()
        fixture.wait_for_marker(blocker,'preview-recovery-locked')
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(sql,query)
            deadline = time.monotonic()+5
            waiting = False
            while time.monotonic() < deadline:
                waiting = sql("select exists(select 1 from pg_stat_activity where application_name='preview-rejection-contender' and wait_event_type='Lock');") == 't'
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, 'Recovery never reached its shared admission lock'
            blocker.stdin.write('commit;\n\\q\n')
            blocker.stdin.flush();blocker.wait(timeout=5)
            assert blocker.returncode == 0, blocker.stderr.read()
            assert pending.result() == 'f', 'A late Pause or original paid/unknown evidence must reject recovery'
        assert evidence(case) == before, 'Original ticket, source, request and approval evidence changed'
        assert approval_count(case) == 0
    finally:
        if blocker.poll() is None:
            blocker.kill();blocker.wait(timeout=5)


def recover_query(case):
    args = [case[key] for key in ('ticket','request','ticketHash','requestHash','screeningHash','configHash','rateHash','release')]
    return ("set role service_role;set application_name='preview-rejection-contender';select public.icash_recover_rejected_owner_preview("
            +','.join(text_literal(arg) for arg in args)+','+literal(case['trace'])+');')


def seed(n, deferrals=0):
    return json.loads(sql(f'select public.fixture_preview_rejection_seed({n},{deferrals});'))


def evidence(case):
    return json.loads(sql(f"""select jsonb_build_object(
      'ticket',(select to_jsonb(t) from public.icash_automation_tickets t where id='{case['ticket']}'),
      'request',(select to_jsonb(r) from icash_research_private.requests r where id='{case['request']}'),
      'screening',(select to_jsonb(s) from public.icash_screening_jobs s where id='{case['screening']}'),
      'configuration',(select to_jsonb(c) from public.icash_discovery_configs c where account_id='{case['account']}'),
      'wallet',(select to_jsonb(w) from public.icash_wallets w where account_id='{case['account']}'),
      'rate',(select to_jsonb(r) from public.icash_operation_rates r join public.icash_discovery_configs c on c.contact_rate_id=r.id where c.account_id='{case['account']}'));
    """))


def approval_count(case):
    return int(sql(f"select count(*) from icash_research_private.preview_rejection_recoveries where ticket_id='{case['ticket']}';"))


def assert_success(case, before):
    after = evidence(case)
    for key in ('request','screening','rate','wallet'):
        assert after[key] == before[key], key
    assert {k:v for k,v in after['configuration'].items() if k != 'next_run_at'} == {k:v for k,v in before['configuration'].items() if k != 'next_run_at'}
    assert after['configuration']['next_run_at'] <= before['configuration']['next_run_at']
    changed = {'outcome','owner_preview_deferrals','owner_preview_retry_after','owner_preview_retry_until','owner_preview_screening_hash'}
    assert {k:v for k,v in after['ticket'].items() if k not in changed} == {k:v for k,v in before['ticket'].items() if k not in changed}, 'Original token, attempt count, creation/completion and expiry must remain unchanged'
    assert after['ticket']['state'] == 'held' and after['ticket']['outcome'] == 'owner_preview_rate_limited'
    assert after['ticket']['owner_preview_deferrals'] == max(1,before['ticket']['owner_preview_deferrals'])
    if before['ticket']['owner_preview_retry_until'] is not None:
        assert after['ticket']['owner_preview_retry_until'] <= before['ticket']['owner_preview_retry_until']
    if before['ticket']['owner_preview_retry_after'] is not None:
        assert after['ticket']['owner_preview_retry_after'] >= before['ticket']['owner_preview_retry_after']
    audit = json.loads(sql(f"select to_jsonb(r) from icash_research_private.preview_rejection_recoveries r where ticket_id='{case['ticket']}';"))
    for source,key in [('before_ticket','ticket'),('request','request'),('screening','screening'),('configuration','configuration'),('rate','rate')]:
        assert audit[source] == before[key], source
    assert audit['reviewed_trace'] == case['trace'] and audit['reviewed_release'] == case['release']
    cap = json.loads(sql(f"select to_jsonb(r) from public.icash_owner_enrichment_recoveries r where ticket_id='{case['ticket']}';"))
    assert cap['approved_max_charge_cents'] == before['rate']['charge_cents']
    assert cap['expected_ticket_hash'] == case['ticketHash'] and cap['expected_screening_hash'] == case['screeningHash']
    assert cap['operation_key'] == f"owners:{case['account']}:{case['screening']}"
    assert cap['code_stage'] == 'owner_preview_local_record_rejection_v1'
    assert sql(f"select (owner_preview_retry_until<=least(s.completed_at+interval '24 hours',(s.snapshot->>'fetchedAt')::timestamptz+interval '24 hours')) from public.icash_automation_tickets t join public.icash_screening_jobs s on s.id=t.screening_id where t.id='{case['ticket']}';") == 't'
    assert approval_count(case) == 1
    saved = evidence(case)
    saved_audit = sql(f"select to_jsonb(r) from icash_research_private.preview_rejection_recoveries r where ticket_id='{case['ticket']}';")
    assert sql(recover_query(case)) == 'f', 'A reviewed approval cannot be consumed twice or refresh its deadline'
    assert evidence(case) == saved
    assert sql(f"select to_jsonb(r) from icash_research_private.preview_rejection_recoveries r where ticket_id='{case['ticket']}';") == saved_audit



def late_old_finisher(case):
    before = evidence(case)
    old_token = before['ticket']['token']
    blocker = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        # Keep the original production admission boundary while the actual
        # issuer statement rotates its capability and the new handler consumes it.
        blocker.stdin.write("begin;set local statement_timeout='8s';do $$begin perform public.fixture_preview_reissue('"+case['account']+"','"+case['screening']+"');perform public.icash_consume_automation((select token from public.icash_automation_tickets where id='"+case['ticket']+"'));end$$;select 'preview-reissued';\n")
        blocker.stdin.flush();fixture.wait_for_marker(blocker,'preview-reissued')
        query = ("set role service_role;set application_name='preview-old-finisher';select public.icash_finish_owner_enrichment("
                 +','.join(text_literal(case[key]) for key in ('ticket','account','screening'))+','+text_literal(old_token)+",false,'held_for_reconciliation');")
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(sql,query)
            deadline = time.monotonic()+5
            waiting = False
            while time.monotonic() < deadline:
                waiting = sql("select exists(select 1 from pg_stat_activity where application_name='preview-old-finisher' and wait_event_type='Lock');") == 't'
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, 'Old finisher did not wait for actual reissuance admission'
            blocker.stdin.write('commit;\n\\q\n');blocker.stdin.flush();blocker.wait(timeout=5)
            assert blocker.returncode == 0, blocker.stderr.read()
            assert pending.result() == 'f', 'An old consumed token cannot finish the new handler'
        after = evidence(case)
        for key in ('request','screening','rate','wallet','configuration'):
            assert after[key] == before[key]
        assert after['ticket']['token'] != old_token
        assert after['ticket']['state'] == 'consumed' and after['ticket']['outcome'] is None and after['ticket']['completed_at'] is None
        for key in ('issue_attempts','owner_preview_deferrals','owner_preview_retry_until','owner_preview_screening_hash'):
            assert after['ticket'][key] == before['ticket'][key], key
        assert sql(f"select expires_at<=owner_preview_retry_until from public.icash_automation_tickets where id='{case['ticket']}';") == 't'
        assert approval_count(case) == 1
    finally:
        if blocker.poll() is None:
            blocker.kill();blocker.wait(timeout=5)


def run():
    setup()
    case = seed(1)
    before = evidence(case)
    assert sql(recover_query(case)) == 'f', 'Migration must install with recovery disabled'
    assert evidence(case) == before and approval_count(case) == 0
    sql('update icash_research_private.owner_export_settings set preview_rejection_recovery_enabled=true where id=1;')
    barrier = Barrier(24)
    def contender(_):
        barrier.wait(timeout=10)
        return sql(recover_query(case))
    with ThreadPoolExecutor(max_workers=24) as pool:
        results = list(pool.map(contender, range(24)))
    assert results.count('t') == 1 and results.count('f') == 23, results
    assert_success(case,before)
    late_old_finisher(case)
    # Existing retry history is not reset by the new local-handler approval.
    existing = seed(2,4)
    before = evidence(existing)
    assert sql(recover_query(existing)) == 't'
    assert_success(existing,before)
    for n,key in enumerate(('ticketHash','requestHash','screeningHash','configHash','rateHash','release'),start=10):
        changed = seed(n)
        before = evidence(changed)
        changed[key] = 'f'*len(changed[key])
        assert sql(recover_query(changed)) == 'f', key
        assert evidence(changed) == before and approval_count(changed) == 0
    first,second = seed(20),seed(21)
    before = evidence(first)
    crossed = {**first,'request':second['request'],'requestHash':second['requestHash']}
    assert sql(recover_query(crossed)) == 'f', 'A different account/source request cannot authorize this ticket'
    assert evidence(first) == before and approval_count(first) == 0
    changed = seed(22)
    changed['trace']['deployment'] = 'dpl_DifferentFixture123'
    assert sql(recover_query(changed)) == 'f' and approval_count(changed) == 0
    paused = seed(30)
    late_guard(paused,recover_query(paused),f"update public.icash_accounts set bot_paused=true where id='{paused['account']}';",evidence,approval_count)
    unknown = seed(31)
    operation = f"owners:{unknown['account']}:{unknown['screening']}"
    late_guard(unknown,recover_query(unknown),f"insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values('other','{operation}:late','original unknown receipt',null,'unknown');",evidence,approval_count)
    assert sql(f"select count(*) from public.icash_cost_observations where event_key='{operation}:late' and amount is null;") == '1'
    whole_batch = seed(32)
    late_guard(whole_batch,recover_query(whole_batch),f"insert into icash_research_private.owner_batch_items(screening_id,batch_id,operation_key) values(md5('synthetic-paid-sibling')::uuid,'{whole_batch['batch']}','synthetic-paid-sibling');",evidence,approval_count)
    assert sql(f"select count(*) from icash_research_private.owner_batch_items where batch_id='{whole_batch['batch']}';") == '1'
    disabled = seed(33)
    late_guard(disabled,recover_query(disabled),'update icash_research_private.owner_export_settings set preview_rejection_recovery_enabled=false where id=1;',evidence,approval_count)
    sql('update icash_research_private.owner_export_settings set preview_rejection_recovery_enabled=true where id=1;')
    signature = 'public.icash_recover_rejected_owner_preview(uuid,uuid,text,text,text,text,text,text,jsonb)'
    for role in ('anon','authenticated','service_role'):
        assert sql(f"select has_function_privilege('{role}','{signature}','execute');") == ('t' if role == 'service_role' else 'f')
        for table in ('preview_rejection_recoveries','preview_rejection_policy'):
            assert sql(f"select has_table_privilege('{role}','icash_research_private.{table}','select');") == 'f'
    for table in ('icash_operation_spend','icash_credit_reservations','icash_owner_contacts'):
        assert sql(f'select count(*) from public.{table};') == '0', 'Offline recovery must not create paid admission or contacts'
    assert sql('select count(*) from icash_research_private.owner_empty_preview_receipts;') == '0', 'An unavailable historical body cannot become phone absence evidence'
    print('PASS reviewed preview rejection recovery: 24 approvals produce one immutable audit and original cap; prior counters/deadlines, original token/request/source/config/rate retained; cross-request/hash guards, late Pause, unknown receipt, explicit disable and whole-batch paid evidence reject; production reissue rotates capability and rejects a competing old-token completion. No providers or financial settlement.')


if __name__ == '__main__':
    run()
