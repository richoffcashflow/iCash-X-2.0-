"""Native multi-session admission tests in one fixed disposable CI PostgreSQL.

No DSN overrides, production hostnames, credentials or provider calls. Destructive
schema reset is confined to 127.0.0.1:55443 / icash_reliability in the dedicated
seller-quota-contention job. --emit-fixture/--emit-cases only print offline inputs.
Exact claim bodies, complete relevant eligibility predicate chain, and real
reserve/owner-demo limiter bodies run against synthetic rows and minimal tables.
Unrelated signup/dispatch/settlement triggers and the reserve migration's older
installation guard are not installed; their existing suites remain necessary.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import json
import os
import select
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENV = {key: value for key, value in os.environ.items()
       if key in ('PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT')}
ENV.update(PGPASSWORD='isolated-fixture-only', PGCONNECT_TIMEOUT='3', PGSSLMODE='disable')
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability']
ACCOUNT = '48dfb798-8c1a-404f-88c0-c396cc067062'
KINDS = ['seller', 'untargeted', 'refresh', 'meta', 'meta_network', 'meta_submission']


def sql(query, failure=False):
    p = subprocess.run(CMD, input="set statement_timeout='5s';set timezone='UTC';\n" + query,
                       env=ENV, text=True, capture_output=True, timeout=8)
    if failure:
        assert p.returncode, 'Expected SQL failure'
        return p.stderr
    if p.returncode:
        raise AssertionError(p.stderr)
    return p.stdout.strip()


def read(path):
    return (ROOT / path).read_text()


def fixture_sql():
    source = read('tests/fixtures/owner-demo-request-foundation.sql')
    for role in ['anon', 'authenticated', 'service_role']:
        source = source.replace(f'create role {role};', f"do $$begin if not exists(select 1 from pg_roles where rolname='{role}') then create role {role};end if;end$$;")
    # PostgreSQL/Supabase service_role bypasses RLS; table grants alone do not.
    yield 'begin;\n' + source + '\nalter role service_role bypassrls;commit;'
    yield read('tests/fixtures/seller-atomic-quota-native.sql')
    yield read('tests/fixtures/seller-atomic-quota-predicates.sql')
    refresh = read('config/seller-shared-research-refresh.sql')
    yield refresh[:refresh.index('-- Only a new')] + 'commit;'
    yield refresh[refresh.index('create function public.icash_claim_seller_research_refresh()'):refresh.index('create function public.icash_finish_seller_research_refresh')]
    meta = read('config/meta-instant-leads.sql')
    yield meta[meta.index('create function public.icash_meta_claim_lookup('):meta.index('-- New service-only entrypoints')]
    reserve = read('config/new-user-request-reserve.sql')
    # Exact installed policy and limiter; full older installation guard is
    # separately exercised by the unchanged new-user reserve suite.
    yield 'begin;' + reserve[reserve.index('create table icash_research_private.request_reserve_policy'):]
    # Fixture prerequisites get the same service-only execution surface. Apply
    # this BEFORE the candidate so ACL assertions exercise its own grants and
    # revokes, rather than masking an accidentally public new entry point.
    yield '''grant usage on schema public to anon,authenticated,service_role;
      grant select,insert,update,delete on all tables in schema public to service_role;
      revoke all on all functions in schema public from public,anon,authenticated;
      grant execute on all functions in schema public to service_role;'''
    yield read('config/seller-atomic-quota-admission.sql')
    yield read('config/owner-demo-request-allowance.sql')
    yield '''update icash_research_private.owner_demo_request_policy set enabled=true;
      update icash_research_private.request_reserve_policy set enabled=true;'''


RESET = """truncate public.icash_seller_research_refreshes,public.icash_meta_leads,
 public.icash_seller_intakes,public.icash_seller_matches,public.icash_seller_responses,
 public.icash_screening_jobs,public.icash_deal_files,public.icash_text_threads,
 public.icash_text_messages,public.icash_contact_permissions,public.icash_voice_jobs,
 public.icash_call_recordings,public.icash_live_conversations,public.icash_meta_lead_sources,
 public.icash_make_lead_inbox,public.icash_outreach_campaigns,public.icash_memberships,
 public.icash_daily_plans,public.icash_billing_reviews,public.icash_property_controls,
 public.icash_handoffs,public.icash_signing_envelopes,public.icash_text_suppressions,
 public.icash_contact_suppressions,public.icash_operation_spend,public.icash_research_state_exclusions,
 icash_research_private.owner_demo_request_admissions,icash_research_private.request_reserve_admissions cascade;
 update public.icash_seller_controls set enabled=true,lookup_reserved_micros=0,lookup_used_micros=0,
  lookup_allowance_micros=10000000,review_ref='Fixture data rights',data_rights_until=now()+interval '1 day';
 update public.icash_accounts set bot_paused=false,billing_model='prepaid';
 update public.icash_customer_identities set principal='SYNTHETIC Buyer';
 update public.icash_wallets set balance_cents=816,reserved_cents=0;
 update public.icash_spend_activations set enabled=true;
 update public.icash_operation_rates set enabled=true,expires_at=now()+interval '1 day';
 update public.icash_dealmachine_request_budget set day_used=0,minute_used=0,day_start=now()-interval '3 hours',minute_start=now();
 update icash_research_private.quota_feedback set blocked_until=null;
 delete from icash_research_private.requests where id<>'10000000-0000-4000-8000-000000000002';
"""

SNAPSHOT = """select jsonb_build_object(
 'budget',(select to_jsonb(b) from icash_dealmachine_request_budget b),
 'controls',(select to_jsonb(c) from icash_seller_controls c),
 'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),
 'leads',(select jsonb_agg(to_jsonb(l) order by id) from icash_seller_intakes l),
 'refresh',(select jsonb_agg(to_jsonb(f) order by id) from icash_seller_research_refreshes f),
 'requests',(select jsonb_agg(to_jsonb(r) order by id) from icash_research_private.requests r),
 'reserve',(select jsonb_agg(to_jsonb(r) order by request_id) from icash_research_private.request_reserve_admissions r),
 'demo',(select jsonb_agg(to_jsonb(d) order by lead_id) from icash_research_private.owner_demo_request_admissions d));"""


def reset():
    sql(RESET)


def seed(kind='seller'):
    lead = str(uuid.uuid4())
    sql(f"select fixture_seller_quota_seed('{kind}','{lead}','{uuid.uuid4()}');")
    return lead


def expression(kind, lead):
    if kind == 'refresh':
        return 'icash_claim_seller_research_refresh_admitted()'
    if kind == 'untargeted':
        return 'icash_claim_seller_lookup_admitted()'
    function = 'icash_meta_claim_lookup_admitted' if kind.startswith('meta') else 'icash_claim_seller_lookup_admitted_for'
    return f"{function}('{lead}')"


def call(kind, lead):
    return "set role service_role;set application_name='seller-quota-contender';select coalesce(public." + expression(kind, lead) + "::text,'null');"


def claimed(result):
    return isinstance(result, dict) and 'id' in result


def race(queries):
    barrier = Barrier(len(queries))
    def run(query):
        barrier.wait(timeout=5)
        # Keep the winning transaction open briefly so contenders overlap its
        # real acquired locks, rather than relying on two fast serial calls.
        return json.loads(sql("begin;" + query + "do $$begin perform pg_sleep(.08);end$$;commit;"))
    with ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(run, queries))


class Lock:
    def __init__(self, query):
        self.p = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  env=ENV, text=True, bufsize=1)
        self.p.stdin.write("begin;set statement_timeout='20s';set timezone='UTC';" + query + ";select 'LOCKED';\n")
        self.p.stdin.flush()
        if not select.select([self.p.stdout], [], [], 5)[0] or self.p.stdout.readline().strip() != 'LOCKED':
            self.p.kill()
            raise AssertionError('Fixture lock session did not start')
    def close(self, commit=True):
        self.p.stdin.write(('commit;' if commit else 'rollback;') + '\n\\q\n')
        self.p.stdin.flush()
        _, err = self.p.communicate(timeout=5)
        assert self.p.returncode == 0, err


def snapshot():
    return json.loads(sql(SNAPSHOT))


def counts():
    return json.loads(sql("select jsonb_build_object('day',b.day_used,'money',c.lookup_reserved_micros,'checking',(select count(*) from icash_seller_intakes where state='checking'),'refresh',(select count(*) from icash_seller_research_refreshes)) from icash_dealmachine_request_budget b,icash_seller_controls c;"))


def gate_cases():
    shared = ["update icash_seller_controls set enabled=false", "update icash_seller_controls set data_rights_until=now()", "update icash_seller_controls set lookup_allowance_micros=0", "update icash_operation_rates set enabled=false", "update icash_operation_rates set expires_at=now()"]
    for kind in KINDS:
        for mutation in shared:
            yield {'kind': kind, 'mutation': mutation}
    refresh = [
        "update icash_accounts set bot_paused=true", "update icash_wallets set balance_cents=0",
        "update icash_accounts set billing_model='membership_credits'",
        "insert into icash_outreach_campaigns select id,false,'outbound_voice_sms' from icash_accounts",
        "update icash_customer_identities set principal=''",
        "update icash_seller_intakes set ai_consented=false", "update icash_seller_intakes set consent_text='changed consent'",
        "update icash_seller_intakes set consent_version='changed version'", "update icash_seller_intakes set contact_consent_scope='icash_x_demo'",
        "update icash_seller_intakes set created_at=now()-interval '31 days'", "update icash_seller_intakes set data_rights_until=now()",
        "update icash_seller_intakes set attribution='{}'", "update icash_seller_matches set screening_id=gen_random_uuid()",
        "update icash_seller_matches set assigned_at=now()-interval '25 hours'", "update icash_seller_intakes set checked_at=now()-interval '9 days'",
        "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"changed\"')",
        "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{sellerRequest,id}','\"changed\"')",
        "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}',to_jsonb(now()))",
        "update icash_seller_responses set state='complete'", "update icash_screening_jobs set result='{}'",
        "update icash_deal_files set stage='under_contract'", "update icash_deal_files set terms='{\"practice\":true}'",
        "insert into icash_billing_reviews select id,null from icash_accounts",
        "insert into icash_property_controls select account_id,snapshot->>'propertyId',true from icash_screening_jobs",
        "insert into icash_handoffs select account_id,id,'pending' from icash_screening_jobs",
        "insert into icash_signing_envelopes select account_id,id,false from icash_deal_files",
        "update icash_text_threads set paused=true", "update icash_text_threads set retired_at=now()",
        "update icash_text_threads set manual_only=true", "update icash_text_threads set ai_mode='manual'",
        "update icash_text_messages set direction='incoming'", "update icash_text_messages set state='dispatching'",
        "update icash_text_messages set provider_id='SYNTHETIC original receipt'",
        "insert into icash_operation_spend select 'text:'||id from icash_text_messages",
        "update icash_voice_jobs set state='issued'", "update icash_voice_jobs set outcome='provider_outcome_unknown_no_retry'",
        "update icash_voice_jobs set provider_call_sid='SYNTHETIC original receipt'", "update icash_voice_jobs set operation_key='SYNTHETIC reservation'",
        "update icash_voice_jobs set callback_id=gen_random_uuid()", "update icash_voice_jobs set conversation_id=gen_random_uuid()",
        "insert into icash_operation_spend select 'voice:'||id from icash_voice_jobs",
        "insert into icash_call_recordings select account_id,id,null from icash_screening_jobs",
        "insert into icash_live_conversations select account_id,id from icash_screening_jobs",
        "insert into icash_text_suppressions values('+12142185280')",
        "insert into icash_contact_suppressions values(encode(sha256(convert_to('+12142185280','UTF8')),'hex'))",
        "insert into icash_research_state_exclusions values('TX',current_date)",
    ]
    for mutation in refresh:
        yield {'kind': 'refresh', 'mutation': mutation}
    meta = [
        "update icash_accounts set bot_paused=true", "update icash_wallets set balance_cents=0",
        "update icash_wallets set reserved_cents=balance_cents", "update icash_spend_activations set enabled=false",
        "update icash_accounts set billing_model='membership_credits'", "update icash_customer_identities set principal=''",
        "update icash_meta_lead_sources set enabled=false", "update icash_meta_lead_sources set reviewed_until=now()",
        "update icash_meta_lead_sources set form_id='changed'", "update icash_meta_lead_sources set consent_text='changed'",
        "update icash_meta_leads set paused=true", "update icash_meta_leads set declined_at=now()",
        "update icash_meta_leads set contact_until=now()", "update icash_meta_leads set submitted_at=now()+interval '1 hour'",
        "update icash_seller_intakes set consent_text='changed'", "update icash_seller_intakes set ai_consented=false",
        "update icash_seller_intakes set assigned_account=gen_random_uuid()", "update icash_seller_intakes set screening_id=gen_random_uuid()",
        "update icash_meta_leads set consent_receipt='[]'",
        "insert into icash_text_suppressions values('+12142185280')",
        "insert into icash_billing_reviews select id,null from icash_accounts",
        "insert into icash_handoffs select account_id,screening_id,'pending' from icash_meta_leads",
    ]
    for kind in ['meta', 'meta_network', 'meta_submission']:
        for mutation in meta:
            yield {'kind': kind, 'mutation': mutation}
    for mutation in ["update icash_make_lead_inbox set is_test=true", "update icash_make_lead_inbox set state='review'", "update icash_make_lead_inbox set payload=jsonb_set(payload,'{created_time}','\"changed\"')", "update icash_seller_intakes set name='Changed Seller'"]:
        yield {'kind': 'meta_submission', 'mutation': mutation}
    yield {'kind': 'meta', 'mutation': "update icash_customer_identities set principal='Changed Buyer'"}
    yield {'kind': 'meta_network', 'mutation': "update icash_seller_intakes set sharing_text='Changed sharing'"}
    yield {'kind': 'meta_network', 'mutation': "update icash_seller_intakes set data_rights_until=now()"}


def assert_acl():
    signatures = ['icash_claim_seller_lookup_admitted_for(uuid)', 'icash_claim_seller_lookup_admitted()',
                  'icash_claim_seller_research_refresh_admitted()', 'icash_meta_claim_lookup_admitted(uuid)']
    for signature in signatures:
        for role in ['anon', 'authenticated']:
            assert sql(f"select has_function_privilege('{role}','{signature}','EXECUTE');") == 'f'
        assert sql(f"select has_function_privilege('service_role','{signature}','EXECUTE');") == 't'
    for relation in ['request_reserve_policy', 'request_reserve_admissions', 'owner_demo_request_policy', 'owner_demo_request_admissions']:
        for role in ['anon', 'authenticated', 'service_role']:
            assert sql(f"select has_table_privilege('{role}','icash_research_private.{relation}','SELECT,INSERT,UPDATE,DELETE');") == 'f'


def main():
    assert sql('select current_database()') == 'icash_reliability'
    sql('drop schema if exists icash_research_private cascade;drop schema public cascade;create schema public;')
    for statement in fixture_sql():
        sql(statement)
    assert_acl()
    reset()
    before = snapshot()
    for _ in range(10):
        assert json.loads(sql(call('untargeted', None))) is None
        assert json.loads(sql(call('refresh', None))) is None
    assert snapshot() == before, 'Idle scans must preserve exact quotas, money and receipts'

    cases = list(gate_cases())
    for case in cases:
        reset(); lead = seed(case['kind']); sql(case['mutation'] + ';'); before = snapshot()
        assert json.loads(sql(call(case['kind'], lead))) is None, case
        assert snapshot() == before, case

    # Concurrent quota denials must leave fresh claims, funds and every saved
    # provider observation untouched, not merely avoid exceeding the ceiling.
    for mutation in [
        'update icash_dealmachine_request_budget set day_used=8820',
        'update icash_dealmachine_request_budget set day_used=9800',
        'update icash_dealmachine_request_budget set minute_used=60',
        "update icash_research_private.quota_feedback set blocked_until=now()+interval '1 hour'",
    ]:
        reset(); contenders = [(kind, seed(kind)) for kind in KINDS]
        sql(mutation + ';'); before = snapshot()
        result = race([call(kind, lead) for kind, lead in contenders])
        assert all(r in ({'status': 'rate_limited'}, {'status': 'admission_busy'}) for r in result), result
        assert snapshot() == before, mutation

    for kind in KINDS:
        reset(); lead = seed(kind)
        result = race([call(kind, lead), call(kind, lead)])
        assert sum(map(claimed, result)) == 1, (kind, result)
        assert counts()['day'] == 1 and counts()['money'] == 16000, (kind, counts())
    reset(); lead = seed()
    result = race([call('untargeted', lead), call('seller', lead)])
    assert sum(map(claimed, result)) == 1 and counts()['day'] == 1, result

    # Four concurrent entry paths compete for the same last ordinary slot.
    reset(); leads = [(kind, seed(kind)) for kind in ['untargeted', 'seller', 'refresh', 'meta_network']]
    sql('update icash_dealmachine_request_budget set day_used=8819;')
    result = race([call(kind, lead) for kind, lead in leads])
    assert sum(map(claimed, result)) == 1, result
    assert counts()['day'] == 8820 and counts()['money'] == 16000, counts()
    assert sql('select count(*) from icash_research_private.request_reserve_admissions;') == '0'

    # Busy returns before any quota wait, for row and table contention alike.
    for kind in KINDS:
        for lock_query in ['update icash_dealmachine_request_budget set day_used=day_used where id=1', 'lock table icash_dealmachine_request_budget in share mode']:
            reset(); lead = seed(kind); before = snapshot(); lock = Lock(lock_query)
            try:
                started = time.monotonic(); result = json.loads(sql(call(kind, lead)))
                assert result == {'status': 'admission_busy'}, (kind, result)
                assert time.monotonic() - started < 2, 'Quota contention must not wait after source gates'
                assert snapshot() == before
            finally:
                lock.close()
            assert claimed(json.loads(sql(call(kind, lead)))), 'An unchanged retry may claim once'
            assert counts()['day'] == 1 and counts()['money'] == 16000

    # No claim is left waiting behind quota. A fresh attempt must recheck every
    # applicable Pause/source/expiry gate after the first busy response.
    for kind, mutation in [
        ('seller', "update icash_seller_controls set data_rights_until=now()"),
        ('refresh', 'update icash_accounts set bot_paused=true'),
        ('refresh', "update icash_seller_intakes set consent_text='changed source'"),
        ('refresh', "update icash_seller_intakes set data_rights_until=now()"),
        ('meta', 'update icash_accounts set bot_paused=true'),
        ('meta', "update icash_customer_identities set principal='Changed Buyer'"),
        ('meta_network', "update icash_meta_lead_sources set reviewed_until=now()"),
        ('meta_submission', "update icash_make_lead_inbox set is_test=true"),
    ]:
        reset(); lead = seed(kind); lock = Lock('update icash_dealmachine_request_budget set day_used=day_used where id=1')
        try:
            assert json.loads(sql(call(kind, lead))) == {'status': 'admission_busy'}
            sql(mutation + ';'); before = snapshot()
        finally:
            lock.close()
        assert json.loads(sql(call(kind, lead))) is None
        assert snapshot() == before

    # Actual elapsed expiry, without rewriting source evidence after admission.
    reset(); lead = seed('meta_network')
    sql("update icash_meta_lead_sources set reviewed_until=clock_timestamp()+interval '1 second';")
    lock = Lock('update icash_dealmachine_request_budget set day_used=day_used where id=1')
    try:
        assert json.loads(sql(call('meta_network', lead))) == {'status': 'admission_busy'}
        time.sleep(1.1)
    finally:
        lock.close()
    before = snapshot(); assert json.loads(sql(call('meta_network', lead))) is None
    assert snapshot() == before

    # The generic path cannot claim a Meta lead even when both start together.
    for kind in ['meta', 'meta_network', 'meta_submission']:
        reset(); lead = seed(kind); result = race([call('seller', lead), call(kind, lead)])
        assert result[0] is None and result[1]['id'] == lead, result
        assert counts()['day'] == 1 and counts()['money'] == 16000

    # Real owner-demo exception stays one-use and separate from ordinary reserve.
    reset(); lead = seed('demo'); sql('update icash_dealmachine_request_budget set day_used=9800;')
    demo_call = f"set role service_role;select coalesce(public.icash_claim_owner_demo_lookup('{lead}')::text,'null');"
    meta = seed('meta_network'); refresh = seed('refresh')
    result = race([call('seller', lead), demo_call, demo_call, call('meta_network', meta), call('refresh', refresh)])
    assert sum(map(claimed, result)) == 1 and sum(map(claimed, result[1:3])) == 1, result
    assert counts()['day'] == 9801 and counts()['money'] == 16000
    assert sql('select count(*) from icash_research_private.owner_demo_request_admissions;') == '1'
    assert json.loads(sql(demo_call)) is None

    # Original seller-control writer serializes before selection/admission.
    reset(); lead = seed(); lock = Lock('update icash_seller_controls set enabled=false where id=1')
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, call('seller', lead))
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if sql("select exists(select 1 from pg_stat_activity where application_name='seller-quota-contender' and wait_event_type='Lock');") == 't':
                    break
                time.sleep(.03)
            else:
                raise AssertionError('Claim did not reach the original control lock')
            lock.close(); lock = None
            assert json.loads(future.result(timeout=5)) is None
    finally:
        if lock:
            lock.close()
    assert counts()['day'] == 0 and counts()['money'] == 0

    # Errors after admission must roll back actual quota, new refresh receipt,
    # claim token and financial hold together, for every new entry point.
    for kind in KINDS:
        reset(); lead = seed(kind); before = snapshot()
        sql("create function fixture_fail_reservation() returns trigger language plpgsql as $$begin raise exception 'injected native reservation failure';end$$;create trigger fixture_fail_reservation before update on icash_seller_controls for each row execute function fixture_fail_reservation();")
        try:
            assert 'injected native reservation failure' in sql(call(kind, lead), failure=True)
            assert snapshot() == before, kind
        finally:
            sql('drop trigger fixture_fail_reservation on icash_seller_controls;drop function fixture_fail_reservation();')
    print(f'PASS native atomic admission: {len(cases)} full-predicate rejection cases; idle no-debit; simultaneous seller/targeted/refresh/Meta claims; one ordinary slot; row/table NOWAIT; changed Pause/source/expiry retries; real owner-demo competition; rollback and private ACLs. Synthetic rows, no provider calls. Unrelated product triggers and external dispatch are not exercised.')


if __name__ == '__main__':
    if sys.argv[1:] == ['--emit-fixture']:
        print('\n'.join(fixture_sql()))
    elif sys.argv[1:] == ['--emit-cases']:
        print(json.dumps({'reset': RESET, 'snapshot': SNAPSHOT, 'cases': list(gate_cases())}))
    elif sys.argv[1:]:
        raise SystemExit('Only --emit-fixture and --emit-cases are accepted; database destination is fixed.')
    else:
        main()
