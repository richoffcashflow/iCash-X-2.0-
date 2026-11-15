"""Native stop/result/final-send races in a disposable local CI PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import select
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENV = {k: v for k, v in os.environ.items() if k in ('PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT')}
ENV.update(PGPASSWORD='isolated-fixture-only', PGCONNECT_TIMEOUT='3', PGSSLMODE='disable')
BASE = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55443', '-U', 'postgres']
DB = 'icash_seller_terminal_fixture'
CMD = BASE + ['-d', DB]


def sql(query, database=DB):
    r = subprocess.run(BASE + ['-d', database], input="set statement_timeout='8s';\n" + query,
                       text=True, capture_output=True, env=ENV, timeout=15)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


raw = subprocess.run(['node', '--experimental-strip-types', 'tests/seller-negative-response-database.test.mjs', '--emit-terminal-native'],
                     cwd=ROOT, capture_output=True, text=True, timeout=60)
assert raw.returncode == 0, raw.stderr
fixture = json.loads(raw.stdout)
ids = fixture['ids']
for role in ('anon', 'authenticated', 'service_role'):
    statement = f'create role {role}' + (' bypassrls' if role == 'service_role' else '') + ';'
    fixture['sql'] = fixture['sql'].replace(statement, f'do $$begin {statement} exception when duplicate_object then null;end$$;')


def setup(kind):
    sql('drop schema if exists icash_recorded_reception_private cascade;drop schema if exists icash_seller_agreement_private cascade;drop schema public cascade;create schema public;')
    sql(fixture['sql'])
    rid = str(uuid.uuid4())
    operation = 'voice:' + rid
    conversation = 'conv_' + rid.replace('-', '')
    if kind == 'call':
        sql(f"insert into icash_call_recordings values('{rid}','{ids['a']}','{operation}','{ids['screen']}','seller','{{}}','CAfixture','REfixture','{conversation}','{ids['phone']}','{ids['hash']}',null,'recording');"
            f"update icash_live_conversations set operation_key='{operation}',conversation_id='{conversation}' where id='{ids['call']}';")
        stop = f"do $stop$begin perform icash_transition_call_recording('{rid}','{ids['a']}','{operation}','recording','stop','{{}}');end $stop$;"
        result = lambda body: f"do $result$begin perform icash_save_live_result('{ids['call']}', '{json.dumps({'optedOut': False, 'transcript': [{'role': 'user', 'message': body}]})}');end $result$;"
    else:
        sql(f"insert into icash_recorded_reception_private.sessions values('{rid}','{ids['a']}','{operation}','CAfixture','REfixture','{conversation}','{ids['phone']}','{ids['hash']}',null,'recording',now());"
            f"insert into icash_seller_agreement_private.inbound_bindings values('{rid}','{ids['a']}','{ids['deal']}','{ids['thread']}');")
        stop = f"do $stop$begin perform icash_transition_recorded_reception('{rid}','{ids['a']}','{operation}',1,'stop','{{}}');end $stop$;"
        result = lambda body: f"insert into icash_seller_agreement_private.call_history(session_id,account_id,screening_id,contact_key,completed_at,transcript,conversation_id) values('{rid}','{ids['a']}','{ids['screen']}','{ids['hash']}',now(),'{json.dumps([{'role': 'user', 'message': body}])}','{conversation}');"
    return stop, result


def admission():
    # The production final claim already owns this budget lock before invoking
    # the real response predicate installed in the synthetic fixture.
    return sql("begin;set application_name='seller-terminal-contender';do $$begin perform 1 from icash_operating_budget where id=1 for update;end$$;"
               f"select icash_seller_response_operation_allowed('{ids['a']}','text:{ids['outgoing']}');commit;")


def race(mutation, expected, contender=None):
    holder = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        holder.stdin.write("begin;" + mutation + "select 'locked';\n")
        holder.stdin.flush()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if select.select([holder.stdout], [], [], .1)[0] and holder.stdout.readline().strip() == 'locked':
                break
        else:
            raise AssertionError('Mutation did not reach admission boundary')
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(admission if contender is None else lambda: sql("begin;set application_name='seller-terminal-contender';" + contender + "commit;"))
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if sql("select exists(select 1 from pg_stat_activity where application_name='seller-terminal-contender' and wait_event_type='Lock');") == 't':
                    break
                time.sleep(.025)
            else:
                raise AssertionError('Final admission did not serialize')
            holder.stdin.write('commit;\n')
            holder.stdin.flush()
            holder.stdin.close()
            holder.stdin = None
            _, error = holder.communicate(timeout=5)
            assert holder.returncode == 0, error
            assert pending.result(timeout=10) == expected
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)


assert sql('select current_database();', 'icash_reliability') == 'icash_reliability'
sql(f'create database {DB};', 'icash_reliability')
try:
    for kind in ('call', 'inbound_call'):
        stop, result = setup(kind)
        race(stop, 'f')
        race(result('The price is too low'), 't')
        stop, result = setup(kind)
        sql(stop)
        race(result('Fuck off'), 'f')
        assert sql(f"select count(*) from icash_text_suppressions where phone='{ids['phone']}';") == '1'
        stop, result = setup(kind)
        sql(result('The price is too low'))
        race(stop, 't')
        # Both competing mutations must acquire their own production lock.
        # No harness prelock is allowed to make a missing stop lock pass.
        stop, result = setup(kind)
        race(stop, '', result('The price is too low'))
        assert sql(f"select icash_seller_terminal_receipt_pending('{ids['a']}','{ids['phone']}');") == 'f'
        stop, result = setup(kind)
        race(result('The price is too low'), '', stop)
        assert sql(f"select icash_seller_terminal_receipt_pending('{ids['a']}','{ids['phone']}');") == 'f'
    print('PASS native outbound/inbound stop, final-send and source-result serialization; hostile receipt suppresses before wait resolves; benign result resumes; source-before-stop race remains resolved. No providers.')
finally:
    sql(f'drop database {DB};', 'icash_reliability')
