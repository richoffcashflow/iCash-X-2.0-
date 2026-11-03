"""Disposable localhost lock races. No provider requests or production access."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import select
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]


def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='8s';set timezone='UTC';\n"+query,
                            env=ENV, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def read(path):
    return (ROOT / path).read_text()


def setup():
    assert sql("select current_database();") == 'icash_reliability'
    sql("drop schema if exists icash_seller_recovery_private cascade;drop schema public cascade;create schema public;")
    sql(read('tests/fixtures/seller-contact-revalidation-native.sql'))
    cadence = read('config/seller-text-cadence.sql')
    sql(cadence[cadence.index('create function public.icash_seller_text_cadence_current'):cadence.index('-- Evaluate again')])
    recovery = json.loads(read('tests/fixtures/seller-text-health-baseline.json'))['icash_seller_recovery_current']
    recovery = recovery.replace(' anchor:=g.source_at;', " if not public.icash_seller_text_cadence_current(g.account_id,t.id,g.outgoing_id,g.reason='no_response') then return false;end if;\n anchor:=g.source_at;")
    sql(recovery)
    sql(read('config/seller-contact-revalidation.sql'))
    sql("grant usage on schema public to service_role;grant select on all tables in schema public to service_role;")


def seed():
    x = {key: str(uuid.uuid4()) for key in ('account', 'screen', 'deal', 'rate', 'old_receipt', 'new_receipt', 'old', 'fresh', 'thread', 'message', 'gap', 'owner', 'source')}
    sql(f"""
    insert into icash_accounts values('{x['account']}',false);
    insert into icash_screening_jobs values('{x['screen']}','{x['account']}','complete','{{"financialCheck":{{"status":"eligible"}}}}',now()-interval '4 days 1 hour','{{"propertyId":"synthetic"}}');
    insert into icash_deal_files values('{x['deal']}','{x['account']}','{x['screen']}','draft','{{}}');
    insert into icash_operation_rates values('{x['rate']}',now()+interval '1 day');
    insert into icash_operation_spend(operation_key,account_id,state) values('original:{x['account']}','{x['account']}','settled');
    insert into icash_owner_contacts values('{x['account']}','{x['screen']}','original:{x['account']}');
    insert into icash_dnc_verification_sources values('{x['source']}',true,'SYNTHETIC verified source',now()+interval '1 day');
    insert into icash_dnc_verification_receipts values
     ('{x['old_receipt']}','{x['source']}',now()-interval '4 days 1 hour',now()-interval '3 days 1 hour',true,null),
     ('{x['new_receipt']}','{x['source']}',now()-interval '1 minute',now()+interval '1 day',true,null);
    insert into icash_operational_contacts values
     ('{x['old']}','{x['account']}','{x['screen']}','sms','+12145550123','synthetic','{x['owner']}','Synthetic Principal','synthetic','America/Chicago','source_record',9,20,'{x['old_receipt']}',now()-interval '3 days 1 hour',null),
     ('{x['fresh']}','{x['account']}','{x['screen']}','sms','+12145550123','synthetic','{x['owner']}','Synthetic Principal','synthetic','America/Chicago','source_record',9,20,'{x['new_receipt']}',now()+interval '1 day',null);
    insert into icash_text_threads(id,account_id,deal_id,party,sender,recipient,timezone,operational_contact_id,eligibility_until,sms_rate_id,dnc_checked_at,dnc_clear)
     values('{x['thread']}','{x['account']}','{x['deal']}','seller','+17205550100','+12145550123','America/Chicago','{x['old']}',now()-interval '3 days 1 hour','{x['rate']}',now()-interval '4 days 1 hour',true);
    insert into icash_sms_routes values('+17205550100','+12145550123','{x['account']}',false);
    insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,created_at,body)
     values('{x['message']}','{x['account']}','{x['thread']}','outgoing','delivered','SYNTHETIC receipt',now()-interval '4 days','SYNTHETIC original question?');
    insert into icash_seller_gaps values('{x['gap']}','{x['account']}','{x['deal']}','{x['screen']}','{x['thread']}','text','{x['message']}','no_response','draft','text','SYNTHETIC original quote','needs_review','contact_checks_expired',now()-interval '4 days',now()-interval '1 day',now()+interval '3 days',null,now());
    """)
    x['review'] = sql(f"set role service_role;select icash_review_seller_contact_revalidation('{x['gap']}','{x['fresh']}',encode(sha256(convert_to(icash_seller_contact_revalidation_snapshot('{x['gap']}','{x['fresh']}')::text,'UTF8')),'hex'),'SYNTHETIC exact native review');")
    assert x['review']
    return x


def apply(x):
    return sql(f"set role service_role;set application_name='contact-revalidation-contender';select icash_apply_seller_contact_revalidation('{x['review']}');")


def evidence(x):
    return sql(f"select icash_seller_contact_revalidation_snapshot('{x['gap']}','{x['fresh']}')::text;")


def late_control(mutation):
    setup()
    x = seed()
    sql('update icash_seller_recovery_private.contact_revalidation_policy set enabled=true;')
    before = evidence(x)
    holder = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        holder.stdin.write("begin;do $$begin perform 1 from icash_operating_budget where id=1 for update;end$$;"+mutation(x)+"select 'locked';\n")
        holder.stdin.flush()
        deadline = time.monotonic()+5
        while time.monotonic()<deadline:
            if select.select([holder.stdout], [], [], .1)[0] and holder.stdout.readline().strip()=='locked':
                break
        else:
            raise AssertionError('Control never acquired budget lock')
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(apply, x)
            deadline = time.monotonic()+5
            while time.monotonic()<deadline:
                if sql("select exists(select 1 from pg_stat_activity where application_name='contact-revalidation-contender' and wait_event_type='Lock');")=='t':
                    break
                time.sleep(.025)
            else:
                raise AssertionError('Revalidation never waited for admission lock')
            holder.stdin.write('commit;\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=5)
            assert holder.returncode==0, holder.stderr.read()
            assert pending.result()=='f'
        assert sql('select count(*) from icash_seller_recovery_private.contact_revalidations;')=='0'
        # Controls not included in the snapshot (Pause/policy) leave it exact.
        assert evidence(x)==before
        assert sql('select count(*) from icash_text_messages;')=='1'
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait()


setup()
x = seed()
before = evidence(x)
assert apply(x)=='f', 'Disabled migration must not reopen work'
assert evidence(x)==before
sql('update icash_seller_recovery_private.contact_revalidation_policy set enabled=true;')
with ThreadPoolExecutor(max_workers=24) as pool:
    outcomes = list(pool.map(lambda _: apply(x), range(24)))
assert outcomes.count('t')==1, outcomes
assert sql('select count(*) from icash_seller_recovery_private.contact_revalidations;')=='1'
assert sql('select count(*) from icash_text_messages;')=='1'
assert sql('select count(*) from icash_seller_recovery_attempts;')=='0'
escaped_before = before.replace("'", "''")
assert sql(f"select before_evidence=('{escaped_before}'::jsonb) from icash_seller_recovery_private.contact_revalidations;")=='t'
late_control(lambda x: f"update icash_accounts set bot_paused=true where id='{x['account']}';")
late_control(lambda x: 'update icash_seller_recovery_private.contact_revalidation_policy set enabled=false;')
late_control(lambda x: "insert into icash_text_suppressions values('+12145550123');")
setup()
x = seed()
sql('update icash_seller_recovery_private.contact_revalidation_policy set enabled=true;')
before = evidence(x)
x['review'] = sql(f"""insert into icash_seller_recovery_private.contact_revalidation_reviews(gap_id,contact_id,snapshot,snapshot_hash,review_reference,created_at,expires_at)
 select gap_id,contact_id,snapshot,snapshot_hash,review_reference,now()-interval '29 minutes 59 seconds',now()+interval '1 second'
 from icash_seller_recovery_private.contact_revalidation_reviews where id='{x['review']}' returning id;""")
sql("create or replace function public.icash_seller_recovery_current(p_gap uuid) returns boolean language plpgsql as $$begin perform pg_sleep(1.1);return true;end$$;")
assert apply(x)=='f', 'Review expiry during the final check must roll back the proposed binding'
assert evidence(x)==before
assert sql('select count(*) from icash_seller_recovery_private.contact_revalidations;')=='0'
print('PASS native seller revalidation: 24 competitors, one immutable application, late Pause/disable/STOP win, no send or charge. Contact proof is covered by the separate actual-function PGlite suite.')
