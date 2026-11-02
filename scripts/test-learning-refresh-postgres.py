"""Native lock regression on a disposable localhost PostgreSQL 17 database.

No configurable host, production credentials, provider calls or paid work.
The old function is required to reproduce the race before the fix is tested.
"""
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
COMMAND = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
           "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]


class Session:
    def __init__(self, name):
        self.process = subprocess.Popen(COMMAND, env=ENV, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        text=True, bufsize=1)
        self.lines = queue.Queue()
        self.sequence = 0
        self.pending = None
        def collect():
            for line in self.process.stdout:
                self.lines.put(line.rstrip("\n"))
            self.lines.put(None)
        threading.Thread(target=collect, daemon=True).start()
        self.query(f"set application_name='{name}'; set statement_timeout='8s'; set deadlock_timeout='100ms';")

    def start(self, sql):
        assert self.pending is None
        self.sequence += 1
        self.pending = f"fixture_done_{self.sequence}"
        self.process.stdin.write(sql + "\n\\echo " + self.pending + "\n")
        self.process.stdin.flush()

    def finish(self):
        result = []
        while True:
            line = self.lines.get(timeout=10)
            if line == self.pending:
                self.pending = None
                return "\n".join(result)
            if line is None:
                self.pending = None
                raise RuntimeError("\n".join(result))
            if line:
                result.append(line)

    def query(self, sql):
        self.start(sql)
        return self.finish()

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                self.process.wait(timeout=2)


def wait_for_lock(observer, name):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if observer.query(f"select exists(select 1 from pg_stat_activity where application_name='{name}' and wait_event_type='Lock');") == "t":
            return
        time.sleep(0.03)
    raise AssertionError("Expected concurrent refresh to reach the held outcome row")


def setup(observer, fixed):
    observer.query("drop schema public cascade; create schema public;")
    fixture = (ROOT / "tests/fixtures/learning-refresh-concurrency.sql").read_text()
    fixture = re.sub(r"create role (anon|authenticated|service_role);", "", fixture)
    observer.query(fixture)
    base = (ROOT / "config/platform-shared-learning.sql").read_text()
    for name in ["icash_learning_changed", "icash_refresh_shared_learning"]:
        definition = re.search(r"create function public\." + name + r"\([\s\S]*?end \$\$;", base).group()
        observer.query(definition)
    if fixed:
        observer.query((ROOT / "config/learning-refresh-concurrency.sql").read_text())
    observer.query("create trigger learning_change after insert or update on icash_discovery_configs for each row execute function icash_learning_changed();")
    observer.query(f"insert into icash_accounts values('{ACCOUNT}'),('{OTHER}'); insert into fixture_outcomes(account_id) values('{ACCOUNT}'),('{OTHER}'); insert into icash_discovery_configs(account_id) values('{ACCOUNT}'),('{OTHER}'); update icash_learning_queue set due_at=now()-interval '2 minutes' where account_id='{ACCOUNT}';")


observer = Session("learning_fixture_observer")
try:
    observer.query("create role anon; create role authenticated; create role service_role;")
    for fixed in [False, True]:
        setup(observer, fixed)
        scheduler, learning = Session("learning_fixture_scheduler"), Session("learning_fixture_refresh")
        try:
            scheduler.query(f"begin; select account_id from fixture_outcomes where account_id='{ACCOUNT}' for update;")
            learning.start("select icash_refresh_shared_learning(1);")
            wait_for_lock(observer, "learning_fixture_refresh")
            scheduler_error = None
            try:
                scheduler.query(f"update icash_discovery_configs set enabled=false where account_id='{ACCOUNT}'; commit;")
            except RuntimeError as error:
                scheduler_error = str(error)
            refresh = json.loads(learning.finish())
            if not fixed:
                assert scheduler_error and "deadlock detected" in scheduler_error or refresh["failed"] > 0, "The old queue-first implementation must reproduce the deadlock"
                print("Reproduced original queue/outcome lock inversion.")
            else:
                assert scheduler_error is None, scheduler_error
                assert refresh["refreshed"] == 1 and refresh["failed"] == 0, refresh
                assert observer.query(f"select generation=2 and due_at<=now() from icash_learning_queue where account_id='{ACCOUNT}';") == "t", "A concurrent wakeup must remain due after refresh completion"
                print("Fixed lock ordering: concurrent scheduling completes and its wakeup survives.")
        finally:
            scheduler.close()
            learning.close()

    # A busy account must not consume another account's bounded batch slot.
    holder, learner = Session("learning_fixture_holder"), Session("learning_fixture_second")
    try:
        holder.query(f"begin; select pg_advisory_xact_lock(hashtextextended('{ACCOUNT}',81021));")
        result = json.loads(learner.query("select icash_refresh_shared_learning(1);"))
        assert result["refreshed"] == 1 and result["failed"] == 0
        assert observer.query(f"select value from fixture_outcomes where account_id='{OTHER}';") == "1"
        assert observer.query(f"select due_at<=now() from icash_learning_queue where account_id='{ACCOUNT}';") == "t"
        holder.query("commit;")
        result = json.loads(learner.query("select icash_refresh_shared_learning(1);"))
        assert result["refreshed"] == 1 and result["failed"] == 0 and result["due"] == 0
        print("Busy-account skip, later recovery, and native concurrent generation fence passed.")
    finally:
        holder.close()
        learner.close()
finally:
    observer.close()
