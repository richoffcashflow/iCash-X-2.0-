"""Disposable localhost PostgreSQL only. Never invokes an external provider."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]

def sql(query):
    r = subprocess.run(CMD, input="set statement_timeout='8s';\n"+query, env=ENV, text=True, capture_output=True, timeout=15)
    if r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()

def lit(value):
    return "'"+str(value).replace("'", "''")+"'"

assert sql("select current_database();") == "icash_reliability"
sql("drop schema if exists icash_recording_private cascade;drop schema if exists icash_private cascade;drop schema public cascade;create schema public;")
sql((ROOT / "tests/fixtures/voice-predial-foundation.sql").read_text())
sql((ROOT / "tests/fixtures/voice-predial-settle-baseline.sql").read_text())
sql((ROOT / "tests/fixtures/voice-predial-create-baseline.sql").read_text())
sql((ROOT / "config/voice-predial-abort.sql").read_text())
sql((ROOT / "tests/fixtures/recording-admission-abort-before.sql").read_text())
sql("begin;"+(ROOT / "config/recording-admission-abort.sql").read_text()+"commit;")

def seed(n):
    return json.loads(sql(f"select fixture_predial_seed({n});"))

def finish(f):
    args = [f["account"], f["job"], f["ticket"], f["token"], f["dispatchedAt"], "recording_admission_held", "recording_admission_rejected_v1"]
    return "select icash_finish_voice_predial_abort("+",".join(lit(v) for v in args)+");"

def create(f):
    pricing = dict(version="required-audio-30d-speech-v1", retentionDays=30, recordingMicrosPerMinute=2500, storageMicrosPerMinuteMonth=500, recordingAllowanceMicros=31000, speechGatherMicros=20000, estimate=True)
    context = dict(fromPhone="+12025550101", branchId="agtbrch_fixture", versionId="agtvrsn_fixture", maxTotalSeconds=600)
    args = [lit(f["account"]), lit(f["operation"]), lit("AC"+"a"*32), "null", lit("b"*64), lit("c"*64), lit("fixture-disclosure"), lit(json.dumps(pricing)), lit(json.dumps(context))]
    return "select icash_create_direct_recorded_call("+",".join(args)+") is null;"

f = seed(1)
with ThreadPoolExecutor(max_workers=12) as pool:
    results = list(pool.map(lambda _: sql(finish(f)), range(24)))
assert set(results) == {"t"}
assert sql("select count(*) from fixture_credit_finishes;") == "1"
assert sql(f"select state='settled' and actual_micros=0 and charged_cents=0 from icash_operation_spend where operation_key={lit(f['operation'])};") == "t"
assert sql(create(f)) == "t", "The real create RPC cannot admit after abort"

def boundary_race(f, locked_query, waiting_query, expected):
    blocker = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write("begin;set local statement_timeout='8s';select id from icash_operating_budget where id=1 for update;"+locked_query+"select 'proof_locked';\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != "proof_locked":
            if blocker.poll() is not None:
                raise AssertionError(blocker.stderr.read())
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, waiting_query)
            waiting = False
            for _ in range(80):
                waiting = sql(f"select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%{f['job']}%');") == "t"
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, "Concurrent action never reached the shared budget boundary"
            blocker.stdin.write("commit;\n\\q\n")
            blocker.stdin.flush()
            blocker.wait(timeout=5)
            assert future.result() == expected
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.wait(timeout=5)

f = seed(2)
boundary_race(f, create(f), finish(f), "f")
assert sql(f"select state from icash_operation_spend where operation_key={lit(f['operation'])};") == "dispatched"
f = seed(3)
boundary_race(f, finish(f), create(f), "t")
for n, change in enumerate([
    "insert into icash_cost_observations(source_ref) values({operation}||':late-provider');",
    "insert into icash_cost_manifests values({operation});",
    "insert into icash_private.provider_costs values({operation});",
    "update icash_voice_jobs set provider_call_sid='CA'||repeat('d',32) where id={job};",
    "update icash_automation_tickets set state='held',completed_at=now() where id={ticket};",
], start=4):
    f = seed(n)
    boundary_race(f, change.format(**{k:lit(v) for k,v in f.items()}), finish(f), "f")
    assert sql(f"select count(*) from fixture_credit_finishes where operation_key={lit(f['operation'])};") == "0"
f = seed(20)
sql(f"update icash_accounts set bot_paused=true where id={lit(f['account'])};")
assert sql(finish(f)) == "t"
assert sql(f"select bot_paused from icash_accounts where id={lit(f['account'])};") == "t"
print("PASS native synchronous recording admission rejection:24 competing handlers settle once; actual create/abort race both orders, reread of committed late evidence, completed handler and customer Pause preserve correct authority. No provider calls.")
