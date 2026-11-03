"""Native receipt queue fairness on the disposable localhost database; no providers."""
from concurrent.futures import ThreadPoolExecutor
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from threading import Barrier
import json
import select
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location('text_recovery', ROOT/'scripts/test-text-delivery-recovery-postgres.py')
base = module_from_spec(SPEC)
SPEC.loader.exec_module(base)
sql, uid = base.sql, base.uid


def setup():
    base.setup()
    sql(base.read('config/text-receipt-queue-fairness.sql'))
    sql(base.read('tests/fixtures/text-receipt-fairness-seed.sql'))


def claim():
    return json.loads(sql('set role service_role;select icash_claim_text_delivery_rechecks();'))


def next_minute():
    # Advance only the disposable fixture's global clock, never a production counter.
    sql('update icash_text_receipt_private.control set next_run_at=now();')


def contenders():
    barrier = Barrier(24)
    def compete(_):
        barrier.wait(timeout=10)
        return claim()
    with ThreadPoolExecutor(max_workers=24) as pool:
        groups = list(pool.map(compete, range(24)))
    assert sum(bool(group) for group in groups) == 1, groups
    return [job for group in groups for job in group]


def run():
    setup()
    sql('select fixture_receipt_seed(100,200);select fixture_receipt_seed(1000,200,1);')
    # A writer that timed out leaves its exact immutable attempt unfinished.
    # The next attempt must read the same original provider ID, never resend it.
    old_id = sql(f"""insert into icash_text_receipt_private.attempts(message_id,account_id,request,created_at,expires_at)
      select m.id,m.account_id,jsonb_build_object('id',m.id,'account_id',m.account_id,'thread_id',m.thread_id,
       'provider_id',m.provider_id,'body',m.body,'attachments',m.attachments,'created_at',m.created_at,
       'sender',t.sender,'recipient',t.recipient,'operation',to_jsonb(o)),now()-interval '1 hour',now()-interval '58 minutes'
      from icash_text_messages m join icash_text_threads t on t.id=m.thread_id
      join icash_operation_spend o on o.operation_key='text:'||m.id
      where m.id='{uid(1000)}' returning id;""")
    old_attempt = sql(f"select to_jsonb(a) from icash_text_receipt_private.attempts a where id='{old_id}';")
    old_spend = sql("select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o;")
    due_seen, fresh_seen, accounts = [], [], set()
    recovered_expired = False
    for round_number in range(24):
        sql(f'select fixture_receipt_seed({10000+round_number*4},4);')
        next_minute()
        jobs = contenders() if round_number < 4 else claim()
        assert len(jobs) == 3, jobs
        assert claim() == [], 'Three-per-minute control must survive competing workers'
        due = [job for job in jobs if 1000 <= int(job['request']['id'][-12:]) < 1200]
        assert 1 <= len(due) <= 2, 'Fresh and due cohorts each retain a bounded share'
        for job in jobs:
            req = job['request']
            assert set(req) == {'id','account_id','thread_id','provider_id','body','attachments','created_at','sender','recipient','operation'}
            accounts.add(req['account_id'])
            (due_seen if job in due else fresh_seen).append(req['id'])
            if req['id'] == uid(1000):
                assert job['id'] != old_id
                assert req == json.loads(old_attempt)['request'], 'Retry must bind the identical original source and provider ID'
                evidence = base.receipt(job)
                barrier = Barrier(24)
                def finish(_):
                    barrier.wait(timeout=10)
                    return sql(base.finish_query(job,evidence))
                with ThreadPoolExecutor(max_workers=24) as pool:
                    outcomes = list(pool.map(finish, range(24)))
                assert outcomes == ['delivered']*24, outcomes
                assert sql(f"select count(*) from fixture_changes where message_id='{req['id']}';") == '1'
                assert sql(f"select to_jsonb(a) from icash_text_receipt_private.attempts a where id='{old_id}';") == old_attempt
                recovered_expired = True
            else:
                # Actual finalizer preserves incomplete provider evidence, including
                # top-level delivered without its required terminal tracking time.
                evidence = base.receipt(job)
                evidence['message']['raw']['data']['tracking'] = [{'event':'delivery.awaiting_confirmation','timestamp':evidence['message']['checkedAt']}]
                evidence['message']['rawText'] = json.dumps(evidence['message']['raw'])
                assert sql(base.finish_query(job,evidence)) == 'held'
                assert sql(base.finish_query(job,{'source':'different'})) == 'held'
                assert json.loads(sql(f"select receipt from icash_text_receipt_private.attempts where id='{job['id']}';")) == evidence
    assert recovered_expired
    assert len(set(due_seen)) >= 24 and len(set(fresh_seen)) >= 24
    assert len(accounts) == 12, accounts
    assert due_seen == sorted(due_seen), 'Oldest due receipts must continue progressing within their class'
    assert fresh_seen == sorted(fresh_seen), 'Oldest fresh receipts must continue progressing within their class'
    assert sql(f"select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o where operation_key<'text:{uid(10000)}';") == old_spend
    assert sql('select count(*) from icash_text_threads where not paused;') == '0'
    assert sql('select count(*) from icash_text_events;') == '0'
    assert sql('select count(*) from fixture_opened_gaps;') == '0'
    assert sql('select count(*) from icash_meta_leads where first_outreach_at is not null;') == '0'

    # The absent class must not waste capacity; cap and every backoff stay exact.
    setup()
    for checks in range(1,9):
        sql(f'select fixture_receipt_seed({2000+checks},1,{checks});')
    for expected_length in [3,3,1]:
        next_minute()
        jobs = contenders()
        assert len(jobs) == expected_length
        for job in jobs:
            previous = int(job['request']['id'][-12:])-2000
            assert previous < 8
            saved = json.loads(sql(f"""select jsonb_build_object('checks',s.attempts,'delay',extract(epoch from s.next_check_at-a.created_at))
              from icash_text_receipt_private.schedule s join icash_text_receipt_private.attempts a on a.message_id=s.message_id
              where a.id='{job['id']}';"""))
            assert saved == {'checks':previous+1,'delay':min(86400,900*2**previous)}, saved
    next_minute()
    assert claim() == [], 'Not-yet-due checks and the eight-attempt cap remain excluded'
    sql('select fixture_receipt_seed(3000,4);')
    next_minute()
    blocker = subprocess.Popen(base.CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=base.ENV,text=True)
    blocker.stdin.write(f"begin;do $$begin perform 1 from icash_text_messages where id='{uid(3000)}' for update;end$$;select 'locked';\n")
    blocker.stdin.flush()
    while True:
        ready,_,_ = select.select([blocker.stdout],[],[],5)
        assert ready, 'Fixture row-lock marker timeout'
        if blocker.stdout.readline().strip() == 'locked':
            break
        assert blocker.poll() is None, 'Fixture lock holder exited before its marker'
    jobs = contenders()
    assert len(jobs) == 3, 'Fresh-only queue uses all original capacity'
    assert uid(3000) not in [job['request']['id'] for job in jobs], 'An unrelated locked head cannot block available receipt work'
    blocker.stdin.write("commit;\n")
    blocker.stdin.close()
    blocker.wait(timeout=5)
    assert blocker.returncode == 0, blocker.stderr.read()
    next_minute()
    jobs = claim()
    assert len(jobs) == 1 and jobs[0]['request']['id'] == uid(3000), 'Skipped locked head returns after release'

    # Match the index predicate directly: COALESCE prevented the planner from
    # proving attempts<8 and caused thousands of unnecessary schedule lookups.
    setup()
    sql('select fixture_receipt_seed(100,200);select fixture_receipt_seed(1000,1000,1);select fixture_receipt_seed(10000,5000,8);analyze;')
    query = base.read('config/text-receipt-queue-fairness.sql').split('with due as materialized (\n')[1].split('\n  ), fresh')[0]
    previous = query.replace('join icash_text_receipt_private.schedule s','left join icash_text_receipt_private.schedule s').replace('s.attempts<8 and s.next_check_at<=now()','coalesce(s.attempts,0)<8 and (s.next_check_at is null or s.next_check_at<=now())')
    def nodes(plan):
        return [plan]+[node for child in plan.get('Plans',[]) for node in nodes(child)]
    before = json.loads(sql('explain(analyze,buffers,format json) '+previous+';'))[0]
    after = json.loads(sql('explain(analyze,buffers,format json) '+query+';'))[0]
    assert not any(node.get('Index Name') == 'icash_text_receipt_schedule_due' for node in nodes(before['Plan']))
    assert any(node.get('Index Name') == 'icash_text_receipt_schedule_due' for node in nodes(after['Plan'])), after
    assert sql('select jsonb_agg(to_jsonb(x)) from ('+query+') x;') == sql('select jsonb_agg(to_jsonb(x)) from ('+previous+') x;')
    print(f"PASS native due receipt index: exact equivalent sources; fixture buffer hits {before['Plan']['Shared Hit Blocks']} -> {after['Plan']['Shared Hit Blocks']}; original attempt cap preserved.")
    print('PASS native receipt fairness: 24 competing workers, continuous 200+ fresh/due backlog, twelve accounts, exact original expired-attempt IDs, 24 idempotent finishers, unchanged 3/minute, eight attempts/backoff, held incomplete evidence, Pause and finances. No provider calls.')


if __name__ == '__main__':
    run()
