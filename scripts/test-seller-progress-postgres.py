"""Native concurrency checks on the disposable localhost CI database. No providers."""
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
A = "00000000-0000-4000-8000-000000000001"
T = "00000000-0000-4000-8000-000000000002"
D = "00000000-0000-4000-8000-000000000003"
S = "00000000-0000-4000-8000-000000000004"


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
        self.query(f"set application_name='{name}'; set statement_timeout='8s'; set deadlock_timeout='100ms';")

    def start(self, query):
        self.p.stdin.write(query + "\n\\echo fixture_done\n")
        self.p.stdin.flush()

    def finish(self):
        result = []
        while True:
            line = self.lines.get(timeout=10)
            if line == "fixture_done":
                return "\n".join(result)
            if line is None:
                raise AssertionError("\n".join(result))
            if line:
                result.append(line)

    def query(self, query):
        self.start(query)
        return self.finish()

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=3)


def function(file, name):
    source = (ROOT / "config" / (file + ".sql")).read_text()
    start = source.index("create function public." + name + "(")
    tag = re.search(r"\bas (\$[A-Za-z_]*\$)", source[start:], re.I).group(1)
    body = source.index(tag, start)
    return source[start:source.index(tag + ";", body + len(tag)) + len(tag) + 1]


fixture = (ROOT / "tests/helpers/seller-progress-fixture.sql").read_text()
split = fixture.index("create function icash_queue_ai_reply(")
setup = fixture[:split] + (ROOT / "tests/fixtures/seller-progress-original-functions.sql").read_text() + fixture[split:]
setup += (ROOT / "tests/helpers/seller-dialogue-fixture.sql").read_text() + (ROOT / "tests/fixtures/seller-dialogue-original-functions.sql").read_text()
setup = re.sub(r"create role (anon|authenticated|service_role);", "", setup)
for file, name in [("seller-response-policy", "icash_seller_direct_response_match"), ("seller-response-policy", "icash_seller_response_disposition"), ("seller-response-policy", "icash_seller_contact_stop")]:
    # The last helper is CREATE OR REPLACE in the policy; use the original helper.
    if name == "icash_seller_contact_stop":
        file = "seller-gap-recovery"
    setup += function(file, name)
sql("drop schema public cascade; create schema public; do $$begin create role anon; exception when duplicate_object then null;end$$; do $$begin create role authenticated; exception when duplicate_object then null;end$$; do $$begin create role service_role; exception when duplicate_object then null;end$$;" + setup)
sql("create trigger icash_text_ai_incoming after insert on icash_text_messages for each row execute function icash_enqueue_text_ai();" + (ROOT / "config/seller-reply-progress.sql").read_text() + (ROOT / "config/seller-dialogue.sql").read_text())
sql(f"update icash_seller_progress_settings set enabled=true; insert into icash_accounts(id) values('{A}'); insert into icash_screening_jobs(id,account_id,snapshot) values('{S}','{A}',jsonb_build_object('propertyId','fixture-property')); insert into icash_deal_files(id,account_id,screening_id) values('{D}','{A}','{S}'); insert into icash_text_threads(id,account_id,deal_id,recipient) values('{T}','{A}','{D}','+15550000002');")

with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    list(pool.map(lambda _: sql(f"insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id) values('{A}','{T}','incoming','received','The roof needs work','same-webhook') on conflict(event_id) do nothing;"), range(16)))
assert sql("select count(*) from icash_text_ai_jobs") == "1"
assert sql("select count(*) from icash_seller_reply_progress") == "1"
J = sql("update icash_text_ai_jobs set state='drafted',analysis='{\"action\":\"ask_price\",\"facts\":[]}' returning id")
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    resumed = list(pool.map(lambda _: json.loads(sql(f"select icash_resume_seller_text_ai('{A}','{J}')")), range(16)))
assert len({r['messageId'] for r in resumed}) == 1
MID = resumed[0]['messageId']
assert sql("select count(*) from icash_text_messages where direction='outgoing'") == "1"
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    claimed = list(pool.map(lambda _: sql(f"select icash_claim_text('{A}','{MID}','+15550000001')"), range(16)))
assert sum(bool(r) for r in claimed) == 1
assert json.loads(sql(f"select icash_resume_seller_text_ai('{A}','{J}')"))['mode'] == 'held'

# A provider writer already holding its row never takes the budget lock. A final
# claim waits for that receipt and then observes that it must not dispatch again.
sql(f"update icash_text_messages set state='ready' where id='{MID}'")
receipt, claim = Session("seller_receipt"), Session("seller_claim")
try:
    receipt.query(f"begin; select id from icash_text_messages where id='{MID}' for update;")
    claim.start(f"select icash_claim_text('{A}','{MID}','+15550000001');")
    deadline = time.monotonic() + 5
    while sql("select exists(select 1 from pg_stat_activity where application_name='seller_claim' and wait_event_type='Lock')") != 't':
        assert time.monotonic() < deadline
        time.sleep(.03)
    receipt.query(f"update icash_text_messages set state='accepted',provider_id='original-receipt' where id='{MID}'; commit;")
    assert claim.finish() == ''
    assert json.loads(sql(f"select icash_finish_seller_text_progress('{A}','{J}',null)"))['reason'] == 'provider_delivery_pending'
finally:
    receipt.close()
    claim.close()

# A concurrent Pause owns the budget lock first; recovery observes the committed
# pause instead of emitting another outgoing message.
pause, resume = Session("seller_pause"), Session("seller_resume")
try:
    pause.query(f"begin; select id from icash_operating_budget where id=1 for update; update icash_accounts set bot_paused=true where id='{A}';")
    resume.start(f"select icash_resume_seller_text_ai('{A}','{J}');")
    pause.query("commit;")
    assert json.loads(resume.finish())['mode'] == 'held'
    assert sql("select count(*) from icash_text_messages where direction='outgoing'") == '1'
finally:
    pause.close()
    resume.close()
print("PASS native PostgreSQL: 16 duplicate webhooks, 16 draft recoveries and 16 final claims create one operation; late receipts and concurrent Pause do not deadlock or replay. No provider calls.")

# The automatic clarification follows the real production final-message and
# financial guard, with only the final provider operation replaced by a fixture.
sql(f"update icash_seller_progress_settings set dialogue_enabled=true; update icash_accounts set bot_paused=false; update icash_screening_jobs set result='{{\"financialCheck\":{{\"status\":\"eligible\"}}}}'; insert into icash_sms_routes(sender,recipient,account_id) values('+15550000001','+15550000002','{A}');")
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    list(pool.map(lambda _: sql(f"insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id) values('{A}','{T}','incoming','received','No third parties','same-dialogue-webhook') on conflict(event_id) do nothing;"), range(16)))
assert sql("select count(*) from icash_text_ai_jobs where analysis->>'dialoguePolicy'='seller-dialogue-v1'") == '1'
DJ = sql("select id from icash_text_ai_jobs where analysis->>'dialoguePolicy'='seller-dialogue-v1'")
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    resumed = list(pool.map(lambda _: json.loads(sql(f"select icash_resume_seller_text_ai('{A}','{DJ}')")), range(16)))
assert len({r['messageId'] for r in resumed}) == 1
DM = resumed[0]['messageId']
assert 'do you mean no agents' in sql(f"select body from icash_text_messages where id='{DM}'")
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    claims = list(pool.map(lambda _: sql(f"select icash_claim_text('{A}','{DM}','+15550000001')"), range(16)))
assert sum(bool(r) for r in claims) == 1
assert sql(f"select count(*) from icash_text_messages where request_key='{DJ}'") == '1'
sql(f"update icash_text_messages set state='delivered',provider_id='dialogue-receipt' where id='{DM}';")
answer = sql(f"insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id) values('{A}','{T}','incoming','received','No agents','dialogue-answer') returning id;")
next_job = sql(f"select id from icash_text_ai_jobs where message_id='{answer}'")
assert sql(f"select analysis->>'dialogueAction' from icash_text_ai_jobs where id='{next_job}'") == 'explain_assignment'
pause, resume = Session('dialogue_pause'), Session('dialogue_resume')
try:
    pause.query(f"begin; select id from icash_operating_budget where id=1 for update; update icash_accounts set bot_paused=true where id='{A}';")
    resume.start(f"select icash_resume_seller_text_ai('{A}','{next_job}');")
    pause.query('commit;')
    assert json.loads(resume.finish())['mode'] == 'held'
    assert sql(f"select count(*) from icash_text_messages where request_key='{next_job}'") == '0'
finally:
    pause.close()
    resume.close()
print('PASS native dialogue: concurrent duplicate webhooks, one clarification/dispatch, grounded next explanation and concurrent Pause; no provider or model calls.')

# Numeric negotiation uses the same native transaction/final-provider boundary.
# Only the already tested pure planner is substituted with its fixture result.
sql("drop schema if exists auth cascade; drop schema if exists icash_call_offer_private cascade; drop schema if exists icash_seller_agreement_private cascade;" + (ROOT / 'tests/helpers/seller-text-offer-fixture.sql').read_text() + (ROOT / 'tests/fixtures/seller-text-offer-original-functions.sql').read_text() + (ROOT / 'config/seller-text-offer.sql').read_text() + (ROOT / 'config/seller-offer-receipt-wait.sql').read_text() + (ROOT / 'config/seller-offer-source-prices.sql').read_text())
NA, NT, ND, NS, NU = [f'10000000-0000-4000-8000-{n:012d}' for n in range(1, 6)]
snapshot = {"propertyId": "prop_123", "propertyType": "house", "sellerCostReserveCents": 0, "raw": {"data": {"dm_property_id": "prop_123", "full_address": "45 Oak Road", "estimated_value": 200000, "estimated_repair_cost": 40000, "total_estimated_loan_balance": 20000, "estimated_equity_percentage": 90}}}
sql(f"""update icash_seller_progress_settings set offer_enabled=true,offer_enabled_at=now()-interval '1 minute';
insert into auth.users(id,email) values('{NU}','fixture@example.invalid');
insert into icash_accounts(id,owner_user_id) values('{NA}','{NU}');
insert into icash_customer_identities values('{NA}','Fixture Buyer');
insert into icash_screening_jobs(id,account_id,snapshot,result) values('{NS}','{NA}','{json.dumps(snapshot)}'::jsonb||jsonb_build_object('fetchedAt',now()),'{{"financialCheck":{{"status":"eligible"}}}}');
insert into icash_deal_files(id,account_id,screening_id,terms) values('{ND}','{NA}','{NS}','{{"address":"45 Oak Road","buyer":"Fixture Buyer","priceCents":21500000,"priceSource":"proposed"}}');
insert into icash_text_threads(id,account_id,deal_id,recipient) values('{NT}','{NA}','{ND}','+12145550222');
insert into icash_sms_routes(sender,recipient,account_id) values('+15550000001','+12145550222','{NA}');""")
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    list(pool.map(lambda _: sql(f"insert into icash_text_messages(account_id,thread_id,direction,state,body,event_id) values('{NA}','{NT}','incoming','received','I need $210k','same-offer-webhook') on conflict(event_id) do nothing;"), range(16)))
NJ, NM = sql(f"select id||'|'||message_id from icash_text_ai_jobs where account_id='{NA}'").split('|')
nc = json.loads(sql(f"select icash_seller_text_offer_context('{NA}','{NM}')"))
plan = {'kind': 'message', 'action': 'cash_offer', 'body': 'Our as-is cash proposal is $102,000, based on property value, repairs and holding costs. Does that work?', 'state': {'textThreadId': NT, 'processedSource': NM, 'proposedPriceCents': 21000000, 'quotedPriceCents': 10200000, 'quoteRevision': 'a'*64, 'acceptedPriceCents': None, 'contractBlocked': False}}
save = f"select icash_save_seller_text_offer('{NA}','{NJ}','{nc['fingerprint']}',{nc['offerVersion']},'{json.dumps(plan)}')"
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    results = list(pool.map(lambda _: sql(save), range(16)))
assert sum(bool(r) for r in results) == 1, results
NUMERIC_MESSAGE = json.loads(next(r for r in results if r))['messageId']
assert sql(f"select count(*) from icash_text_messages where account_id='{NA}' and direction='outgoing'") == '1'
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
    claims = list(pool.map(lambda _: sql(f"select icash_claim_text('{NA}','{NUMERIC_MESSAGE}','+15550000001')"), range(16)))
assert sum(bool(r) for r in claims) == 1
# Reusing a queued message after a concurrent Pause cannot pass final admission.
sql(f"update icash_text_messages set state='ready' where id='{NUMERIC_MESSAGE}'")
pause, claim = Session('offer_pause'), Session('offer_claim')
try:
    pause.query(f"begin; select id from icash_operating_budget where id=1 for update; update icash_accounts set bot_paused=true where id='{NA}';")
    claim.start(f"select icash_claim_text('{NA}','{NUMERIC_MESSAGE}','+15550000001');")
    pause.query('commit;')
    assert claim.finish() == ''
finally:
    pause.close()
    claim.close()
print('PASS native numeric offer: 16 duplicate webhooks, 16 competing plans, one quote and one final operation; concurrent Pause wins without a replay.')
