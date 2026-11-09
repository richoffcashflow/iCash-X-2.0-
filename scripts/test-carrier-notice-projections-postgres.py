"""Disposable native PostgreSQL response-cache races; no production/provider URL.
Requires psycopg3 and initdb/postgres on PATH or ICASH_TEST_PG_BIN_DIR. The
installed official binaries are reused; this script never installs software.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import psycopg

ROOT=Path(__file__).resolve().parents[1]
DSN=None
ACCOUNT='00000000-0000-4000-8000-000000000001'
OTHER='00000000-0000-4000-8000-000000000002'
PROPERTY='00000000-0000-4000-8000-000000000010'
DEAL='00000000-0000-4000-8000-000000000110'
THREAD='00000000-0000-4000-8000-000000000210'
NOTICE='Free Msg: Receiver 12025550123 unable to receive message - Message Blocking is active'
MIGRATION=(ROOT/'config/carrier-text-notice-projections.sql').read_text()


def connect():
    conn=psycopg.connect(DSN,autocommit=True)
    conn.execute("set statement_timeout='8s';set timezone='UTC'")
    return conn


@contextmanager
def native_database():
    global DSN
    bindir=os.environ.get('ICASH_TEST_PG_BIN_DIR')
    initdb=str(Path(bindir)/'initdb') if bindir else shutil.which('initdb')
    postgres=str(Path(bindir)/'postgres') if bindir else shutil.which('postgres')
    if not initdb or not postgres:
        raise RuntimeError('Native PostgreSQL required; a skipped test is not race proof')
    with tempfile.TemporaryDirectory(prefix='icash-carrier-native-') as temp:
        env={**os.environ,'LC_ALL':'C'}
        if bindir:env['LD_LIBRARY_PATH']=str(Path(bindir).parent/'lib')
        subprocess.run([initdb,'-D',temp+'/data','-U','postgres','-A','trust','--no-locale','--encoding=UTF8'],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        DSN=f'host=127.0.0.1 port={port} dbname=postgres user=postgres connect_timeout=2'
        with open(temp+'/server.log','w+') as log:
            server=subprocess.Popen([postgres,'-D',temp+'/data','-h','127.0.0.1','-p',str(port),'-k',''],env=env,stdout=log,stderr=log)
            try:
                for _ in range(100):
                    try:
                        with connect() as c:print(c.execute('select version()').fetchone()[0])
                        break
                    except psycopg.OperationalError:
                        if server.poll() is not None:
                            log.seek(0);raise RuntimeError(log.read())
                        time.sleep(.05)
                else:raise RuntimeError('Native database startup timeout')
                yield
            finally:
                server.terminate()
                try:server.wait(timeout=10)
                except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)


def scalar(c,sql,args=None):return c.execute(sql,args).fetchone()[0]


def setup():
    with connect() as c:
        c.execute('drop schema public cascade;create schema public;')
        schema=(ROOT/'tests/fixtures/carrier-notice-projection-schema.sql').read_text()
        # Roles persist between isolated scenarios; schemas/data do not.
        schema=schema.replace('create role anon;create role authenticated;create role service_role bypassrls;', '')
        c.execute(schema)
        for path in ['tests/fixtures/seller-reply-workspace-before.sql','config/seller-reply-visibility.sql','tests/fixtures/carrier-notice-projections-before.sql']:
            c.execute((ROOT/path).read_text())
        foundation=(ROOT/'config/carrier-text-notice-classification.sql').read_text()
        c.execute(foundation[foundation.index('create function public.icash_is_carrier_text_notice'):foundation.index('create view public.icash_response_text_attention')])
        c.execute("insert into icash_screening_jobs(id,account_id,state,result) values(%s,%s,'complete','{\"property\":{\"propertyId\":\"prop_fixture\",\"address\":\"100 Fixture Street\"}}')",(PROPERTY,ACCOUNT))
        c.execute('insert into icash_deal_files(id,account_id,screening_id) values(%s,%s,%s)',(DEAL,ACCOUNT,PROPERTY))
        c.execute("insert into icash_text_threads(id,account_id,deal_id,party) values(%s,%s,%s,'seller')",(THREAD,ACCOUNT,DEAL))
        c.execute("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id) values('00000000-0000-4000-8000-000000000310',%s,%s,'incoming','received',%s,'fixture')",(ACCOUNT,THREAD,NOTICE))
        c.execute('insert into icash_opportunity_outcomes(screening_id,account_id,responded,response_at) values(%s,%s,true,now())',(PROPERTY,ACCOUNT))
        c.execute("insert into icash_opportunity_refreshes values(%s,now()-interval '1 hour'),(%s,now())",(ACCOUNT,OTHER))
        c.execute('insert into icash_workspace_revisions values(%s,9,now())',(ACCOUNT,))


def insert_human(c):
    c.execute("insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at,updated_at) values('00000000-0000-4000-8000-000000000999',%s,%s,'incoming','received','Yes, please call tomorrow','fixture',now(),now())",(ACCOUNT,THREAD))


def cache(c):return c.execute('select responded,response_at,provider_cost_micros,interested,opted_out from icash_opportunity_outcomes where screening_id=%s',(PROPERTY,)).fetchone()


def scenario_newer_refresh_wins():
    setup()
    with connect() as writer,connect() as migration:
        writer.execute('begin')
        insert_human(writer)
        writer.execute('select icash_refresh_opportunity_outcomes(%s)',(ACCOUNT,))
        saved=cache(writer)
        cursor=scalar(writer,'select refreshed_at from icash_opportunity_refreshes where account_id=%s',(ACCOUNT,))
        try:
            migration.execute(MIGRATION)
            raise AssertionError('Migration must abort while a refresh owns the account lock')
        except psycopg.Error as exc:
            assert 'Carrier response refresh is busy' in str(exc),str(exc)
            migration.execute('rollback')
        writer.execute('commit')
        assert cache(migration)==saved and saved[0] is True
        assert scalar(migration,'select refreshed_at from icash_opportunity_refreshes where account_id=%s',(ACCOUNT,))==cursor
        assert scalar(migration,'select revision from icash_workspace_revisions where account_id=%s',(ACCOUNT,))==9
    print('PASS: overlapping refresh causes atomic migration rollback, preserving newer human response, refresh cursor and revision')


def scenario_human_commits_during_repair():
    setup()
    split=MIGRATION.index('with responses as (')
    with connect() as migration,connect() as arrival,connect() as refresh:
        migration.execute(MIGRATION[:split])
        insert_human(arrival)
        before=cache(refresh)
        refresh.execute('select icash_refresh_opportunity_outcomes(%s)',(ACCOUNT,))
        assert cache(refresh)==before,'Refresh must not replace migration-owned cache'
        migration.execute(MIGRATION[split:])
        assert cache(arrival)[0] is True
        assert scalar(arrival,"select refreshed_at='-infinity'::timestamptz from icash_opportunity_refreshes where account_id=%s",(ACCOUNT,))
        assert not scalar(arrival,"select refreshed_at='-infinity'::timestamptz from icash_opportunity_refreshes where account_id=%s",(OTHER,))
    print('PASS: human commits while migration owns refresh lock; repair preserves it and invalidates only the affected account')


def scenario_insert_after_source_snapshot():
    setup()
    # Test-only trigger barrier: freeze the repair after its source snapshot but
    # before its derived-row write. This does not change application SQL.
    with connect() as gate,connect() as monitor:
        monitor.execute("create function test_pause_outcome() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(987654321);return new;end$$;create trigger test_pause before update on icash_opportunity_outcomes for each row execute function test_pause_outcome()")
        gate.execute('begin');gate.execute('select pg_advisory_xact_lock(987654321)')
        def run():
            with connect() as migration:migration.execute(MIGRATION)
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(run)
            for _ in range(100):
                blocked=scalar(monitor,"select exists(select 1 from pg_locks where locktype='advisory' and objid=987654321 and not granted)")
                if blocked:break
                time.sleep(.03)
            else:raise AssertionError('Repair did not reach the controlled write barrier')
            insert_human(monitor)
            gate.execute('commit');future.result(timeout=10)
        # The cache follows its statement snapshot, but the live response
        # projection immediately includes the late human before another refresh.
        assert cache(monitor)[0] is False
        counts=scalar(monitor,'select icash_workspace_response_counts(%s)',(ACCOUNT,))
        assert counts['responded']==1
        replies=monitor.execute('select * from icash_workspace_seller_texts(%s,null)',(ACCOUNT,)).fetchall()
        assert len(replies)==1 and str(replies[0][2]).endswith('999')
        assert scalar(monitor,"select refreshed_at='-infinity'::timestamptz from icash_opportunity_refreshes where account_id=%s",(ACCOUNT,))
        monitor.execute('select icash_refresh_opportunity_outcomes(%s)',(ACCOUNT,))
        assert cache(monitor)[0] is True
        assert scalar(monitor,'select count(*) from icash_text_messages')==2
    print('PASS: insert after source snapshot remains immediately visible; invalidated cursor restores cache on next refresh, with both raw messages retained')


def scenario_history_view_privileges():
    setup()
    with connect() as c:
        c.execute((ROOT/'tests/fixtures/carrier-notice-history-schema.sql').read_text())
        c.execute((ROOT/'tests/fixtures/carrier-notice-history-before.sql').read_text())
        foundation=(ROOT/'config/carrier-text-notice-classification.sql').read_text()
        c.execute(foundation[foundation.index('create view public.icash_response_text_attention'):foundation.index('create view public.icash_response_seller_gaps')])
        c.execute((ROOT/'config/carrier-text-notice-history.sql').read_text())
        c.execute('grant usage on schema public to anon,authenticated,service_role')
        for view in ['icash_response_sms_route_reviews','icash_response_handoffs']:
            assert scalar(c,"select 'security_invoker=true'=any(reloptions) from pg_class where oid=%s::regclass",(view,))
            for role in ['anon','authenticated']:
                c.execute('set role '+role)
                try:
                    c.execute('select * from '+view)
                    raise AssertionError('Public role gained source-view access')
                except psycopg.errors.InsufficientPrivilege:
                    pass
                finally:
                    c.execute('reset role')
            c.execute('set role service_role')
            assert c.execute('select * from '+view).fetchall()==[]
            c.execute('reset role')
    print('PASS: new history views enforce actual native anon/authenticated rejection and service-only invoker access')


with native_database():
    with connect() as c:c.execute('create role anon;create role authenticated;create role service_role bypassrls;')
    scenario_newer_refresh_wins()
    scenario_human_commits_during_repair()
    scenario_insert_after_source_snapshot()
    scenario_history_view_privileges()
