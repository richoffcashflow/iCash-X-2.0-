"""Native races for finite access recovery. Fixed disposable database, no providers."""
from concurrent.futures import ThreadPoolExecutor
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import subprocess
import time
ROOT=Path(__file__).resolve().parents[1]
spec=spec_from_file_location('base',ROOT/'scripts/test-owner-preflight-priority-postgres.py')
base=module_from_spec(spec);spec.loader.exec_module(base);sql=base.sql
assert sql('select current_database()')=='icash_reliability'
sql('drop schema public cascade;create schema public;')
source=subprocess.run(['node','--input-type=module','-e',"import {recoverySchema} from './tests/helpers/paid-term-recovery-fixture.mjs';console.log(recoverySchema());"],cwd=ROOT,text=True,capture_output=True,check=True).stdout
for role in ('anon','authenticated','service_role'):
    sql(f"do $$begin if not exists(select 1 from pg_roles where rolname='{role}') then create role {role};end if;end $$;")
source=source.replace('create role anon;create role authenticated;create role service_role bypassrls;','alter role service_role bypassrls;')
sql(source)
def seed(n):
    a,s,v,c,u=[f'00000000-0000-4000-8000-{n*100+k:012d}' for k in range(1,6)]
    sql(f"""insert into icash_accounts values('{a}','{u}',true,0);
    insert into icash_support_threads values('{c}','{a}');
    insert into icash_memberships(id,account_id,mode,guest_hash,price_cents,offer_revision,state,stripe_subscription_id,stripe_customer_id,paid_through,vip_until,consent_version,consent_text)
    values('{s}','{a}','live',md5('{s}')||md5('{s}'),10000,1,'cancelled','sub_fixture{n}','cus_fixture{n}',now()+interval '20 days',now()+interval '20 days','ordinary','Original fixture terms');
    insert into icash_membership_invoices(stripe_invoice_id,membership_id,stripe_payment_id,amount_cents,period_end)
    select 'in_fixture{n}',id,'pi_software{n}',5000,paid_through from icash_memberships where id='{s}';
    insert into icash_plan_changes select '{v}',id,account_id,'upgrade','applied',paid_through,5000,10000,'pi_vip{n}' from icash_memberships where id='{s}';""")
    call=f"set role service_role;set application_name='paid-term-contender';select (public.icash_restore_paid_term('{a}','{s}','in_fixture{n}','{v}','{c}',(select paid_through from icash_memberships where id='{s}'),'Owner approved original finite paid term without charge or resume')).id;"
    return a,s,call

def process(statement):
    p=subprocess.Popen(base.CMD,env=base.ENV,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    p.stdin.write("set application_name='paid-term-holder';"+statement+'\n');p.stdin.flush();return p

def wait_ready():
    for _ in range(200):
        if int(sql("select count(*) from pg_stat_activity where application_name='paid-term-holder' and state='idle in transaction'"))>0:return
        time.sleep(.02)
    raise AssertionError('Holder did not finish acquiring its locks')

def wait_lock():
    for _ in range(200):
        if int(sql("select count(*) from pg_stat_activity where application_name='paid-term-contender' and wait_event_type='Lock'"))>0:return
        time.sleep(.02)
    raise AssertionError('Contender did not wait on account lock')

a,s,call=seed(1)
with ThreadPoolExecutor(max_workers=12) as pool:
    ids=list(pool.map(lambda _:sql(call),range(24)))
assert len(set(ids))==1
assert sql('select count(*) from icash_paid_term_recoveries')=='1'
assert sql(f"select state from icash_memberships where id='{s}'")=='cancelled'
assert sql(f"select bot_paused from icash_accounts where id='{a}'")=='t'
# A concurrent Run change wins rather than being silently overwritten by recovery.
a,s,call=seed(2);holder=process(f"begin;update icash_accounts set bot_paused=false where id='{a}';")
try:
    wait_ready()
    contender=process(call+'\n\\q');wait_lock();holder.stdin.write('commit;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10);contender.wait(timeout=10)
    assert contender.returncode!=0 and 'Paused account' in contender.stderr.read()
finally:
    for p in (holder,contender):
        if p.poll() is None:p.kill();p.wait()
# An original-payment review that commits first prevents the grant.
a,s,call=seed(3);holder=process("begin;insert into icash_billing_reviews(payment_id,resolved_at) values('pi_software3',null);")
try:
    wait_ready()
    contender=process(call+'\n\\q');wait_lock();holder.stdin.write('commit;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10);contender.wait(timeout=10)
    assert contender.returncode!=0 and 'Verified original payments' in contender.stderr.read()
finally:
    for p in (holder,contender):
        if p.poll() is None:p.kill();p.wait()
# A review arriving after a grant has the account lock waits, then suspends it.
a,s,call=seed(4);holder=process('begin;'+call.replace("paid-term-contender","paid-term-holder"))
try:
    wait_ready()
    contender=process("set application_name='paid-term-contender';insert into icash_billing_reviews(payment_id,resolved_at) values('pi_vip4',null);\n\\q")
    wait_lock();holder.stdin.write('commit;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10);contender.wait(timeout=10)
    assert contender.returncode==0,contender.stderr.read()
    assert sql(f"select m.state from icash_memberships m join icash_paid_term_recoveries r on r.membership_id=m.id where r.account_id='{a}'")=='needs_review'
finally:
    for p in (holder,contender):
        if p.poll() is None:p.kill();p.wait()
# Real cancellation and a payment review share the budget-first lock order.
a,s,call=seed(5);mid=sql(call)
holder=process(f"begin;set role service_role;select 1 from icash_operating_budget where id=1 for update;select 1 from icash_memberships where id='{mid}' for update;")
try:
    wait_ready()
    contender=process("set application_name='paid-term-contender';insert into icash_billing_reviews(payment_id,resolved_at) values('pi_vip5',null);\n\\q")
    wait_lock();holder.stdin.write(f"select icash_request_membership_cancellation('{mid}','{a}','live');commit;\n\\q\n");holder.stdin.flush();holder.wait(timeout=10);contender.wait(timeout=10)
    assert holder.returncode==0,holder.stderr.read()
    assert contender.returncode==0,contender.stderr.read()
    assert sql(f"select state from icash_memberships where id='{mid}'")=='cancel_requested'
    assert sql("select count(*) from icash_billing_reviews where payment_id='pi_vip5'")=='1'
finally:
    for p in (holder,contender):
        if p.poll() is None:p.kill();p.wait()
# Account-only backfills must not take the budget lock while holding an account.
a,s,call=seed(6)
sql("insert into icash_billing_reviews(payment_id,resolved_at) values('pi_software6',null);")
holder=process('begin;select 1 from icash_operating_budget where id=1 for update;')
try:
    wait_ready()
    # With the old broad UPDATE trigger this blocks on holder and times out.
    assert sql(f"begin;set statement_timeout='1s';select 1 from icash_accounts where id='{a}' for update;update icash_billing_reviews set account_id='{a}' where payment_id='pi_software6';commit;")=='1'
    assert sql("set statement_timeout='1s';insert into icash_billing_reviews(payment_id,resolved_at) values('pi_unrelated',null);")==''
finally:
    holder.stdin.write('rollback;\n\\q\n');holder.stdin.flush();holder.wait(timeout=10)
assert sql("select has_function_privilege('authenticated','public.icash_restore_paid_term(uuid,uuid,text,uuid,uuid,timestamptz,text)','EXECUTE')")=='f'
print('PASS native paid-term recovery: 24-way idempotency, Run/review races, exact account locks, source cancellation preserved and private ACL.')
