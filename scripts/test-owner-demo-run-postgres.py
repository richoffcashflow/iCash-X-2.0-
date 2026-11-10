"""Owner demo restarts under native transaction contention; disposable PG only.

The shared fixture installs the captured current contact/routing functions. The
canonical atomic migration is applied unchanged. No provider or production I/O.
"""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENV = {k: v for k, v in os.environ.items() if k in ('PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT')}
ENV.update(PGPASSWORD='isolated-fixture-only', PGCONNECT_TIMEOUT='5', PGSSLMODE='disable')
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
       '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability']
A = '48dfb798-8c1a-404f-88c0-c396cc067062'
O = '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'
PHONE = '+12142185280'
SENDER = '+17208134296'


def sql(source):
    p = subprocess.run(CMD, input="set statement_timeout='12s';\n" + source,
                       env=ENV, text=True, capture_output=True, timeout=18)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


class Session:
    def __init__(self, name):
        self.name = name
        self.p = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True, bufsize=1, env=ENV)
        self.lines = queue.Queue()
        def reader():
            for line in self.p.stdout:
                self.lines.put(line.rstrip())
            self.lines.put(None)
        threading.Thread(target=reader, daemon=True).start()
        self.query(f"set application_name='{name}';set statement_timeout='12s';set deadlock_timeout='100ms';")

    def start(self, source):
        self.p.stdin.write(source + '\n\\echo fixture_done\n')
        self.p.stdin.flush()

    def finish(self):
        out = []
        while True:
            line = self.lines.get(timeout=16)
            assert line is not None, '\n'.join(out)
            if line == 'fixture_done':
                assert not any('ERROR:' in item for item in out), '\n'.join(out)
                return '\n'.join(out)
            if line:
                out.append(line)

    def query(self, source):
        self.start(source)
        return self.finish()

    def close(self):
        if self.p.poll() is None:
            self.p.stdin.close()
            try:
                self.p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.p.terminate()
                self.p.wait(timeout=3)


def blocked(session):
    # Observe an actual lock wait, not a sleep-based guess about scheduling.
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{session.name}' and wait_event_type='Lock';") == '1':
            return
        time.sleep(.02)
    raise AssertionError(f'{session.name} never waited for the held lock')


def contend(queries):
    barrier = threading.Barrier(len(queries))
    def run(query):
        barrier.wait(timeout=10)
        return sql(query)
    with ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(run, queries))


def submit(request=None):
    request = request or str(uuid.uuid4())
    return f"select icash_submit_bot_demo_intake('{O}','{A}','{request}','{'a'*64}','Fixture Owner','100 Test Lane, Dallas, TX 75201','{PHONE}',true,'{'b'*64}','America/Chicago','{'c'*64}');"


def assigned():
    r = dict(id=sql(submit()), screen=str(uuid.uuid4()), deal=str(uuid.uuid4()))
    sql(f"""update icash_seller_intakes set state='assigned',assigned_account='{A}',screening_id='{r['screen']}',data_rights_until=now()+interval '1 day' where id='{r['id']}';
insert into icash_screening_jobs(id,account_id,state,snapshot) values('{r['screen']}','{A}','complete','{{"propertyId":"fixture"}}');
insert into icash_seller_matches(lead_id,account_id,screening_id) values('{r['id']}','{A}','{r['screen']}');
insert into icash_deal_files(id,account_id,screening_id,stage,terms) values('{r['deal']}','{A}','{r['screen']}','draft','{{"address":"100 Test Lane, Dallas, TX 75201"}}');
insert into icash_optin_call_requests select id,request_id,phone,'{A}','{O}','demo_form','icash-optin-call-now-2026-10-16.1','icash-optin-call-now-2026-10-16.1',now(),now()+interval '5 minutes' from icash_seller_intakes where id='{r['id']}';""")
    return r


def activate(r):
    return f"select icash_demo_run_private.activate('{A}','{r['id']}');"


def fresh():
    r = assigned()
    # Actual current contact prep, not a fixture function returning true.
    sql(f"select icash_prepare_seller_contacts('{A}','{r['id']}','{r['screen']}','{r['deal']}');")
    r['thread'] = sql(f"select id from icash_text_threads where seller_intake_id='{r['id']}';")
    r['permission'] = sql(f"select id from icash_contact_permissions where seller_intake_id='{r['id']}';")
    assert r['thread'] and r['permission']
    r['job'] = str(uuid.uuid4())
    sql(f"insert into icash_voice_jobs(id,account_id,permission_id,state,created_at) values('{r['job']}','{A}','{r['permission']}','ready',now());")
    return r


def snapshot(r):
    return sql(f"select jsonb_build_array((select to_jsonb(t) from icash_text_threads t where id='{r['thread']}'),(select to_jsonb(p) from icash_contact_permissions p where id='{r['permission']}'),(select to_jsonb(s) from icash_screening_jobs s where id='{r['screen']}'));")


def main():
    assert sql('select current_database();') == 'icash_reliability'
    exported = subprocess.run(['node', 'scripts/export-owner-demo-run-fixture.mjs'], cwd=ROOT,
                              env=ENV, text=True, capture_output=True, timeout=30)
    assert exported.returncode == 0, exported.stderr
    migration = (ROOT / 'config/owner-demo-restart.sql').read_text()
    def reset():
        sql('drop schema if exists icash_demo_run_private cascade;drop schema if exists icash_recording_private cascade;drop schema if exists icash_recorded_reception_private cascade;drop schema public cascade;create schema public;')
        sql(exported.stdout)
        sql('begin;\n' + migration + '\ncommit;')

    reset()
    request = str(uuid.uuid4())
    retries = contend([submit(request)] * 8)
    assert len(set(retries)) == 1
    distinct = contend([submit() for _ in range(8)])
    assert len(set(distinct)) == 8
    assert sql('select count(*) from icash_demo_run_private.runs;') == '9'
    assert sql('select count(distinct generation) from icash_demo_run_private.runs;') == '9'

    reset()
    old = fresh()
    new = assigned()
    results = contend([activate(new)] * 8)
    assert results == ['t'] * 8
    assert sql(f"select retired_at is not null from icash_text_threads where id='{old['thread']}';") == 't'
    assert sql(f"select revoked_at is not null from icash_contact_permissions where id='{old['permission']}';") == 't'
    assert sql(f"select state from icash_voice_jobs where id='{old['job']}';") == 'canceled'
    assert sql(activate(old)) == 'f'

    # All mutations race activation after it has demonstrably waited on the
    # exact budget/account/routing locks used by the production function.
    cases = [
        ('budget', "select id from icash_operating_budget where id=1 for update;", 'unknown-voice'),
        ('account', f"select id from icash_accounts where id='{A}' for update;", 'pause'),
        # Current contact preparation and message admission acquire budget first.
        # Taking818 then inserting a message invents the opposite trigger order.
        ('route', 'select id from icash_operating_budget where id=1 for update;select pg_advisory_xact_lock(818,1);', 'unknown-text'),
        ('phone', f"select pg_advisory_xact_lock(hashtextextended('{PHONE}',74));", 'active-call'),
    ]
    for name, lock, hold in cases:
        reset()
        old = fresh()
        new = assigned()
        before = snapshot(old)
        expiry = sql(f"select expires_at from icash_optin_call_requests where lead_id='{new['id']}';")
        holder, worker = Session('demo_holder'), Session('demo_' + name)
        try:
            holder.query('begin;' + lock)
            worker.start(activate(new))
            blocked(worker)
            if hold == 'unknown-voice':
                mutation = f"update icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry' where id='{old['job']}';"
            elif hold == 'pause':
                mutation = f"update icash_accounts set bot_paused=true where id='{A}';"
            elif hold == 'unknown-text':
                mutation = f"insert into icash_text_messages(id,thread_id,account_id,direction,state,created_at) values(gen_random_uuid(),'{old['thread']}','{A}','outgoing','dispatching',now());"
            else:
                mutation = f"insert into icash_customer_phone_calls(id,recipient_phone,state) values(gen_random_uuid(),'{PHONE}','dispatching');"
            holder.query(mutation + 'commit;')
            assert worker.finish() == 'f', hold
            assert snapshot(old) == before, hold + ' partially retired predecessor'
            assert sql(f"select activated_at is null from icash_demo_run_private.runs where lead_id='{new['id']}';") == 't'
            assert sql(f"select expires_at from icash_optin_call_requests where lead_id='{new['id']}';") == expiry
        finally:
            holder.close()
            worker.close()

    # A routing selector may hold818 without budget. It does not insert a text
    # afterward in this synthetic transaction: that would invert the real
    # budget-first producer order. Prove activation actually waits, then resumes.
    reset()
    old, new = fresh(), assigned()
    holder, worker = Session('demo_routing_selector'), Session('demo_waiting_for_selector')
    try:
        holder.query('begin;select pg_advisory_xact_lock(818,1);')
        worker.start(activate(new))
        blocked(worker)
        holder.query('commit;')
        assert worker.finish() == 't'
        assert sql(f"select retired_at is not null from icash_text_threads where id='{old['thread']}';") == 't'
    finally:
        holder.close()
        worker.close()

    # Two deliberate requests race while the prior provider call is active.
    # Only the latest can activate after the original call is terminal AND its
    # operation has settled. Neither request receives a renewed five minutes.
    reset()
    old = fresh()
    record = str(uuid.uuid4())
    sql(f"""insert into icash_operation_spend(operation_key,account_id,state) values('voice:{old['job']}','{A}','dispatched');
insert into icash_call_recordings(id,account_id,voice_job_id,permission_id,screening_id,to_phone,from_phone,call_sid,provider_account_sid,dial_claimed_at,operation_key)
values('{record}','{A}','{old['job']}','{old['permission']}','{old['screen']}','{PHONE}','{SENDER}','CAfixture','ACfixture',now(),'voice:{old['job']}');
update icash_voice_jobs set state='dispatched',operation_key='voice:{old['job']}',provider_call_sid='CAfixture' where id='{old['job']}';""")
    first, latest = assigned(), assigned()
    deadlines = sql('select jsonb_agg(to_jsonb(r) order by lead_id) from icash_optin_call_requests r;')
    before = snapshot(old)
    assert contend([activate(first), activate(latest)]) == ['f', 'f']
    assert snapshot(old) == before
    holder, worker = Session('demo_provider_settlement'), Session('demo_wait_for_terminal')
    try:
        holder.query('begin;select id from icash_operating_budget where id=1 for update;')
        worker.start(activate(latest))
        blocked(worker)
        holder.query(f"update icash_call_recordings set call_ended_at=clock_timestamp() where id='{record}';commit;")
        assert worker.finish() == 'f', 'terminal call without settled spend must remain held'
        holder.query('begin;select id from icash_operating_budget where id=1 for update;')
        worker.start(activate(latest))
        blocked(worker)
        holder.query(f"update icash_operation_spend set state='settled',settled_at=clock_timestamp() where operation_key='voice:{old['job']}';commit;")
        assert worker.finish() == 't'
    finally:
        holder.close()
        worker.close()
    assert contend([activate(first), activate(latest)]) == ['f', 't']
    assert sql('select jsonb_agg(to_jsonb(r) order by lead_id) from icash_optin_call_requests r;') == deadlines
    assert sql(f"select count(*) from icash_call_recordings where id='{record}' and call_sid='CAfixture' and call_ended_at is not null;") == '1'
    # A new request that has already exhausted its original window cannot
    # retire even a safely settled predecessor or manufacture a new deadline.
    expired = assigned()
    sql(f"update icash_optin_call_requests set requested_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' where lead_id='{expired['id']}';")
    expiry = sql(f"select expires_at from icash_optin_call_requests where lead_id='{expired['id']}';")
    assert contend([activate(expired)] * 2) == ['f', 'f']
    assert sql(f"select expires_at from icash_optin_call_requests where lead_id='{expired['id']}';") == expiry

    # Regression for budget/account inversion: a second submit must wait for
    # budget BEFORE taking account FOR SHARE, allowing the first to upgrade.
    reset()
    holder, retry = Session('demo_first_submit'), Session('demo_second_submit')
    try:
        holder.query('begin;' + submit())
        retry.start(submit())
        blocked(retry)
        assert holder.query(f"select count(*) from (select id from icash_accounts where id='{A}' for update) a;") == '1'
        holder.query('commit;')
        assert retry.finish()
    finally:
        holder.close()
        retry.close()

    # A final dial check arriving behind retirement must see the newly revoked
    # source, even though it was eligible before the newer run was submitted.
    reset()
    old = fresh()
    assert sql(f"select icash_owner_demo_call_current('{A}','{old['job']}');") == 't'
    new = assigned()
    holder, late = Session('demo_retirement'), Session('demo_late_dial')
    try:
        assert holder.query('begin;' + activate(new)) == 't'
        late.start("begin;select id from icash_operating_budget where id=1 for update;" +
                   f"select icash_owner_demo_call_current('{A}','{old['job']}');commit;")
        blocked(late)
        holder.query('commit;')
        assert late.finish().splitlines()[-1] == 'f'
    finally:
        holder.close()
        late.close()
    # Actual current reservation and recording claim functions. Credit-amount
    # eligibility is isolated, but reserved operation rows and source delegates
    # are real fences: a retirement cannot pass a concurrent reservation.
    reset()
    old = fresh()
    rate = str(uuid.uuid4())
    sql(f"insert into icash_operation_rates(id,operation,enabled) values('{rate}','seller_call',true);update icash_voice_jobs set state='issued' where id='{old['job']}';")
    holder, restart = Session('demo_reservation'), Session('demo_behind_reservation')
    try:
        holder.query('begin;' + f"select icash_reserve_paced_voice('{A}','{old['job']}','{rate}',now()+interval '2 minutes');")
        # Submit itself waits for the same budget lock before registering intent.
        restart.start(submit())
        blocked(restart)
        holder.query('commit;')
        assert restart.finish()
    finally:
        holder.close()
        restart.close()
    newest = assigned()
    assert sql(activate(newest)) == 'f', 'pending reserved old operation cannot be retired'
    assert sql('select count(*) from fixture_reservation_attempts;') == '1'
    assert sql(f"select retired_at from icash_text_threads where id='{old['thread']}';") == ''

    # Latest registered run alone can reserve and claim; same-record claim races
    # return one receipt, then an unknown claimed attempt fences the next run.
    reset()
    old, newest = fresh(), fresh()
    rate, record = str(uuid.uuid4()), str(uuid.uuid4())
    sql(f"insert into icash_operation_rates(id,operation,enabled) values('{rate}','seller_call',true);update icash_voice_jobs set state='issued' where id='{newest['job']}';")
    reserve = lambda r: f"select icash_reserve_paced_voice('{A}','{r['job']}','{rate}',now()+interval '2 minutes');"
    assert contend([reserve(old), reserve(newest)]) == ['f', 't']
    sql(f"""update icash_operation_spend set state='dispatched' where operation_key='voice:{newest['job']}';
insert into icash_call_recordings(id,account_id,voice_job_id,permission_id,screening_id,from_phone,to_phone,party,state,operation_key,consent_deadline_at,row_version)
values('{record}','{A}','{newest['job']}','{newest['permission']}','{newest['screen']}','{SENDER}','{PHONE}','seller','consent_pending','voice:{newest['job']}',now()+interval '1 minute',0);""")
    dial = f"select icash_transition_call_recording('{record}','{A}','voice:{newest['job']}','consent_pending','claim_dial','{{}}') is not null;"
    assert sorted(contend([dial] * 4)) == ['f', 'f', 'f', 't']
    pending = assigned()
    assert sql(activate(pending)) == 'f'
    assert sql('select count(*) from fixture_reservation_attempts;') == '1'
    assert sql(f"select count(*) from icash_call_recordings where dial_claimed_at is not null and call_sid is null;") == '1'
    # STOP can arrive while the actual final dial waits on its recipient lock.
    # It must be re-read after the wait, not accepted from preflight evidence.
    reset()
    current = fresh()
    record = str(uuid.uuid4())
    sql(f"""update icash_voice_jobs set state='issued' where id='{current['job']}';
insert into icash_operation_spend(operation_key,account_id,state,permission_until) values('voice:{current['job']}','{A}','dispatched',now()+interval '2 minutes');
insert into icash_call_recordings(id,account_id,voice_job_id,permission_id,screening_id,from_phone,to_phone,party,state,operation_key,consent_deadline_at,row_version)
values('{record}','{A}','{current['job']}','{current['permission']}','{current['screen']}','{SENDER}','{PHONE}','seller','consent_pending','voice:{current['job']}',now()+interval '1 minute',0);""")
    holder, final = Session('demo_late_stop'), Session('demo_final_claim')
    try:
        holder.query(f"begin;select pg_advisory_xact_lock(hashtextextended('{PHONE}',74));")
        final.start(f"select icash_transition_call_recording('{record}','{A}','voice:{current['job']}','consent_pending','claim_dial','{{}}') is null;")
        blocked(final)
        holder.query(f"insert into icash_text_suppressions(phone) values('{PHONE}');commit;")
        assert final.finish() == 't'
        assert sql(f"select dial_claimed_at is null from icash_call_recordings where id='{record}';") == 't'
    finally:
        holder.close()
        final.close()
    print('PASS native owner demo: simultaneous retries/distinct runs, atomic retirement, budget/account lock order, routing/phone races, late final-dial rejection, actual reservation/dial contention, and active/unknown holds without expiry renewal. Credit calculation is isolated; no providers.')


if __name__ == '__main__':
    main()
