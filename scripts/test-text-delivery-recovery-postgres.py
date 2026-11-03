"""Real PostgreSQL canonical-text receipt races on disposable localhost only."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import json
import os
import select
import subprocess
import time

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
    return (ROOT/path).read_text()

def uid(n):
    return "00000000-0000-4000-8000-"+str(n).zfill(12)

def setup():
    assert sql("select current_database();") == "icash_reliability"
    sql("drop schema if exists icash_text_receipt_private cascade;drop schema public cascade;create schema public;")
    sql("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;end$$;")
    # Earlier suites retain the role across schema resets. Match Supabase's service
    # role even when another fixture originally created it without BYPASSRLS.
    sql('alter role service_role bypassrls;')
    assert sql("select rolbypassrls from pg_roles where rolname='service_role';") == 't'
    sql(read('tests/fixtures/text-delivery-recovery-base.sql').replace('create role anon;create role authenticated;create role service_role bypassrls;', ''))
    sql(read('tests/fixtures/text-delivery-recovery-observers.sql'))
    for observer in json.loads(read('tests/fixtures/text-delivery-recovery-triggers.json')):
        sql(observer['function_definition']+';'+observer['definition']+';')
    sql(read('config/text-delivery-recovery.sql'))
    sql(read('config/text-delivery-source-binding.sql'))
    sql(read('config/text-delivery-tracking.sql'))
    assert sql('set role service_role;select count(*) from icash_text_receipt_private.control;') == '1', 'Fixture service role must see the private recovery control'
    sql(read('tests/fixtures/text-delivery-recovery-callback.sql')+';')
    sql("""create table fixture_changes(message_id uuid);
      create function fixture_changed() returns trigger language plpgsql as $$begin insert into public.fixture_changes values(new.id);return new;end$$;
      create trigger fixture_delivery_change after update of state on icash_text_messages for each row execute function fixture_changed();
      grant select,insert on fixture_changes to service_role;
      grant execute on function icash_ingest_text_event_before_operational(jsonb,boolean) to service_role;""")
    sql(f"insert into icash_accounts values('{uid(1)}');insert into icash_deal_files values('{uid(4)}','{uid(1)}','{uid(5)}','draft');insert into icash_meta_leads values('{uid(6)}','{uid(1)}',null);insert into icash_text_senders values('+17205550100',false);insert into icash_text_threads(id,account_id,sender,recipient,paused) values('{uid(3)}','{uid(1)}','+17205550100','+12145550101',true);insert into icash_operation_rates values('{uid(2)}','sms_send');update icash_text_threads set deal_id='{uid(4)}',seller_intake_id='{uid(6)}';")

def seed(n):
    sql(f"""alter table icash_text_messages disable trigger user;insert into icash_text_messages(id,thread_id,account_id,direction,body,state,provider_id,created_at)
       values('{uid(n)}','{uid(3)}','{uid(1)}','outgoing','Original fixture?','accepted','text_fixture_{n}',now()-interval '1 hour');
       insert into icash_operation_spend values('text:{uid(n)}','{uid(1)}','{uid(2)}','settled',now()-interval '1 hour',now()-interval '59 minutes',2);
       alter table icash_text_messages enable trigger user;
       insert into icash_seller_opener_assignments(thread_id,account_id,body,message_id) values('{uid(3)}','{uid(1)}','Original fixture?','{uid(n)}');
       update icash_text_receipt_private.control set next_run_at=now();""")

def receipt(job):
    req=job['request']
    timing=json.loads(sql("select jsonb_build_object('now',now(),'sent',extract(epoch from dispatched_at)*1000,'delivered',dispatched_at+interval '10 seconds') from icash_operation_spend where operation_key='text:"+req['id']+"';"))
    raw={'object':'response','data':{'id':req['provider_id'],'from':req['sender'],'to':req['recipient'],'message':req['body'],'attachments':req['attachments'],'timestamp':float(timing['sent']),'status':'delivered','tracking':[{'event':'text.delivery.confirmed','timestamp':timing['delivered']}]}}
    lease={'object':'response','data':{'numbers':[{'number':{'e164':req['sender']},'lease_status':'active'}]}}
    return {'source':'contiguity_canonical_get','message':{'url':'https://api.contiguity.com/conversations/history/message/'+req['provider_id']+'?tracking=true','status':200,'raw':raw,'rawText':json.dumps(raw),'checkedAt':timing['now']},'lease':{'url':'https://api.contiguity.com/numbers/leased','status':200,'raw':lease,'rawText':json.dumps(lease),'checkedAt':timing['now']}}

def finish_query(job, evidence):
    encoded=json.dumps(evidence).replace("'", "''")
    return f"set role service_role;select icash_finish_text_delivery_recheck('{job['id']}','{encoded}'::jsonb);"

def run():
    setup()
    for role in ['anon','authenticated']:
        for signature in ['icash_claim_text_delivery_rechecks()','icash_finish_text_delivery_recheck(uuid,jsonb)']:
            assert sql(f"select has_function_privilege('{role}','{signature}','execute');") == 'f'
    seed(10)
    before=sql('select jsonb_agg(to_jsonb(o)) from icash_operation_spend o;')
    barrier=Barrier(24)
    def claim(_):
        barrier.wait(timeout=10)
        return json.loads(sql('set role service_role;select icash_claim_text_delivery_rechecks();'))
    with ThreadPoolExecutor(max_workers=24) as pool:
        claims=list(pool.map(claim,range(24)))
    jobs=[job for group in claims for job in group]
    assert len(jobs)==1, claims
    job=jobs[0]
    evidence=receipt(job)
    barrier=Barrier(24)
    def finish(_):
        barrier.wait(timeout=10)
        return sql(finish_query(job,evidence))
    with ThreadPoolExecutor(max_workers=24) as pool:
        results=list(pool.map(finish,range(24)))
    assert results==['delivered']*24,results
    assert sql('select count(*) from fixture_changes;')=='1'
    assert sql('select jsonb_agg(to_jsonb(o)) from icash_operation_spend o;')==before
    assert json.loads(sql(f"select receipt from icash_text_receipt_private.attempts where id='{job['id']}';"))==evidence
    seed(11)
    late=json.loads(sql('set role service_role;select icash_claim_text_delivery_rechecks();'))[0]
    late_evidence=receipt(late)
    callback={ 'id':'evt_fixture_late','type':'text.delivery.failed','timestamp':time.time(),'data':{'message_id':late['request']['provider_id'],'from':late['request']['sender'],'to':late['request']['recipient']}}
    callback_query="begin;do $$begin perform 1 from public.icash_operating_budget where id=1 for update;end$$;select 'callback_locked';select pg_sleep(0.5);select icash_ingest_text_event_before_operational('"+json.dumps(callback)+"'::jsonb,false);commit;"
    p=subprocess.Popen(CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=ENV,text=True)
    p.stdin.write(callback_query);p.stdin.close()
    while True:
        ready,_,_=select.select([p.stdout],[],[],5)
        assert ready,'Callback lock marker timeout'
        line=p.stdout.readline().strip()
        if line=='callback_locked':break
        assert p.poll() is None,'Callback exited before lock marker'
    assert sql(finish_query(late,late_evidence))=='changed'
    p.wait(timeout=5);assert p.returncode==0,p.stderr.read()
    assert sql(f"select state from icash_text_messages where id='{uid(11)}';")=='needs_review'
    assert sql('select count(*) from icash_text_events;')=='1'
    assert sql('select count(*) from fixture_opened_gaps;')=='1','Only the real intervening failed callback creates its review'
    assert sql('select first_outreach_at is null from icash_meta_leads;')=='t'
    assert sql('select count(*) from icash_learning_queue;')=='1'
    assert sql('select count(*) from icash_seller_opener_assignments where delivered_at is not null;')=='1'
    later_callback={'id':'evt_duplicate_after_recovery','type':'text.delivery.confirmed','timestamp':time.time(),'data':{'message_id':job['request']['provider_id'],'from':job['request']['sender'],'to':job['request']['recipient']}}
    sql("select icash_ingest_text_event_before_operational('"+json.dumps(later_callback)+"'::jsonb,false);")
    assert sql('select count(*) from fixture_opened_gaps;')=='1','Later duplicate callback must retain historical replay fence'
    assert sql('select first_outreach_at is null from icash_meta_leads;')=='t'
    for n, invalid_source in [(13, None), (14, 'other_source'), (15, 'missing_tracking_query'), (16, 'false_tracking_query')]:
        seed(n)
        held_job=json.loads(sql('set role service_role;select icash_claim_text_delivery_rechecks();'))[0]
        invalid_evidence=receipt(held_job)
        if invalid_source is None:
            del invalid_evidence['source']
        elif invalid_source=='missing_tracking_query':
            invalid_evidence['message']['url']=invalid_evidence['message']['url'].replace('?tracking=true','')
        elif invalid_source=='false_tracking_query':
            invalid_evidence['message']['url']=invalid_evidence['message']['url'].replace('?tracking=true','?tracking=false')
        else:
            invalid_evidence['source']=invalid_source
        before_changes=sql('select count(*) from fixture_changes;')
        assert sql(finish_query(held_job,invalid_evidence))=='held'
        assert sql(f"select state from icash_text_messages where id='{uid(n)}';")=='accepted'
        assert sql(f"select last_delivery_at is null from icash_text_messages where id='{uid(n)}';")=='t'
        assert sql('select count(*) from fixture_changes;')==before_changes,'Invalid source or URL cannot mutate the message'
        assert sql('select count(*) from fixture_opened_gaps;')=='1','Invalid source or URL cannot create historical follow-up'
        assert sql('select first_outreach_at is null from icash_meta_leads;')=='t'
        assert json.loads(sql(f"select receipt from icash_text_receipt_private.attempts where id='{held_job['id']}';"))==invalid_evidence
    seed(12)
    sql(f"update icash_text_messages set state='delivered',last_delivery_at=now() where id='{uid(12)}';")
    assert sql('select count(*) from fixture_opened_gaps;')=='2','Ordinary new delivery still runs normal follow-up'
    assert sql('select first_outreach_at is not null from icash_meta_leads;')=='t'
    assert sql("select count(*) from icash_text_messages where direction='incoming';")=='0'
    assert sql(f"select paused from icash_text_threads where id='{uid(3)}';")=='t'
    print('PASS native canonical-text receipt recovery:24 claimers issue one bounded original GET;24 finishers apply once;actual original callback wins late race;original finance,Pause and raw evidence preserved.No providers.')

if __name__=='__main__':
    run()
