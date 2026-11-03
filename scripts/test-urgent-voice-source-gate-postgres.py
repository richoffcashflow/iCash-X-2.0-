"""Current voice issuer under native races in disposable localhost DB; no providers."""
from concurrent.futures import ThreadPoolExecutor
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from threading import Barrier
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location('voice_fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
base = module_from_spec(SPEC)
SPEC.loader.exec_module(base)
sql = base.sql
ISSUE = "set role service_role;set application_name='urgent-voice-contender';select coalesce(icash_issue_ready_voice_ticket()::text,'null');"


def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'


def setup():
    assert sql('select current_database();') == 'icash_reliability'
    sql('drop schema if exists icash_recording_private cascade;drop schema public cascade;create schema public;')
    fixture = (ROOT/'tests/fixtures/urgent-voice-source-gate-setup.sql').read_text()
    for role in ('anon', 'authenticated', 'service_role'):
        fixture = fixture.replace(f'create role {role};', f"do $$begin if not exists(select 1 from pg_roles where rolname='{role}') then create role {role};end if;end$$;")
    sql(fixture)
    sql('alter role service_role bypassrls;')
    sql((ROOT/'tests/fixtures/urgent-voice-issuer-before.sql').read_text())
    assert sql("select md5(pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure));") == '5d1f4bb69ab6e0e49eb49b3cc9fdce54'
    sql((ROOT/'config/urgent-voice-source-gate.sql').read_text())
    sql('grant usage on schema public,icash_recording_private to service_role;grant select,insert,update,delete on all tables in schema public to service_role;'
        'grant usage,select,update on all sequences in schema public to service_role;'
        'revoke all on all functions in schema public,icash_recording_private from public,anon,authenticated;'
        'grant execute on all functions in schema public,icash_recording_private to service_role;')
    for n in (1, 2):
        sql(f"insert into icash_accounts(id) values('{uid(n)}');insert into icash_wallets(account_id) values('{uid(n)}');insert into icash_voice_configs(account_id) values('{uid(n)}');")


def seed(n, source='request', account=1, age=100):
    job, target, screening = uid(n), uid(n+100000), uid(n+200000)
    sql(f"""insert into icash_contact_permissions(id,account_id,screening_id,contact_key,timezone,permission_until)
      values('{target}','{uid(account)}','{screening}','{target}','open',now()+interval '1 hour');
      insert into icash_voice_jobs(id,account_id,permission_id,due_at) values('{job}','{uid(account)}','{target}',now()-interval '{age} seconds');""")
    field = {'request':'sms_source_message_id','callback':'callback_id','cancellation':'cancellation_notice_id'}.get(source)
    if field:
        sql(f"update icash_voice_jobs set {field}='{uid(n+300000)}' where id='{job}';")
    if source == 'callback':
        sql(f"""insert into icash_live_callbacks select '{uid(n+300000)}',account_id,'{screening}','{uid(n+400000)}','pending_dispatch_review',due_at from icash_voice_jobs where id='{job}';
          insert into icash_live_conversations select '{uid(n+400000)}',account_id,'{screening}','{target}','seller','complete',jsonb_build_object('human',true,'callbackDueAt',due_at),now()-interval '10 minutes' from icash_voice_jobs where id='{job}';""")
    return job


def backlog():
    sql(f"""insert into icash_contact_permissions(id,account_id,screening_id,contact_key,timezone,permission_until)
      select md5('p'||n)::uuid,'{uid(1)}',md5('s'||n)::uuid,n::text,'closed',now()+interval '1 hour' from generate_series(1,1000)n;
      insert into icash_voice_jobs(id,account_id,permission_id,due_at) select md5('j'||n)::uuid,'{uid(1)}',md5('p'||n)::uuid,now()-interval '1 hour' from generate_series(1,1000)n;
      analyze icash_voice_jobs;analyze icash_contact_permissions;""")


def contenders(statement=ISSUE):
    barrier = Barrier(24)
    def issue(_):
        barrier.wait(timeout=10)
        return json.loads(sql(statement))
    with ThreadPoolExecutor(max_workers=24) as pool:
        return list(pool.map(issue, range(24)))


def reset_interval():
    sql("update icash_voice_scheduler set last_dispatch_at=now()-interval '2 seconds';")


def selected():
    result = json.loads(sql(ISSUE))
    return sql(f"select voice_job_id from icash_automation_tickets where token='{result['token']}';") if result else None


def money():
    return sql("select jsonb_build_object('wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),'spend',(select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s));")


def run():
    setup()
    backlog()
    issuer = sql("select pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure);")
    start = issuer.index(' select candidate.* into j')
    end = issuer.index(' limit 1;')+len(' limit 1;')
    urgent = issuer[start:end].replace('into j ', '').replace('for update of v skip locked ', '').replace('capacity_snapshot', "'{}'::jsonb").rstrip(';')
    sql('alter sequence fixture_window_checks restart with 1;')
    read = "set role service_role;select count(*) from ("+urgent+") urgent;"
    assert contenders(read) == [0]*24
    assert sql('select is_called from fixture_window_checks;') == 'f', '24 readers must not check ordinary-job contact windows in the urgent lane'
    saved_money = money()
    for n, source in enumerate(('request', 'callback', 'cancellation'), 5000):
        job = seed(n, source, account=2)
        reset_interval()
        results = contenders()
        assert sum(bool(r) for r in results) == 1, results
        assert sql(f"select count(*) from icash_automation_tickets where voice_job_id='{job}';") == '1'
        assert sql(f"select state from icash_voice_jobs where id='{job}';") == 'issued'
        assert money() == saved_money
    assert sql('select count(*) from icash_automation_tickets;') == '3'

    # Due priority and SKIP LOCKED stay exact; locked urgent work is revisited.
    setup()
    first = seed(7000, 'request', account=1, age=400)
    second = seed(7001, 'cancellation', account=2, age=200)
    holder = subprocess.Popen(base.CMD, env=base.ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    holder.stdin.write(f"begin;select id from icash_voice_jobs where id='{first}' for update;select 'urgent_locked';\n")
    holder.stdin.flush()
    base.wait_for_marker(holder, 'urgent_locked')
    try:
        assert selected() == second
        holder.stdin.write('commit;\n\\q\n');holder.stdin.flush();holder.wait(timeout=5)
        assert holder.returncode == 0, holder.stderr.read()
        reset_interval()
        assert selected() == first
    finally:
        if holder.poll() is None:
            holder.kill();holder.wait(timeout=5)

    setup()
    old = seed(8000, 'ordinary', account=1, age=700)
    overdue = seed(8001, 'ordinary', account=2, age=10)
    sql(f"insert into icash_automation_tickets(account_id,kind,created_at) values('{uid(1)}','voice_dispatch',now()-interval '5 minutes');")
    assert selected() == overdue
    reset_interval()
    assert selected() == old

    for mutation in ("update icash_accounts set bot_paused=true;", "update icash_wallets set reserved_cents=balance_cents;", "update icash_contact_permissions set permission_until=now()-interval '1 second';"):
        setup()
        seed(9000)
        sql(mutation)
        saved_money = money()
        assert contenders() == [None]*24
        assert sql('select count(*) from icash_automation_tickets;') == '0'
        assert money() == saved_money
    print('PASS native current voice issuer: 24 readers skip1000 ordinary jobs in urgent lane; 24 competing issuers create one ticket for each urgent source; SKIP LOCKED/revisit, due priority and ordinary fairness remain; Pause/reservations/expired source block issue and money stays unchanged. Synthetic predicate boundaries, no providers.')


if __name__ == '__main__':
    run()
