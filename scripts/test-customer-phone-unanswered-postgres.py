"""Fixed disposable localhost PostgreSQL only; no providers or customer calls."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
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
    return "'"+json.dumps(value).replace("'", "''")+"'::jsonb"

def uid(n):
    return f"00000000-0000-4000-8000-{n:012d}"

assert sql("select current_database();") == "icash_reliability"
sql("drop schema public cascade;create schema public;")
sql((ROOT / "tests/fixtures/customer-phone-unanswered-foundation.sql").read_text())
base = (ROOT / "supabase/migrations/20261008173746_customer_phone_recordings.sql").read_text()
sql(base[base.index("create or replace function public.icash_settle_customer_phone_call"):base.rindex("commit;")])
pricing = (ROOT / "config/two-times-usage-pricing.sql").read_text()
tag = "$usage_settle_customer_phone_call$"
sql(pricing[pricing.index("do "+tag):pricing.index("end "+tag+";")+len("end "+tag+";")])
sql((ROOT / "config/customer-phone-unanswered-settlement.sql").read_text())
sql(f"insert into icash_operation_rates values('{uid(2)}','customer_phone_call','customer-phone-recorded-2x-v1:fixture','{{\"twilio\":100000,\"other\":33000,\"vercel\":2000}}');")

def seed(n):
    now = datetime.now(timezone.utc)
    created = (now-timedelta(seconds=120)).isoformat()
    ca, ac, sender, callback = "CA"+"a"*32, "AC"+"b"*32, "+12025550101", "client:icash_"+"c"*64
    proof = dict(policy="twilio-unanswered-connectivity-v1", accountSid=ac, fromPhone=sender, toPhone=callback, direction="outbound-api", duration="0", price=None, priceUnit="USD", childrenComplete=True, childrenCount=0, recordingsComplete=True, recordingsCount=0, childInventoryHash="a"*64, recordingInventoryHash="b"*64, createdAt=created, endedAt=(now-timedelta(seconds=60)).isoformat(), observedAt=now.isoformat())
    parent = dict(sid=ca, status="no-answer", currency="USD", costMicros=0, receiptHash="c"*64, kind="verified_unanswered_browser_parent", costEvidence=proof)
    child = dict(currency="USD", costMicros=0, kind="verified_empty_child_list_after_parent_end", receiptHash="a"*64)
    audio = dict(status="absent", currency="USD", costMicros=0, callSid=ca, providerAccountSid=ac, policy="customer-phone-recorded-v1", receiptHash="d"*64)
    call, operation = uid(n), "customer-phone:"+uid(n)
    sql(f"insert into icash_customer_phone_calls(id,account_id,operation_key,rate_id,created_at,connection_type,ended_at,parent_sid,provider_account_sid,business_phone,callback_phone,parent_receipt,child_receipt,recording_required,recording_state,recording_receipt) values('{call}','{uid(1)}','{operation}','{uid(2)}','{created}','browser',now(),'{ca}','{ac}','{sender}','{callback}',{lit(parent)},{lit(child)},true,'absent',{lit(audio)});insert into icash_operation_spend values('{operation}','{uid(1)}','dispatched',100,2);")
    return call, operation

call, operation = seed(10)
with ThreadPoolExecutor(max_workers=12) as pool:
    results = list(pool.map(lambda _: sql(f"select icash_settle_customer_phone_call('{call}');"), range(24)))
assert set(results) == {"t"}
assert sql(f"select count(*) from settlements where operation='{operation}';") == "1"
assert sql(f"select charge=1 and components->'twilio'->>'amountMicros'='0' and components->'vercel'->>'amountMicros'='2000' from settlements where operation='{operation}';") == "t"

# The provider proof was saved, but a late child connection wins the shared
# budget lock before settlement. The final current-row guard must keep money held.
call, operation = seed(20)
blocker = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
try:
    blocker.stdin.write(f"begin;set local statement_timeout='8s';select id from icash_operating_budget where id=1 for update;update icash_customer_phone_calls set connected_at=now(),child_sid='CA{'d'*32}' where id='{call}';select 'child_locked';\n")
    blocker.stdin.flush()
    while blocker.stdout.readline().strip() != "child_locked":
        if blocker.poll() is not None:
            raise AssertionError(blocker.stderr.read())
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(sql, f"select icash_settle_customer_phone_call('{call}');")
        waiting = False
        for _ in range(80):
            waiting = sql(f"select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%icash_settle_customer_phone_call%{call}%');") == "t"
            if waiting:
                break
            time.sleep(0.025)
        assert waiting, "Settlement never reached the locked boundary"
        blocker.stdin.write("commit;\n\\q\n")
        blocker.stdin.flush()
        blocker.wait(timeout=5)
        assert future.result() == "f"
    assert sql(f"select count(*) from settlements where operation='{operation}';") == "0"
    assert sql(f"select state from icash_operation_spend where operation_key='{operation}';") == "dispatched"
finally:
    if blocker.poll() is None:
        blocker.kill()
        blocker.wait(timeout=5)
print("PASS native unanswered browser billing: 24 competing reconciliations settle once with original allocations; a concurrent late child wins and retains the financial hold. No provider calls.")
