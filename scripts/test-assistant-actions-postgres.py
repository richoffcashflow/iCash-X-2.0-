"""Saved Ask AI action races in the disposable localhost CI database; no providers."""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, 'PGPASSWORD': 'isolated-fixture-only', 'PGCONNECT_TIMEOUT': '5'}
CMD = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability']

def sql(text):
    r = subprocess.run(CMD, input="set statement_timeout='8s';\n" + text, text=True, capture_output=True, env=ENV, timeout=12)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()

sql('drop schema public cascade;create schema public;')
fixture = (ROOT/'tests/fixtures/assistant-text-actions.sql').read_text()
for role in ['anon', 'authenticated', 'service_role']:
    fixture = fixture.replace('create role '+role+';', "do $$begin if not exists(select 1 from pg_roles where rolname='"+role+"') then create role "+role+";end if;end$$;")
sql(fixture + (ROOT/'config/assistant-text-actions.sql').read_text())
sql('update icash_assistant_action_settings set enabled=true;')

def seed():
    c = {key: str(uuid.uuid4()) for key in ['a', 'actor', 'd', 's', 't', 'source', 'q', 'key']}
    answer = json.dumps({'actions': [{'kind': 'property', 'screeningId': c['s'], 'threadId': c['t'], 'draft': {'threadId': c['t'], 'latestMessageId': c['source']}}]})
    sql(f"""insert into icash_accounts values('{c['a']}','{c['actor']}');
    insert into icash_deal_files(id,account_id,screening_id) values('{c['d']}','{c['a']}','{c['s']}');
    insert into icash_text_threads(id,account_id,deal_id) values('{c['t']}','{c['a']}','{c['d']}');
    insert into icash_text_messages(id,account_id,thread_id,direction,state,body,created_at) values('{c['source']}','{c['a']}','{c['t']}','incoming','received','Please ask for photos',now()-interval '1 minute');
    insert into icash_workspace_questions(id,account_id,answer) values('{c['q']}','{c['a']}','{answer}');""")
    return c

def queue(c):
    return json.loads(sql(f"select icash_queue_assistant_text('{c['actor']}','{c['a']}','{c['q']}',0,'{uuid.uuid4()}','Could you share property photos?');"))['id']

def claim(c, message):
    return sql(f"select icash_claim_customer_text('{c['a']}','{message}','fixture');")

c = seed()
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    messages = list(pool.map(lambda _: queue(c), range(8)))
assert len(set(messages)) == 1
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    receipts = list(pool.map(lambda _: claim(c, messages[0]), range(8)))
assert sum(bool(r) for r in receipts) == 1

# An inbound insert already in progress must commit before the final source
# check. FOR UPDATE on the thread conflicts with its foreign-key KEY SHARE.
c = seed(); message = queue(c)
receiver = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
receiver.stdin.write(f"begin;insert into icash_text_messages(account_id,thread_id,direction,state,body) values('{c['a']}','{c['t']}','incoming','received','I already sent those');\n\\echo source_inserted\n")
receiver.stdin.flush()
assert receiver.stdout.readline().strip() == 'source_inserted'
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    pending = pool.submit(claim, c, message)
    receiver.stdin.write('commit;\n');receiver.stdin.close()
    assert receiver.wait(timeout=5) == 0, receiver.stderr.read()
    assert pending.result() == ''
assert claim(c,message) == ''
assert sql(f"select state from icash_text_messages where id='{message}'") == 'cancelled'

# Production incoming observers acquire the budget after the message FK lock.
# Reproduce the opposite lock order: the claimant must yield without deadlock.
sql("""create function fixture_inbound_observer() returns trigger language plpgsql as $$begin
 if new.direction='incoming' then perform 1 from icash_operating_budget where id=1 for update;end if;return new;end$$;
 create trigger fixture_inbound after insert on icash_text_messages for each row execute function fixture_inbound_observer();""")
c = seed(); message = queue(c)
locker = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
locker.stdin.write("begin;select 1 from icash_operating_budget where id=1 for update;\n\\echo budget_locked\n");locker.stdin.flush()
assert locker.stdout.readline().strip() == '1'
assert locker.stdout.readline().strip() == 'budget_locked'
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    receiver = pool.submit(sql, f"set application_name='assistant_inbound_race';insert into icash_text_messages(account_id,thread_id,direction,state,body) values('{c['a']}','{c['t']}','incoming','received','New source');")
    # Observe the actual lock wait; do not assume a sleep establishes ordering.
    import time
    deadline = time.monotonic()+5
    while sql("select count(*) from pg_stat_activity where application_name='assistant_inbound_race' and wait_event_type='Lock'") != '1':
        assert time.monotonic() < deadline
        time.sleep(.01)
    locker.stdin.write(f"select coalesce(icash_claim_customer_text('{c['a']}','{message}','fixture')::text,'yielded');\n\\echo claim_finished\n");locker.stdin.flush()
    assert locker.stdout.readline().strip() == 'yielded'
    assert locker.stdout.readline().strip() == 'claim_finished'
    locker.stdin.write('commit;\n');locker.stdin.close();assert locker.wait(timeout=5) == 0
    receiver.result()
assert claim(c,message) == ''
assert sql(f"select state from icash_text_messages where id='{message}'") == 'cancelled'

# An uncertain provider claim never reopens, even if the original action is
# clicked again or a second browser uses another request key.
c = seed(); message = queue(c)
assert claim(c, message)
sql(f"update icash_text_messages set state='needs_review' where id='{message}';")
assert queue(c) == message and claim(c, message) == ''
assert sql(f"select count(*) from fixture_receipts where message_id='{message}'") == '1'
print('PASS native Ask AI actions: eight concurrent queues/claims, inbound commit before dispatch, and uncertain original receipts never replay.')
