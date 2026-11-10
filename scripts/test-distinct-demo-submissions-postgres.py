"""Concurrent demo intent/retry identity, fixed disposable PostgreSQL only."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
from threading import Barrier
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENV = {key: value for key, value in os.environ.items() if key in ('PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT')}
ENV.update(PGPASSWORD='isolated-fixture-only', PGCONNECT_TIMEOUT='5', PGSSLMODE='disable')
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
       '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability']
ACCOUNT = '48dfb798-8c1a-404f-88c0-c396cc067062'
OWNER = '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'


def read(path):
    return (ROOT / path).read_text()


def sql(query, failure=False):
    result = subprocess.run(CMD, input="set statement_timeout='12s';\n" + query,
                            env=ENV, text=True, capture_output=True, timeout=18)
    if failure:
        assert result.returncode != 0
        return result.stderr
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def fixture():
    source = read('supabase/migrations/20261004170451_seller_intake_and_budgeted_lead_assignment.sql')
    tables = []
    for name in ('icash_seller_controls', 'icash_seller_intakes', 'icash_seller_matches', 'icash_seller_events'):
        start = source.index('create table public.' + name + ' (')
        tables.append(source[start:source.index(';', start)+1])
    submission = read('config/bot-demo-intake.sql')
    submission = submission[submission.index('create function public.icash_submit_bot_demo_intake'):submission.index('-- Preserve the current assignment')]
    lookup = read('config/seller-funnel-milestones.sql')
    lookup = lookup[lookup.index('CREATE OR REPLACE FUNCTION public.icash_finish_seller_lookup'):lookup.index('-- Backfill genuine recent submissions')]
    meta = read('supabase/migrations/20261018150000_meta_contact_first_intake.sql')
    meta = meta[meta.index('alter function public.icash_finish_seller_lookup(uuid,uuid,jsonb) rename'):meta.index('create function public.icash_meta_response_report')]
    roles = ''.join("do $$begin if not exists(select 1 from pg_roles where rolname='" + role +
                    "') then create role " + role + ";end if;end$$;" for role in ('anon', 'authenticated', 'service_role'))
    return roles + """
create table icash_accounts(id uuid primary key,owner_user_id uuid);
create table icash_screening_jobs(id uuid primary key,account_id uuid,state text);
create table icash_operation_spend(operation_key text primary key);
create table icash_timezone_names(name text);insert into icash_timezone_names values('America/Chicago');
create table icash_meta_leads(lead_id uuid);
create function icash_meta_promote_property(uuid) returns void language sql as $$select$$;
""" + '\n'.join(tables) + """
alter table icash_seller_intakes add column email_consented boolean,add column contact_consent_scope text;
insert into icash_seller_controls(id) values(1);
""" + f"insert into icash_accounts values('{ACCOUNT}','{OWNER}');\n" + submission + lookup + read('config/demo-intake-resubmission.sql') + meta + read('config/distinct-demo-submissions.sql') + """
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
revoke all on function icash_finish_seller_lookup(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function icash_finish_seller_lookup(uuid,uuid,jsonb) to service_role;
"""


def submit(request, address='45 Fixture Lane, Dallas, TX 75201', key='b'):
    # All inputs below are fictional fixture values, not arbitrary SQL inputs.
    return ("set role service_role;select icash_submit_bot_demo_intake(" +
            f"'{OWNER}','{ACCOUNT}','{request}','{'a'*64}','Demo Seller','{address}'," +
            f"'+12145550123',true,'{key*64}','America/Chicago','{'c'*64}');")


def contend(queries):
    barrier = Barrier(len(queries))
    def execute(query):
        barrier.wait(timeout=10)
        return sql(query)
    with ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(execute, queries))


def run():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema public cascade;create schema public;')
    sql(fixture())
    request = str(uuid.uuid4())
    receipts = contend([submit(request)] * 12)
    assert len(set(receipts)) == 1
    assert sql('select count(*) from icash_seller_intakes;') == '1'
    # Same request with a conflicting address and key must reject rather than
    # receive another run; changing the key cannot escape the request lock.
    assert 'Submission retry mismatch' in sql(submit(request, '99 Other Lane, Dallas, TX 75201', 'd'), True)
    conflict_key = str(uuid.uuid4())
    changed_keys = contend([submit(conflict_key, key='b' if i % 2 else 'd') for i in range(12)])
    assert len(set(changed_keys)) == 1, 'Request lock spans duplicate-key drift'
    distinct = contend([submit(str(uuid.uuid4())) for _ in range(12)])
    assert len(set(distinct)) == 12
    assert sql("select count(*) from icash_seller_intakes where state='received' and canonical_id is null;") == '14'
    print('PASS native: 12 simultaneous retries return one receipt; 12 fresh requests for the same property create 12 independent runs.')
    # Finalizers serialize on the real seller control lock; property equality
    # must not canonicalize either intentional run. Replaying one finalizer is
    # still a consumed claim, even if its provider property matches the other.
    tokens = [str(uuid.uuid4()) for _ in distinct]
    for lead, token in zip(distinct, tokens):
        sql(f"update icash_seller_intakes set state='checking',claim_token='{token}',claimed_at=now(),lookup_cap_micros=0,lookup_costs='{{\"dealmachine\":0}}' where id='{lead}';")
    output = '{"creditsUsed":0,"numbersPassed":true,"property":{"id":"same-fixture-property","city":"Dallas","state":"TX"},"result":{"financialCheck":{"status":"eligible"},"preliminarySellerCeilingCents":8000000}}'
    finishes = [f"set role service_role;select icash_finish_seller_lookup('{lead}','{token}','{output}');" for lead, token in zip(distinct, tokens)]
    assert contend(finishes) == ['t'] * 12
    assert contend(finishes) == ['f'] * 12
    assert sql("select count(*) from icash_seller_intakes where state='qualified' and canonical_id is null;") == '12'
    for role in ('anon', 'authenticated'):
        assert sql(f"select has_function_privilege('{role}','icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text)','execute');") == 'f'
    before = sql('select jsonb_agg(to_jsonb(l) order by id) from icash_seller_intakes l;')
    sql(read('config/distinct-demo-submissions.sql'))
    assert sql('select jsonb_agg(to_jsonb(l) order by id) from icash_seller_intakes l;') == before
    print('PASS native: concurrent equal provider-property results stay independent; each lookup claim is consumed once; migration rerun preserves original receipts and private ACLs.')


if __name__ == '__main__':
    import sys
    if '--print-fixture' in sys.argv:
        print(fixture())
    else:
        run()
