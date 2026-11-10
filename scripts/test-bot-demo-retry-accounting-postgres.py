"""Real concurrent retry accounting. Fixed disposable localhost PostgreSQL only.

No provider requests, live database configuration, calls, texts or paid work.
The isolated reliability database is rebuilt, matching the other native suites.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import subprocess
from threading import Barrier
import uuid

ROOT = Path(__file__).resolve().parents[1]
ENV = {k: v for k, v in os.environ.items() if k in ('PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT')}
ENV.update(PGPASSWORD='isolated-fixture-only', PGCONNECT_TIMEOUT='5', PGSSLMODE='disable')
CMD = ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
       '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability']
ACCOUNT = '48dfb798-8c1a-404f-88c0-c396cc067062'
OWNER = '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'
USER_KEY = 'bot-demo:id:' + hashlib.sha256(OWNER.encode()).hexdigest()
IP_KEY = 'bot-demo:ip:' + 'd' * 64


def execute(query):
    result = subprocess.run(CMD, input="\\set VERBOSITY verbose\nset statement_timeout='12s';\n" + query,
                            env=ENV, text=True, capture_output=True, timeout=18)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def sql(query):
    code, output, error = execute(query)
    assert code == 0, error
    return output


def fixture():
    result = subprocess.run(['node', 'tests/helpers/bot-demo-retry-fixture.mjs'], cwd=ROOT,
                            env=ENV, text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    return result.stdout


def submit(request=None, ip='d', name='Demo Seller', guest='a', actor=OWNER, account=ACCOUNT):
    # Inputs are fixed fictional fixture strings, never external SQL input.
    request = request or str(uuid.uuid4())
    return ('set role service_role;select icash_submit_limited_bot_demo_intake('
            f"'{actor}','{account}','{request}','{guest*64}','{name}',"
            f"'45 Fixture Lane, Dallas, TX 75201','+12145550123',true,'{'b'*64}',"
            f"'America/Chicago','{'c'*64}','{ip*64}');")


def contend(queries):
    barrier = Barrier(len(queries))
    def call(query):
        barrier.wait(timeout=10)
        return execute(query)
    with ThreadPoolExecutor(max_workers=len(queries)) as pool:
        return list(pool.map(call, queries))


def snapshot():
    return sql("select jsonb_build_object('leads',(select jsonb_agg(to_jsonb(l) order by id) from icash_seller_intakes l),"
               "'limits',(select jsonb_agg(to_jsonb(b) order by bucket) from icash_request_limits b));")


def denied(query, expected):
    before = snapshot()
    code, _, error = execute(query)
    assert code != 0 and expected in error, error
    assert snapshot() == before, 'Refusal must atomically preserve all saved data and counters'


def run():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema public cascade;create schema public;')
    sql(fixture())
    request = str(uuid.uuid4())
    results = contend([submit(request)] * 12)
    assert all(code == 0 for code, _, _ in results), results
    assert len({output for _, output, _ in results}) == 1
    lead = results[0][1]
    assert sql('select count(*) from icash_seller_intakes') == '1'
    assert sql('select min(attempts)||\',\'||max(attempts) from icash_request_limits') == '1,1'
    for _ in range(4):
        sql(submit())
    before = snapshot()
    retries = contend([submit(request, ip='d' if i % 2 else 'e') for i in range(12)])
    assert all(code == 0 and output == lead for code, output, _ in retries), retries
    assert snapshot() == before, 'Retry at cap from another IP is the same admitted intent'
    denied(submit(), 'PT429')
    denied(submit(ip='e'), 'PT429')
    denied(submit(request, name='Changed Seller'), 'Submission retry mismatch')
    denied(submit(request, guest='f'), 'Submission retry mismatch')
    denied(submit(request, actor=str(uuid.uuid4())), 'Presenting account required')
    denied(submit(request, account=str(uuid.uuid4())), 'Presenting account required')
    print('PASS native:12 same-ID races create one intake/charge;12 retries at cap across IPs keep original receipt; sixth intent and changed identities reject atomically.')

    sql('truncate icash_seller_intakes,icash_request_limits;')
    fresh = contend([submit(ip='d' if i % 2 else 'e') for i in range(12)])
    admitted = [output for code, output, _ in fresh if code == 0]
    rejected = [error for code, _, error in fresh if code != 0]
    assert len(admitted) == len(set(admitted)) == 5, fresh
    assert len(rejected) == 7 and all('PT429' in error for error in rejected), fresh
    assert sql('select count(*) from icash_seller_intakes') == '5'
    assert sql(f"select attempts from icash_request_limits where bucket='{USER_KEY}'") == '5'
    assert sql("select sum(attempts) from icash_request_limits where bucket like 'bot-demo:ip:%'") == '5'
    print('PASS native:12 distinct requests from two IPs admit exactly5;7 rejections leave no intake or partial IP/user charge.')

    sql('truncate icash_seller_intakes,icash_request_limits;')
    conflict = str(uuid.uuid4())
    mixed = contend([submit(conflict, name='First Seller' if i % 2 else 'Second Seller') for i in range(12)])
    winners = [output for code, output, _ in mixed if code == 0]
    losers = [error for code, _, error in mixed if code != 0]
    assert len(winners) == 6 and len(set(winners)) == 1, mixed
    assert len(losers) == 6 and all('Submission retry mismatch' in error for error in losers), mixed
    assert sql('select count(*) from icash_seller_intakes') == '1'
    assert sql('select min(attempts)||\',\'||max(attempts) from icash_request_limits') == '1,1'
    print('PASS native: conflicting concurrent same-ID payloads cannot bypass validation or create another intent.')

    sql('truncate icash_seller_intakes,icash_request_limits;')
    uncertain = str(uuid.uuid4())
    sql('begin;' + submit(uncertain) + 'rollback;')
    assert sql('select count(*) from icash_seller_intakes') == '0'
    recovered = sql(submit(uncertain))
    before = snapshot()
    assert sql(submit(uncertain)) == recovered
    assert snapshot() == before
    denied(submit(name=''), 'check constraint')
    for role in ('anon', 'authenticated'):
        assert sql(f"select has_function_privilege('{role}','public.icash_submit_limited_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,text)','execute')") == 'f'
    sql('truncate icash_seller_intakes,icash_request_limits;')
    sql(f"insert into icash_request_limits values('{IP_KEY}',now(),4),('{USER_KEY}',now(),4)")
    sql(submit()); denied(submit(), 'PT429')
    print('PASS native: rolled-back and committed unknown outcomes recover once; payload failures roll back accounting; legacy usage and private RPC permissions remain intact.')


if __name__ == '__main__':
    import sys
    if '--print-fixture' in sys.argv:
        print(fixture())
    else:
        run()
