"""Reproduce the live recovery/account FK deadlock on disposable localhost PG.

No production connection, provider call, customer receipt or financial mutation.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, 'PGPASSWORD': 'isolated-fixture-only', 'PGCONNECT_TIMEOUT': '5'}
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
       '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability']
A = '00000000-0000-4000-8000-000000000001'
B = '00000000-0000-4000-8000-000000000002'


def sql(source):
    result = subprocess.run(CMD, input="set statement_timeout='8s';\n" + source,
                            text=True, capture_output=True, env=ENV, timeout=12)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def function(file, schema, name):
    source = (ROOT / 'config' / (file + '.sql')).read_text()
    start = re.search(r'create (?:or replace )?function ' + re.escape(schema + '.' + name) + r'\(', source).start()
    tag = re.search(r'\bas (\$[A-Za-z_]*\$)', source[start:], re.I).group(1)
    body = source.index(tag, start)
    return source[start:source.index(tag + ';', body + len(tag)) + len(tag) + 1]


class Session:
    def __init__(self, name):
        self.p = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True, bufsize=1, env=ENV)
        self.lines = queue.Queue()
        def read():
            for line in self.p.stdout:
                self.lines.put(line.rstrip())
            self.lines.put(None)
        threading.Thread(target=read, daemon=True).start()
        self.query(f"set application_name='{name}'; set statement_timeout='8s'; set deadlock_timeout='100ms';")

    def start(self, source):
        self.p.stdin.write(source + '\n\\echo fixture_done\n')
        self.p.stdin.flush()

    def finish(self):
        result = []
        while True:
            line = self.lines.get(timeout=10)
            if line == 'fixture_done' or line is None:
                return '\n'.join(result)
            if line:
                result.append(line)

    def query(self, source):
        self.start(source)
        return self.finish()

    def close(self):
        if self.p.poll() is None:
            self.p.stdin.close()
            self.p.wait(timeout=3)


def setup(fixed):
    # Exercise the actual parent/child FKs under independent sessions.
    source = (ROOT / 'config/parallel-work-throughput.sql').read_text()
    queue_table = re.search(r'create table icash_work_private.account_followups\([\s\S]*?\n\);', source).group()
    sql("""drop schema if exists icash_work_private cascade; drop schema public cascade; create schema public;
create schema icash_work_private;
create table icash_accounts(id uuid primary key,bot_paused boolean default true);
create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid references icash_accounts(id),
 kind text,state text default 'issued',token text unique default gen_random_uuid()::text,outcome text,completed_at timestamptz);
create table icash_operation_spend(operation_key text primary key,account_id uuid references icash_accounts(id),state text,created_at timestamptz default now(),dispatched_at timestamptz);
create table icash_work_private.dispatch_policy(id int primary key,last_seed_at timestamptz);
insert into icash_work_private.dispatch_policy values(1,clock_timestamp());
""" + queue_table + """
alter table icash_work_private.account_followups add column unchanged_attempts integer not null default 0,add column failure_attempts integer not null default 0;
""" + function('parallel-work-throughput', 'public', 'icash_issue_account_followup')
        + function('runtime-cost-efficiency', 'icash_work_private', 'wake_account_followup')
        + function('runtime-cost-efficiency', 'public', 'icash_finish_account_followup'))
    sql(f"""insert into icash_accounts(id) values('{A}'),('{B}');
insert into icash_work_private.account_followups(account_id,next_run_at) values('{A}',now()-interval '2 minutes'),('{B}',now()-interval '1 minute');
insert into icash_operation_spend(operation_key,account_id,state) values('original-held-operation','{A}','dispatched');""")
    if fixed:
        sql((ROOT / 'config/account-recovery-parent-lock.sql').read_text())


setup(False)
sender, recovery = Session('original_sender'), Session('original_recovery')
try:
    sender.query(f"begin;select id from icash_accounts where id='{A}' for update;")
    recovery.query('begin;')
    recovery.start('select icash_issue_account_followup();')
    deadline = time.monotonic() + 5
    while sql("select exists(select 1 from pg_stat_activity where application_name='original_recovery' and wait_event_type='Lock')") != 't':
        assert time.monotonic() < deadline, 'Original issuer did not reach the parent FK wait'
        time.sleep(.03)
    sender.start(f"select icash_work_private.wake_account_followup('{A}');commit;")
    outcomes = sender.finish() + recovery.finish()
    assert 'deadlock detected' in outcomes, outcomes
finally:
    sender.close()
    recovery.close()

setup(True)
sender, recovery = Session('fixed_sender'), Session('fixed_recovery')
try:
    sender.query(f"begin;select id from icash_accounts where id='{A}' for update;")
    recovery.query('begin;')
    result = recovery.query('select icash_issue_account_followup();')
    token = json.loads(result)['token']
    assert recovery.query(f"select account_id from icash_automation_tickets where token='{token}';") == B
    recovery.query('commit;')
    # Finishing the normal dispatch can wake the skipped account immediately.
    assert 'ERROR' not in sender.query(f"select icash_work_private.wake_account_followup('{A}',true);commit;")
finally:
    sender.close()
    recovery.close()

with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    results = list(pool.map(lambda _: sql('select icash_issue_account_followup();'), range(16)))
assert sum(bool(r) for r in results) == 1, results
assert sql(f"select count(*) from icash_automation_tickets where account_id='{A}'") == '1'
ticket = sql(f"select id from icash_automation_tickets where account_id='{A}'")
sql(f"update icash_automation_tickets set state='consumed' where id='{ticket}';select icash_work_private.wake_account_followup('{A}',true);")
assert sql(f"select icash_finish_account_followup('{B}','{ticket}',true)") == 'f'
assert sql(f"select icash_finish_account_followup('{A}','{ticket}',true)") == 't'
assert sql(f"select requested_version>completed_version and next_run_at<=clock_timestamp() from icash_work_private.account_followups where account_id='{A}'") == 't'
sql('select icash_issue_account_followup();')
assert sql(f"select icash_finish_account_followup('{A}','{ticket}',true)") == 'f', 'stale completion rejected'
assert sql("select state from icash_operation_spend where operation_key='original-held-operation'") == 'dispatched'
assert sql('select bool_and(bot_paused) from icash_accounts') == 't'
assert sql("select bool_and(kind='account_reconcile') from icash_automation_tickets") == 't'
print('PASS native PostgreSQL: original parent/queue FK deadlock reproduced; fixed issuer skips a locked account, preserves its wakeup, admits one of 16 concurrent claims and retains original holds/Pause.')
