"""Native notice-ingest/final-admission races in a disposable loopback cluster.
Requires psycopg3, node and native Postgres (or ICASH_TEST_PG_BIN_DIR). No service
credentials, production URLs, provider calls, real messages or external writes.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from uuid import uuid4
import psycopg
from psycopg.types.json import Jsonb
ROOT = Path(__file__).resolve().parents[1]
NOTICE = 'Free Msg: Receiver 12125550123 unable to receive message - Message Blocking is active'

@contextmanager
def database():
    binary = os.environ.get('ICASH_TEST_PG_BIN_DIR')
    init = str(Path(binary)/'initdb') if binary else shutil.which('initdb')
    server = str(Path(binary)/'postgres') if binary else shutil.which('postgres')
    if not init or not server:
        raise RuntimeError('Native PostgreSQL required; not substituting serial PGlite')
    with tempfile.TemporaryDirectory(prefix='icash-carrier-native-') as temp:
        fixture = temp+'/fixture.sql'
        subprocess.run(['node', '--experimental-strip-types', 'tests/carrier-text-notice-flow.test.mjs'], cwd=ROOT, env={**os.environ, 'CARRIER_NOTICE_FIXTURE_OUTPUT': fixture}, check=True)
        env = {**os.environ, 'LC_ALL': 'C'}
        if binary:
            env['LD_LIBRARY_PATH'] = str(Path(binary).parent/'lib')
        subprocess.run([init, '-D', temp+'/data', '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8'], env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        dsn = f'host=127.0.0.1 port={port} user=postgres dbname=postgres connect_timeout=2'
        with open(temp+'/server.log', 'w+') as log:
            proc = subprocess.Popen([server, '-D', temp+'/data', '-h', '127.0.0.1', '-p', str(port), '-k', '', '-c', 'shared_buffers=16MB', '-c', 'max_connections=10', '-c', 'work_mem=2MB'], env=env, stdout=log, stderr=log)
            try:
                for _ in range(100):
                    try:
                        with psycopg.connect(dsn) as con: con.execute('select 1')
                        break
                    except psycopg.OperationalError:
                        if proc.poll() is not None: log.seek(0); raise RuntimeError(log.read())
                        time.sleep(.05)
                else: raise RuntimeError('Native startup timeout')
                with psycopg.connect(dsn, autocommit=True) as con:
                    con.execute(Path(fixture).read_text())
                    # This models the existing one-use financial admission after
                    # every real new guard. It never calls a paid provider.
                    con.execute("""create or replace function icash_claim_before_seller_response(text) returns boolean language plpgsql set search_path=public as $$begin
                    update icash_operation_spend set state='dispatched',dispatched_at=clock_timestamp() where operation_key=$1 and state='reserved';
                    if not found then return false;end if;insert into fixture_claims values($1);return true;end$$;""")
                yield dsn
            finally:
                proc.terminate()
                try: proc.wait(timeout=10)
                except subprocess.TimeoutExpired: proc.kill();proc.wait(timeout=5)

def connection(dsn, name):
    con=psycopg.connect(dsn, autocommit=True)
    con.execute("select set_config('application_name',%s,false)",[name]);con.execute("set statement_timeout='10s'")
    return con

def seed(con):
    a,t,d,s,m=[str(uuid4()) for _ in range(5)];line='+12125550101';phone='+1'+str(int(uuid4())%10000000000).zfill(10)
    con.execute('insert into icash_accounts(id) values(%s)',[a]);con.execute('insert into icash_screening_jobs(id,account_id) values(%s,%s)',[s,a])
    con.execute('insert into icash_deal_files(id,account_id,screening_id) values(%s,%s,%s)',[d,a,s])
    con.execute('insert into icash_text_threads(id,account_id,deal_id,sender,recipient) values(%s,%s,%s,%s,%s)',[t,a,d,line,phone])
    con.execute('insert into icash_sms_routes(sender,recipient,account_id) values(%s,%s,%s)',[line,phone,a])
    con.execute("insert into icash_text_messages(id,account_id,thread_id,direction,state,body) values(%s,%s,%s,'outgoing','ready','Fixture unanswered follow-up')",[m,a,t])
    con.execute("insert into icash_seller_gaps(account_id,thread_id,outgoing_id,reason,stage) values(%s,%s,%s,'no_response','draft')",[a,t,m])
    con.execute("insert into icash_operation_spend values(%s,%s,'reserved',null,500,null)",['text:'+m,a])
    return a,t,m

def insert_notice(con, a,t):
    return str(con.execute("insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id) values(%s,%s,'incoming','received',%s,%s) returning id",[a,t,NOTICE,str(uuid4())]).fetchone()[0])

def waiting(con,name):
    for _ in range(100):
        if con.execute("select exists(select 1 from pg_stat_activity where application_name=%s and wait_event_type='Lock')",[name]).fetchone()[0]: return
        time.sleep(.02)
    raise AssertionError('Expected actual lock wait: '+name)

def main():
 with database() as dsn, connection(dsn,'notice-control') as control, connection(dsn,'notice-writer') as writer, connection(dsn,'notice-claimer') as claimant, ThreadPoolExecutor(max_workers=1) as pool:
    print(control.execute('select version()').fetchone()[0])
    # Notice first: the shared budget boundary serializes final admission after
    # immutable incoming evidence. A guessed pre-read cannot authorize a send.
    a,t,m=seed(control);writer.execute('begin');notice=insert_notice(writer,a,t)
    pending=pool.submit(lambda:claimant.execute('select icash_claim_operation(%s)',['text:'+m]).fetchone()[0])
    waiting(control,'notice-claimer');writer.execute('commit');assert pending.result(timeout=10) is False
    assert control.execute('select state,reserved_micros,actual_micros from icash_operation_spend where operation_key=%s',['text:'+m]).fetchone()==('reserved',500,None)
    assert control.execute('select body from icash_text_messages where id=%s',[notice]).fetchone()[0]==NOTICE
    assert control.execute('select count(*) from icash_text_ai_jobs where message_id=%s',[notice]).fetchone()[0]==0
    # Claim first: a later carrier receipt does not rewind an existing admission,
    # fabricate zero cost, erase it, or permit the claim to execute twice.
    a,t,m=seed(control);claimant.execute('begin');assert claimant.execute('select icash_claim_operation(%s)',['text:'+m]).fetchone()[0] is True
    pending=pool.submit(lambda:insert_notice(writer,a,t));waiting(control,'notice-writer');claimant.execute('commit');notice=pending.result(timeout=10)
    assert control.execute('select state,reserved_micros,actual_micros from icash_operation_spend where operation_key=%s',['text:'+m]).fetchone()==('dispatched',500,None)
    assert control.execute('select icash_claim_operation(%s)',['text:'+m]).fetchone()[0] is False
    assert control.execute('select count(*) from fixture_claims where operation_key=%s',['text:'+m]).fetchone()[0]==1
    assert control.execute('select count(*) from icash_text_suppressions').fetchone()[0]==0
    for role in ['anon','authenticated']:
        assert control.execute("select has_function_privilege(%s,'icash_text_automatic_notice_hold(uuid,uuid)','execute')",[role]).fetchone()[0] is False
    print('PASS native carrier notice races: notice-first denies, claim-first preserves one-use unknown spend, no global suppression, source retention and private ACLs.')

if __name__=='__main__': main()
