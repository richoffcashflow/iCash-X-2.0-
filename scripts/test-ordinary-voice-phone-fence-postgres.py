"""Actual ordinary issuer under native races; synthetic boundaries, no providers."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location('urgent_voice_fixture', ROOT/'scripts/test-urgent-voice-source-gate-postgres.py')
voice = module_from_spec(SPEC)
SPEC.loader.exec_module(voice)
sql, uid = voice.sql, voice.uid
PATCH = (ROOT/'config/ordinary-voice-phone-fence.sql').read_text()
LANE = "set role service_role;set application_name='ordinary-voice-lane-contender';select coalesce(icash_next_automation_lane('voice')::text,'null');"


def setup():
    voice.setup()
    assert sql("select md5(pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure));") == 'c74e1cd9d71c715923d185189e26b4c2'
    sql((ROOT/'tests/fixtures/ordinary-voice-phone-instrumentation.sql').read_text())
    sql('grant usage,select,update on sequence fixture_slot_checks to service_role;')
    sql(PATCH)
    # Capture the actual worker entry, including its existing nonblocking
    # admission. Concurrent workers do not call the inner issuer directly.
    sql('drop schema if exists icash_work_private cascade;create schema icash_work_private;'
        'create table icash_work_private.dispatch_policy(id integer primary key,enabled boolean);'
        'insert into icash_work_private.dispatch_policy values(1,true);')
    sql((ROOT/'tests/fixtures/automation-lane-current.sql').read_text())
    assert sql("select md5(pg_get_functiondef('icash_next_automation_lane(text)'::regprocedure));") == '3463e54ab56e8a7732a3af2febf9dc88'
    sql('revoke all on function icash_next_automation_lane(text) from public,anon,authenticated;'
        'grant execute on function icash_next_automation_lane(text) to service_role;')


setup()
sql(f"""insert into icash_contact_permissions(id,account_id,screening_id,contact_key,timezone,permission_until)
 select md5('ordinary-p'||n)::uuid,'{uid(1)}',md5('ordinary-s'||n)::uuid,n::text,'open',now()+interval '1 hour' from generate_series(1,1000)n;
 insert into icash_voice_jobs(id,account_id,permission_id,due_at) select md5('ordinary-j'||n)::uuid,'{uid(1)}',md5('ordinary-p'||n)::uuid,now()-interval '1 hour' from generate_series(1,1000)n;
 insert into fixture_guards select id,'phone' from icash_voice_jobs;
 insert into fixture_guards select id,'explode_slot' from icash_voice_jobs;
 analyze icash_voice_jobs;analyze icash_contact_permissions;analyze fixture_guards;""")
money = voice.money()
# Keep the synthetic guard boundary cheap at the original 1,000-job scale.
# This plan assertion uses its exact lookup predicate and does not change the
# production issuer, predicate implementation or original contender timeouts.
lookup = json.loads(sql("explain(analyze,format json) select not exists(select 1 from public.fixture_guards where job_id=md5('ordinary-j1')::uuid and kind='phone');"))[0]['Plan']
def nodes(plan):
    yield plan
    for child in plan.get('Plans', []):
        yield from nodes(child)
assert any(node.get('Index Name') == 'fixture_guards_job_kind' and node.get('Actual Loops', 0) > 0 for node in nodes(lookup)), 'Synthetic phone boundary uses its exact job/kind index'
issuer = sql("select pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure);")
start = issuer.index(' select permitted.* into j')
end = issuer.index(' limit 1;', start)+len(' limit 1;')
ordinary = issuer[start:end].replace('into j ', '').replace('for update of v skip locked ', '').replace('capacity_snapshot', '$1').rstrip(';')
for mode in ('force_custom_plan', 'force_generic_plan'):
    assert sql('set role service_role;set plan_cache_mode='+mode+';prepare ordinary_phone_plan(jsonb) as select count(*) from ('+ordinary+") permitted;execute ordinary_phone_plan('{}'::jsonb);") == '0'
    assert sql('select is_called from fixture_slot_checks;') == 'f', 'Prepared plans retain the phone fence'
# Independently bound one full inner scan by the original helper's 8-second
# deadline. The 24-worker race then follows the real nonblocking lane entry.
assert json.loads(sql(voice.ISSUE)) is None
assert voice.contenders(LANE) == [None]*24
assert sql('select is_called from fixture_slot_checks;') == 'f', 'Phone-blocked jobs cannot reach expensive capacity'
late = voice.seed(5000, 'ordinary', account=2, age=1)
# Admission already held by another worker must return promptly even with
# eligible work. This is the production function, not a test-only try-lock shim.
admission = subprocess.Popen(voice.base.CMD, env=voice.base.ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
try:
    admission.stdin.write("begin;select pg_advisory_xact_lock(726341927);select 'voice_lane_locked';\n")
    admission.stdin.flush()
    voice.base.wait_for_marker(admission, 'voice_lane_locked')
    assert voice.contenders(LANE) == [None]*24
    assert sql('select count(*) from icash_automation_tickets;') == '0'
    admission.stdin.write('rollback;\n\\q\n');admission.stdin.flush();admission.wait(timeout=5)
    assert admission.returncode == 0, admission.stderr.read()
finally:
    if admission.poll() is None:
        admission.kill();admission.wait(timeout=5)
results = voice.contenders(LANE)
assert sum(bool(r) for r in results) == 1
assert sql(f"select count(*) from icash_automation_tickets where voice_job_id='{late}';") == '1'
assert sql('select last_value from fixture_slot_checks;') == '1'
assert voice.money() == money

# A newly committed hold while the issuer waits on its original scheduler lock
# must be observed by the unchanged final slot guard.
setup()
held = voice.seed(6000, 'ordinary', account=1)
allowed = voice.seed(6001, 'ordinary', account=2, age=20)
holder = subprocess.Popen(voice.base.CMD, env=voice.base.ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
holder.stdin.write(f"begin;select id from icash_voice_scheduler where id=1 for update;insert into fixture_guards values('{held}','capacity');select 'capacity_locked';\n")
holder.stdin.flush()
voice.base.wait_for_marker(holder, 'capacity_locked')
contender = subprocess.Popen(voice.base.CMD, env=voice.base.ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
contender.stdin.write("set role service_role;set application_name='ordinary-phone-late-hold';select coalesce(icash_issue_ready_voice_ticket()::text,'null');\n\\q\n")
contender.stdin.flush()
try:
    for _ in range(100):
        if sql("select count(*) from pg_stat_activity where application_name='ordinary-phone-late-hold' and wait_event_type='Lock';") == '1':
            break
        time.sleep(0.02)
    else:
        raise AssertionError('Issuer did not wait on unchanged scheduler lock')
    holder.stdin.write('commit;\n\\q\n');holder.stdin.flush();holder.wait(timeout=5)
    assert holder.returncode == 0, holder.stderr.read()
    contender.wait(timeout=10)
    assert contender.returncode == 0, contender.stderr.read()
    assert sql(f"select count(*) from icash_automation_tickets where voice_job_id='{held}';") == '0'
    assert sql(f"select count(*) from icash_automation_tickets where voice_job_id='{allowed}';") == '1'
finally:
    for process in (holder, contender):
        if process.poll() is None:
            process.kill();process.wait(timeout=5)

setup()
old = voice.seed(7000, 'ordinary', account=1, age=700)
overdue = voice.seed(7001, 'ordinary', account=2, age=10)
sql(f"insert into icash_automation_tickets(account_id,kind,created_at) values('{uid(1)}','voice_dispatch',now()-interval '5 minutes');")
assert voice.selected() == overdue
voice.reset_interval()
assert voice.selected() == old

for mutation in ("update icash_accounts set bot_paused=true;", "update icash_wallets set reserved_cents=balance_cents;", "update icash_contact_permissions set permission_until=now()-interval '1 second';"):
    setup()
    voice.seed(8000, 'ordinary')
    sql(mutation)
    money = voice.money()
    assert voice.contenders(LANE) == [None]*24
    assert voice.money() == money
    assert sql('select count(*) from icash_automation_tickets;') == '0'
print('PASS native ordinary phone fence:single full inner scan within original8s deadline;24 real-lane contenders skip1000 phone-blocked capacity checks; busy production admission returns without issue; one later eligible ticket; direct-inner late capacity hold, original scheduler locks, ordinary fairness, Pause, reservations and expired-source rejection preserved. No providers.')
