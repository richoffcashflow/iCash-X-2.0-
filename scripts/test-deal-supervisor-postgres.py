"""Disposable localhost concurrency checks; no providers or production credentials."""
import concurrent.futures
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]
A, S, D, T, J = [f"00000000-0000-4000-8000-{n:012d}" for n in range(1, 6)]

def sql(query):
    r = subprocess.run(CMD, input="set statement_timeout='8s';\n" + query, text=True, capture_output=True, env=ENV, timeout=12)
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
    def start(self, query):
        self.p.stdin.write(query + "\n\\echo fixture_done\n")
        self.p.stdin.flush()
    def finish(self):
        result = []
        while True:
            line = self.lines.get(timeout=10)
            if line == "fixture_done":
                return "\n".join(result)
            assert line is not None, result
            if line:
                result.append(line)
    def query(self, query):
        self.start(query)
        return self.finish()
    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=3)

with tempfile.TemporaryDirectory(prefix="icash-supervisor-") as folder:
    fixture = Path(folder) / "setup.sql"
    subprocess.run(["node", str(ROOT / "tests/helpers/deal-supervisor-setup.mjs")], check=True, env={**os.environ, "DEAL_SUPERVISOR_FIXTURE_OUTPUT": str(fixture)})
    setup = re.sub(r"create role (anon|authenticated|service_role);", "", fixture.read_text())
sql("drop schema public cascade;create schema public;" + "".join(f"do $$begin create role {role};exception when duplicate_object then null;end$$;" for role in ["anon", "authenticated", "service_role"]) + setup)
sql(f"""
update icash_deal_supervisor_settings set enabled=true,activated_at=now(),release_sha=repeat('a',40);
update icash_seller_progress_settings set enabled=true;
insert into icash_accounts(id) values('{A}');
insert into icash_screening_jobs(id,account_id,snapshot) values('{S}','{A}','{{"propertyId":"fixture"}}');
insert into icash_deal_files(id,account_id,screening_id) values('{D}','{A}','{S}');
insert into icash_text_threads(id,account_id,deal_id,recipient) values('{T}','{A}','{D}','+15550001111');
insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id) values('{A}','{T}','incoming','received','Roof needs work','fixture-receipt');
""")
lock = Session("supervisor_lock")
try:
    lock.query("begin;select pg_advisory_xact_lock(726341972);")
    started = time.monotonic()
    assert json.loads(sql("select icash_run_deal_supervisor();"))["status"] == "busy"
    assert time.monotonic() - started < 2, "Competing runner must not wait for the lock"
    lock.query("commit;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: json.loads(sql("select icash_run_deal_supervisor();")), range(8)))
    assert sum(r["repaired"] for r in results) == 1, results
    assert sql("select count(*) from icash_text_ai_jobs;") == "1"
    assert sql("select count(*) from icash_deal_supervisor_events;") == "0"

    # Exact signed evidence permits only local preparation, with no provider.
    sql(f"""
update icash_deal_files set stage='under_contract' where id='{D}';
with e as (select gen_random_uuid() id) insert into icash_signing_envelopes(id,account_id,deal_id,kind,state,provider_id,terms_hash,recipients,provider_evidence)
 select id,'{A}','{D}','purchase','completed','fixture-provider','fixture-hash',
 '[{{"id":"s","phone":"+15550001111"}},{{"id":"c","email":"fixture@example.invalid"}}]'::jsonb,
 jsonb_build_object('id','fixture-provider','test_mode',false,'status','completed','apply_signing_order',true,'metadata',jsonb_build_object('icash_envelope',id,'terms_hash','fixture-hash'),
 'recipients','[{{"id":"s","phone":"+15550001111","status":"signed","signing_order":1}},{{"id":"c","email":"fixture@example.invalid","status":"signed","signing_order":2}}]'::jsonb) from e;
select icash_run_deal_supervisor();
update icash_fulfillment_jobs set state='complete';
insert into icash_deal_journeys(id,account_id,deal_id) values('{J}','{A}','{D}');
delete from icash_deal_supervisor_events;
""")
    # Allocate a lower event ID but leave its transaction uncommitted. A later ID
    # becomes visible first. The runner must not delete the late-committing event.
    lock.query(f"begin;update icash_deal_journeys set next_run_at=now() where id='{J}';insert into icash_deal_supervisor_events(account_id,deal_id,source) values('{A}','{D}','late_commit');")
    sql(f"insert into icash_deal_supervisor_events(account_id,deal_id,source) values('{A}','{D}','visible_first');")
    worker = Session("supervisor_worker")
    try:
        worker.start("select icash_run_deal_supervisor();")
        deadline = time.monotonic() + 0.8
        while sql("select exists(select 1 from pg_stat_activity where application_name='supervisor_worker' and wait_event_type='Lock');") != "t":
            assert time.monotonic() < deadline, "Runner did not reach locked journey"
            time.sleep(0.01)
        lock.query("commit;")
        result = json.loads(worker.finish())
        assert result["errors"] == 0, result
        assert sql("select source from icash_deal_supervisor_events;") == "late_commit", "Late lower ID must remain queued"
        sql("select icash_run_deal_supervisor();")
        assert sql("select count(*) from fixture_journey_actions;") == "1", "Existing source key must remain unique"
        assert sql("select count(*) from icash_fulfillment_jobs;") == "1"
        assert sql("select count(*) from icash_deal_supervisor_events;") == "0"
    finally:
        worker.close()
finally:
    lock.close()
print("PASS native deal supervisor: nonblocking competition, one missing-job repair, concurrent source updates, commit-order wakeup retention and unique downstream preparation.")
