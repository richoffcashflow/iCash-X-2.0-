"""Original incoming receipt/retry races, disposable localhost PostgreSQL only."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, 'PGPASSWORD': 'isolated-fixture-only', 'PGCONNECT_TIMEOUT': '5'}
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability']
FIXTURE = json.loads(subprocess.check_output(['node', str(ROOT / 'tests/helpers/reception-retry-fixture.mjs')], text=True))
TABLE = 'icash_recorded_reception_private.sessions'


def sql(source):
    r = subprocess.run(CMD, input="set statement_timeout='8s';\n" + source, text=True, capture_output=True, env=ENV, timeout=12)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


class Session:
    def __init__(self, name):
        self.p = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=ENV)
        self.lines = queue.Queue()
        def read():
            for line in self.p.stdout:
                self.lines.put(line.rstrip())
            self.lines.put(None)
        threading.Thread(target=read, daemon=True).start()
        self.query(f"set application_name='{name}';set statement_timeout='8s';")

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


def setup():
    sql(FIXTURE['setupSql'] + FIXTURE['migration'])


def claim():
    return json.loads(sql("select icash_claim_recorded_reception_work('reconcile',3,120);"))


def due():
    return sql(f'select next_reconcile_at<=clock_timestamp() from {TABLE};') == 't'


def waiting(name):
    deadline = time.monotonic() + 5
    while sql(f"select exists(select 1 from pg_stat_activity where application_name='{name}' and wait_event_type='Lock');") != 't':
        assert time.monotonic() < deadline, 'Expected original session row lock'
        time.sleep(.02)


setup()
original_money = sql('select to_jsonb(o) from icash_operation_spend o;')
barrier = threading.Barrier(24)
def competing(_):
    barrier.wait(timeout=10)
    return claim()
with ThreadPoolExecutor(max_workers=24) as pool:
    results = list(pool.map(competing, range(24)))
assert sum(len(r) for r in results) == 1, results
assert sql(f'select reconcile_attempts from {TABLE};') == '12'
sql(FIXTURE['finishSql'] + ';')
assert not due()
assert sql(f"select extract(epoch from next_reconcile_at-clock_timestamp()) between 3590 and 3600 from {TABLE};") == 't'
assert sql('select to_jsonb(o) from icash_operation_spend o;') == original_money
print('PASS 24 native workers claim one original incoming session; unchanged costs/holds and bounded hourly retry')

# Receipt commits first while the old handler is waiting on its session row.
setup(); claim()
receipt, worker = Session('incoming_receipt_first'), Session('incoming_retry_waiting')
try:
    receipt.query('begin;' + FIXTURE['bindSql'] + ';')
    worker.start(FIXTURE['finishSql'] + ';')
    waiting('incoming_retry_waiting')
    receipt.query('commit;')
    assert worker.finish() == '', 'Old row version cannot overwrite canonical late identity'
    assert due()
    sql(FIXTURE['finishSql'] + ';')
    assert due(), 'Handler rereading the new version must retain immediate recovery'
finally:
    receipt.close(); worker.close()
print('PASS native late canonical identity wins before retry completion, including fresh-version reread')

# Retry commits first; an old callback CAS fails and its fresh ordinary retry
# accepts the exact canonical identity and wakes the same original session.
setup(); claim()
worker, receipt = Session('incoming_retry_first'), Session('incoming_receipt_waiting')
try:
    worker.query('begin;' + FIXTURE['finishSql'] + ';')
    receipt.start(FIXTURE['bindSql'] + ';')
    waiting('incoming_receipt_waiting')
    worker.query('commit;')
    assert receipt.finish() == '', 'Stale receipt CAS remains rejected'
    assert not due()
    sql(FIXTURE['bindSql'] + ';')
    assert due()
    assert sql(f"select conversation_id from {TABLE};") == 'conv_originalfixture'
finally:
    worker.close(); receipt.close()
print('PASS native receipt after completion wakes original session; stale callback cannot overwrite newer state')

setup(); old = claim()[0]
sql(f"update {TABLE} set reconcile_lease_expires_at=clock_timestamp()-interval '1 second',row_version=row_version+1;")
new = claim()[0]
assert old['reconcile_lease_token'] != new['reconcile_lease_token']
stale = f"select icash_finish_recorded_reception_work(id,account_id,operation_key,'reconcile','{old['reconcile_lease_token']}',row_version,'retry','{{\"reason\":\"conversation_identity_required\"}}') from {TABLE};"
assert sql(stale) == ''
assert sql(f"select reconcile_lease_token::text from {TABLE};") == new['reconcile_lease_token']
assert sql('select to_jsonb(o) from icash_operation_spend o;') == original_money
print('PASS expired worker cannot finish replacement lease or mutate financial history')
