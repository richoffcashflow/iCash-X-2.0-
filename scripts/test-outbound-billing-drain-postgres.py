"""Native queue locking against real settlement readback; disposable localhost only."""
import json
import os
from pathlib import Path
import queue
import subprocess
import threading

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, 'PGPASSWORD': 'isolated-fixture-only', 'PGCONNECT_TIMEOUT': '5'}
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
       '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability']


def sql(source):
    r = subprocess.run(CMD, input="set statement_timeout='5s';\n" + source,
                       text=True, capture_output=True, env=ENV, timeout=10)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


class Session:
    def __init__(self):
        self.p = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, text=True, bufsize=1, env=ENV)
        self.lines = queue.Queue()
        def consume():
            for line in self.p.stdout:
                self.lines.put(line.rstrip())
            self.lines.put(None)
        threading.Thread(target=consume, daemon=True).start()
        self.run("set statement_timeout='5s';")

    def run(self, source):
        self.p.stdin.write(source + '\n\\echo fixture_done\n')
        self.p.stdin.flush()
        out = []
        while True:
            line = self.lines.get(timeout=7)
            assert line is not None, out
            if line == 'fixture_done':
                return '\n'.join(out)
            if line:
                out.append(line)

    def close(self):
        if self.p.poll() is None:
            self.p.stdin.close()
            self.p.wait(timeout=3)


def setup():
    for path in ['tests/fixtures/outbound-billing-drain.sql', 'config/outbound-billing-queue.sql',
                 'supabase/migrations/20261104200000_confirmed_billing_queue_drain.sql']:
        sql((ROOT / path).read_text())


setup()
sql('select fixture_billing_seed(n) from generate_series(1,100) n;select fixture_billing_seed(101,false);select fixture_billing_seed(102,false);')
a, b = Session(), Session()
try:
    a.run('begin;')
    first = json.loads(a.run('select icash_claim_outbound_billing();'))[0]
    second = json.loads(b.run('select icash_claim_outbound_billing();'))[0]
    assert first['call_id'].endswith('000000000101'), first
    assert second['call_id'].endswith('000000000102'), second
    assert first['lease_token'] != second['lease_token']
    a.run('commit;')
    assert sql("select count(*) from icash_outbound_billing_private.queue where state='completed'") == '100'
    assert sql("select count(*) from icash_operation_spend where state='settled'") == '100'
    assert sql('select count(*) from icash_credit_ledger') == '100'
finally:
    a.close()
    b.close()

setup()
sql('select fixture_billing_seed(1);select fixture_billing_seed(2);select fixture_billing_seed(3,false);')
a, b = Session(), Session()
try:
    a.run("begin;select 1 from icash_outbound_billing_private.queue where call_id='00000000-0000-4000-8000-000000000001' for update;")
    job = json.loads(b.run('select icash_claim_outbound_billing();'))[0]
    assert job['call_id'].endswith('000000000003'), job
    assert sql("select count(*) from icash_outbound_billing_private.queue where state='completed'") == '1'
    a.run('commit;')
    assert json.loads(b.run('select icash_claim_outbound_billing();')) == []
    assert sql("select count(*) from icash_outbound_billing_private.queue where state='completed'") == '2'
finally:
    a.close()
    b.close()

setup()
sql('select fixture_billing_seed(n) from generate_series(1,101) n;')
assert len(json.loads(sql('select icash_claim_outbound_billing();'))) == 1
assert sql("select count(*) from icash_outbound_billing_private.queue where state='completed'") == '100'
assert sql("select count(*) from icash_outbound_billing_private.queue where state='leased'") == '1'
assert sql('select count(*) from icash_credit_ledger') == '101'
print('PASS native bounded billing drain: concurrent recovery, locked-row isolation, exact leases, 100-row ceiling, unchanged ledger. No providers.')
