"""Actual assignment claims under native PostgreSQL contention. Local CI only."""
import concurrent.futures
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "PGPASSWORD": "isolated-fixture-only", "PGCONNECT_TIMEOUT": "5"}
CMD = ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55443", "-U", "postgres", "-d", "icash_reliability"]
J = "00000000-0000-4000-8000-000000000006"
J2 = "00000000-0000-4000-8000-000000000007"

def sql(query):
    result = subprocess.run(CMD, input="set statement_timeout='8s';\n" + query, text=True, capture_output=True, env=ENV, timeout=12)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

class Session:
    def __init__(self, name):
        self.process = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=ENV)
        self.lines = queue.Queue()
        def read():
            for line in self.process.stdout:
                self.lines.put(line.rstrip())
            self.lines.put(None)
        threading.Thread(target=read, daemon=True).start()
        self.query(f"set application_name='{name}'; set statement_timeout='8s'; set deadlock_timeout='100ms';")
    def start(self, query):
        self.process.stdin.write(query + "\n\\echo fixture_done\n")
        self.process.stdin.flush()
    def finish(self):
        result = []
        while True:
            line = self.lines.get(timeout=10)
            if line == "fixture_done":
                text = "\n".join(result)
                assert "ERROR:" not in text, text
                return text
            assert line is not None, result
            if line:
                result.append(line)
    def query(self, query):
        self.start(query)
        return self.finish()
    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=3)

def function(path, name):
    text = (ROOT / path).read_text()
    start = text.index("create function public." + name + "(")
    tag = re.search(r"\bas (\$[A-Za-z_]*\$)", text[start:], re.I).group(1)
    body = text.index(tag, start)
    return text[start:text.index(tag + ";", body + len(tag)) + len(tag) + 1]

def reset():
    sql(f"delete from icash_deal_journeys where id<>'{J}'; update icash_deal_journeys set state='ready'; update icash_deal_files set terms=terms||'{{\"priceCents\":9200000,\"assignee\":\"\"}}';")

def blocked(name):
    deadline = time.monotonic() + 5
    while sql(f"select exists(select 1 from pg_stat_activity where application_name='{name}' and wait_event_type='Lock')") != "t":
        assert time.monotonic() < deadline, name + " never waited on expected lock"
        time.sleep(.03)

sql("drop schema public cascade;create schema public;drop schema if exists auth cascade;")
sql((ROOT / "tests/helpers/buyer-assignment-snapshot-fixture.sql").read_text())
sql(function("config/turnkey-deal-journey.sql", "icash_journey_allowed"))
sql((ROOT / "tests/fixtures/buyer-assignment-claim-before-snapshot.sql").read_text())
sql(function("config/closing-completion.sql", "icash_claim_journey_assignment"))
sql("revoke all on function icash_claim_journey_assignment_before_completion(uuid),icash_claim_journey_assignment(uuid) from public,anon,authenticated;grant execute on function icash_claim_journey_assignment_before_completion(uuid),icash_claim_journey_assignment(uuid) to service_role;")
assert sql("select md5(pg_get_functiondef('icash_claim_journey_assignment_before_completion(uuid)'::regprocedure))") == "4dcbb00b25643248c6cffe3648dc5e48"
sql((ROOT / "config/buyer-assignment-terms-snapshot.sql").read_text())

with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    results = list(pool.map(lambda _: sql(f"select icash_claim_journey_assignment('{J}')"), range(16)))
claims = [json.loads(value) for value in results if value]
assert len(claims) == 1
assert claims[0]["expectedTerms"]["assignee"] == "Fixture Buyer LLC"
assert claims[0]["expectedTerms"]["priceCents"] == 9200000
print("PASS 16 concurrent duplicate claims return one exact document snapshot")

reset()
sql(f"insert into icash_deal_journeys(id,account_id,deal_id,thread_id,buyer_details) select '{J2}',account_id,deal_id,thread_id,buyer_details||'{{\"legalName\":\"Second Buyer LLC\"}}' from icash_deal_journeys where id='{J}';")
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    results = list(pool.map(lambda i: sql(f"select icash_claim_journey_assignment('{J if i % 2 else J2}')"), range(16)))
assert len([value for value in results if value]) == 1
assert sql("select count(*) from icash_deal_journeys where state='sending'") == "1"
print("PASS competing buyers cannot prepare two assignments")

reset()
editor, claimant = Session("assignment_edit_first"), Session("assignment_claim_after_edit")
try:
    editor.query("begin;select id from icash_deal_files for update;")
    claimant.start(f"select icash_claim_journey_assignment('{J}');")
    blocked("assignment_claim_after_edit")
    editor.query("update icash_deal_files set terms=terms||'{\"priceCents\":9300000}';commit;")
    assert claimant.finish() == ""
    assert sql("select state from icash_deal_journeys") == "ready"
finally:
    editor.close()
    claimant.close()
print("PASS a concurrent price edit before claim invalidates the buyer's old accepted price")

reset()
claimant, editor = Session("assignment_claim_first"), Session("assignment_edit_after_claim")
try:
    claimant.query("begin;")
    snapshot = json.loads(claimant.query(f"select icash_claim_journey_assignment('{J}');"))["expectedTerms"]
    editor.start("update icash_deal_files set terms=terms||'{\"priceCents\":9300000}';")
    blocked("assignment_edit_after_claim")
    claimant.query("commit;")
    editor.finish()
    current = json.loads(sql("select terms from icash_deal_files"))
    assert snapshot["priceCents"] == 9200000 and current["priceCents"] == 9300000
    assert sql(f"select icash_claim_journey_assignment('{J}')") == ""
finally:
    claimant.close()
    editor.close()
print("PASS post-claim edits cannot rewrite the returned snapshot or reset the consumed claim")
for role in ["anon", "authenticated"]:
    assert sql(f"select has_function_privilege('{role}','icash_claim_journey_assignment_before_completion(uuid)','EXECUTE')") == "f"
print("PASS native snapshot contention and service-only ACLs; no provider calls")
