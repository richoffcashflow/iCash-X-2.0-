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
sql("alter table icash_customer_phone_calls add column recipient_phone text;")
base = (ROOT / "supabase/migrations/20261008173746_customer_phone_recordings.sql").read_text()
sql(base[base.index("create or replace function public.icash_settle_customer_phone_call"):base.rindex("commit;")])
pricing = (ROOT / "config/two-times-usage-pricing.sql").read_text()
tag = "$usage_settle_customer_phone_call$"
sql(pricing[pricing.index("do "+tag):pricing.index("end "+tag+";")+len("end "+tag+";")])
sql((ROOT / "config/customer-phone-unanswered-settlement.sql").read_text())
sql((ROOT / "config/customer-phone-child-unanswered-settlement.sql").read_text())
sql(f"insert into icash_operation_rates values('{uid(2)}','customer_phone_call','customer-phone-recorded-2x-v1:fixture','{{\"twilio\":100000,\"other\":33000,\"vercel\":2000}}');")

def seed(n):
    now = datetime.now(timezone.utc)
    created = (now-timedelta(seconds=120)).isoformat()
    ca, ch, re, ac, sender, recipient = "CA"+"a"*32, "CA"+"d"*32, "RE"+"e"*32, "AC"+"b"*32, "+12025550101", "+12025550102"
    parent = dict(sid=ca, status="completed", currency="USD", costMicros=4000, receiptHash="a"*64)
    original = dict(sid=ch, status="no-answer", currency="USD", costMicros=None, receiptHash="b"*64)
    audio = dict(sid=re, status="completed", currency="USD", costMicros=3000, callSid=ca, providerAccountSid=ac, policy="customer-phone-recorded-v1", receiptHash="c"*64)
    proof = dict(policy="twilio-unanswered-child-connectivity-v1", accountSid=ac, parentSid=ca, fromPhone=sender, toPhone=recipient, direction="outbound-dial", duration="0", price=None, priceUnit="USD", parentChildrenComplete=True, parentChildrenCount=1, parentChildrenHash="d"*64, descendantsComplete=True, descendantsCount=0, descendantsHash="e"*64, recordingsComplete=True, recordingsCount=0, recordingInventoryHash="f"*64, createdAt=created, endedAt=(now-timedelta(seconds=60)).isoformat(), observedAt=now.isoformat(), originalParentReceipt=parent, originalChildReceipt=original, originalRecordingReceipt=audio)
    child = dict(sid=ch, status="no-answer", currency="USD", costMicros=0, receiptHash="a"*64, kind="verified_unanswered_browser_child", costEvidence=proof)
    call, operation = uid(n), "customer-phone:"+uid(n)
    sql(f"insert into icash_customer_phone_calls(id,account_id,operation_key,rate_id,created_at,connection_type,connected_at,ended_at,parent_sid,child_sid,provider_account_sid,business_phone,recipient_phone,callback_phone,parent_receipt,child_receipt,recording_required,recording_state,recording_sid,recording_receipt) values('{call}','{uid(1)}','{operation}','{uid(2)}','{created}','browser','{created}',now(),'{ca}','{ch}','{ac}','{sender}','{recipient}','client:fixture',{lit(parent)},{lit(child)},true,'available','{re}',{lit(audio)});insert into icash_operation_spend values('{operation}','{uid(1)}','dispatched',100,2);")
    return call, operation

call, operation = seed(10)
with ThreadPoolExecutor(max_workers=12) as pool:
    results = list(pool.map(lambda _: sql(f"select icash_settle_customer_phone_call('{call}');"), range(24)))
assert set(results) == {"t"}
assert sql(f"select count(*) from settlements where operation='{operation}';") == "1"
assert sql(f"select charge=2 and components->'twilio'->>'amountMicros'='4000' and components->'other'->>'amountMicros'='3000' and components->'vercel'->>'amountMicros'='2000' from settlements where operation='{operation}';") == "t"

# Exact current answer and receipt evidence is checked only after the same
# budget lock used by settlement. A late competing write retains the hold.
changes = ["recipient_answered_at=now()", "parent_receipt=jsonb_set(parent_receipt,'{costMicros}','5000')", "recording_receipt=jsonb_set(recording_receipt,'{costMicros}','6000')"]
for n, change in enumerate(changes, start=20):
    call, operation = seed(n)
    blocker = subprocess.Popen(CMD, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write(f"begin;set local statement_timeout='8s';select id from icash_operating_budget where id=1 for update;update icash_customer_phone_calls set {change} where id='{call}';select 'proof_locked';\n")
        blocker.stdin.flush()
        while blocker.stdout.readline().strip() != "proof_locked":
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
print("PASS native unanswered child billing: 24 competing reconciliations settle once with real parent/audio costs; late answer/parent/audio changes retain financial holds. No provider calls.")
