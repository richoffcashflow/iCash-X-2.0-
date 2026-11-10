"""Real concurrent read-committed visibility; disposable localhost CI database only."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, 'PGPASSWORD': 'isolated-fixture-only', 'PGCONNECT_TIMEOUT': '5'}
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability']

def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='8s';\n"+query, env=ENV, text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()

def read(path):
    return (ROOT/path).read_text()

assert sql('select current_database();') == 'icash_reliability'
sql('drop schema if exists icash_recording_private cascade;drop schema if exists icash_recorded_reception_private cascade;drop schema public cascade;create schema public;')
schema = read('tests/fixtures/stalled-voice-capacity-schema.sql')
for role in ['anon', 'authenticated', 'service_role']:
    schema = schema.replace(f'create role {role};', f"do $$begin if not exists(select 1 from pg_roles where rolname='{role}') then create role {role};end if;end$$;")
sql(schema)
sql("alter table icash_voice_capacity_policy add credit_state text;create table icash_recording_private.capacity_quarantines(operation_key text,account_id uuid,voice_job_id uuid,contact_key text);create index fixture_recording_operation on icash_call_recordings(operation_key);create index fixture_gate_recording on icash_recorded_gate_terminal_receipts(recording_id);create index fixture_cost_recording on icash_recording_private.terminal_cost_receipts(recording_id);")
original = read('tests/fixtures/voice-contact-holds-before.sql')
sql(original)
sql(original.replace('public.icash_voice_contact_holds()', 'public.fixture_original_holds()'))
for f in json.loads(read('tests/fixtures/voice-contact-holds-downstream.json')):
    sql(f['definition'])
sql(read('config/voice-contact-holds-terminal-prefilter.sql'))
sql(read('tests/fixtures/voice-contact-holds-volume.sql'))
diff = "select count(*) from ((select * from fixture_original_holds() except all select * from icash_voice_contact_holds()) union all (select * from icash_voice_contact_holds() except all select * from fixture_original_holds())) d;"
with ThreadPoolExecutor(max_workers=8) as pool:
    assert set(pool.map(lambda _: sql(diff), range(16))) == {'0'}
# Verify final admission in an already-open read-committed transaction sees a
# second connection's committed incoming hold, not its earlier saved snapshot.
a = '00000000-0000-4000-8000-000000000001'
b = '00000000-0000-4000-8000-000000000002'
sql(f"truncate icash_call_recordings,icash_recorded_gate_terminal_receipts;insert into icash_voice_configs(account_id,agent_id) values('{a}','agent'),('{b}','agent');insert into icash_voice_capacity_policy values(1,32,now(),'available');insert into icash_voice_agent_capacity values('agent',32,now());insert into icash_wallets values('{a}',30000,0);")
reader = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
try:
    reader.stdin.write("begin isolation level read committed;set local statement_timeout='8s';create temporary table saved_snapshot as select icash_recording_private.voice_capacity_snapshot() snapshot;select 'snapshot-ready';\n")
    reader.stdin.flush()
    assert reader.stdout.readline().strip() == 'snapshot-ready'
    # Writer holds the new row uncommitted. Separate readers cannot see it.
    writer = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        writer.stdin.write(f"begin;set local statement_timeout='8s';insert into icash_recorded_reception_private.sessions values('incoming:concurrent','{b}','agent','same',null);select 'uncommitted';\n")
        writer.stdin.flush()
        assert writer.stdout.readline().strip() == 'uncommitted'
        assert sql("select count(*) from icash_voice_contact_holds() where contact_key='same';") == '0'
        writer.stdin.write("commit;select 'committed';\n");writer.stdin.flush()
        assert writer.stdout.readline().strip() == 'committed'
        writer.stdin.close();assert writer.wait(timeout=10) == 0
    finally:
        if writer.poll() is None: writer.kill()
    reader.stdin.write(f"select icash_recording_private.voice_capacity_from_snapshot('{a}','agent','new','same',false,(select snapshot from saved_snapshot));select icash_voice_capacity_available('{a}','agent','new','same',false);commit;\n")
    reader.stdin.flush()
    assert reader.stdout.readline().strip() == 't'
    assert reader.stdout.readline().strip() == 'f'
    reader.stdin.close();assert reader.wait(timeout=10) == 0
finally:
    if reader.poll() is None: reader.kill()
# Keep a reader transaction open across another session's rollback and commit.
# Both original terminal sources must retain uncommitted/rolled-back holds and
# release only their exactly bound operation after the terminal receipt commits.
reader = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
writer = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)

def exchange(process, query, expected):
    process.stdin.write(query+"\n")
    process.stdin.flush()
    actual = process.stdout.readline().strip()
    assert actual == expected, (actual, expected)

try:
    for i, kind in enumerate(['gate', 'cost'], start=1):
        recording = f'00000000-0000-4000-8000-{90000+i:012d}'
        op, contact, sid = f'receipt:{kind}', f'receipt-contact:{kind}', f'CAreceipt{i}'
        sql(f"insert into icash_call_recordings(id,account_id,operation_key,agent_id,contact_key,state,call_sid) values('{recording}','{b}','{op}','agent','{contact}','active','{sid}');")
    exchange(reader, "begin isolation level read committed;set local statement_timeout='8s';select 'receipt-reader-ready';", 'receipt-reader-ready')
    for i, kind in enumerate(['gate', 'cost'], start=1):
        recording = f'00000000-0000-4000-8000-{90000+i:012d}'
        op, contact, sid = f'receipt:{kind}', f'receipt-contact:{kind}', f'CAreceipt{i}'
        if kind == 'gate':
            insert = f"insert into icash_recorded_gate_terminal_receipts values('{recording}','{b}','{sid}',jsonb_build_object('status','completed'));"
        else:
            insert = f"insert into icash_recording_private.terminal_cost_receipts values('{recording}',jsonb_build_object('status','completed','callSid','{sid}'));"
        def check(held):
            # Each SELECT is a fresh snapshot inside the same open transaction.
            for fn in ['fixture_original_holds', 'icash_voice_contact_holds']:
                exchange(reader, f"select count(*) from {fn}() where operation_key='{op}';", '1' if held else '0')
            exchange(reader, f"select icash_voice_capacity_available('{a}','agent','new','{contact}',false);", 'f' if held else 't')
            exchange(reader, diff, '0')
        check(True)
        exchange(writer, "begin;set local statement_timeout='8s';"+insert+"select 'pending-rollback';", 'pending-rollback')
        check(True)
        exchange(writer, "rollback;select 'rolled-back';", 'rolled-back')
        check(True)
        exchange(writer, "begin;set local statement_timeout='8s';"+insert+"select 'pending-commit';", 'pending-commit')
        check(True)
        exchange(writer, "commit;select 'receipt-committed';", 'receipt-committed')
        check(False)
    exchange(reader, "commit;select 'receipt-reader-done';", 'receipt-reader-done')
    reader.stdin.close();writer.stdin.close()
    assert reader.wait(timeout=10) == 0
    assert writer.wait(timeout=10) == 0
finally:
    for process in [reader, writer]:
        if process.poll() is None: process.kill()
with ThreadPoolExecutor(max_workers=8) as pool:
    assert set(pool.map(lambda _: sql(diff), range(16))) == {'0'}
print('PASS native: 32 concurrent equivalence reads; fresh final admission sees committed incoming holds; original and optimized holds preserve uncommitted/rolled-back gate and cost receipts and observe their commits within one READ COMMITTED reader transaction.')
