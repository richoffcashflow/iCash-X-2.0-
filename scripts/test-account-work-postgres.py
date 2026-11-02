"""Native contention checks for account repair; synthetic isolated database only."""
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

assert sql("select current_database();") == "icash_reliability"
sql("drop schema if exists icash_reliability_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema public cascade;create schema public;")
sql((ROOT/"tests/fixtures/account-work-repair.sql").read_text())
a, r = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
op = "discovery:"+a+":fixture"
parts = {"dealmachine":250000,"support_and_overhead":40000}
sql(f"""
insert into icash_accounts(id,owner_user_id,bot_paused,created_at,workspace_ack_version) values('{a}','{a}',false,now()-interval '2 days','fixture');
insert into icash_wallets(account_id,balance_cents,reserved_cents) values('{a}',1000,0);
insert into icash_operation_rates(id,operation,version,costs_micros,charge_cents,enabled,verified_at,expires_at)
values('{r}','property_search','native-fixture','{json.dumps(parts)}',105,true,now()-interval '1 day',now()+interval '1 day');
insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents,reserved_micros,standard_cost_multiplier,elevenlabs_cost_multiplier,dealmachine_cost_multiplier,data_unit_cost_micros,data_cost_basis,created_at,dispatched_at)
values('{op}','{a}','{r}','dispatched',105,350000,2,2,3,10000,'fixture',now(),now());
insert into icash_discovery_results(operation_key,account_id,result,created_at) values('{op}','{a}','{{"creditsUsed":1}}',now());
insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine','{op}','dealmachine:search:{op}',1,'provider_credits');
select icash_settle_estimate_before_sms_tokens('{op}');
""")
assert sql(f"select bot_paused from icash_accounts where id='{a}'") == "t"
before = sql("select md5(jsonb_agg(to_jsonb(o))::text) from icash_operation_spend o")
sql((ROOT/"config/research-settlement-routing.sql").read_text())
with ThreadPoolExecutor(max_workers=12) as pool:
    results = list(pool.map(lambda _: sql(f"select icash_correct_legacy_research_settlement('{op}')"), range(36)))
assert all(json.loads(value)["creditedCents"] == 47 for value in results)
assert sql("select count(*) from icash_credit_ledger where event_key like 'research-correction:%'") == "1"
assert sql("select balance_cents from icash_wallets") == "989"
assert before == sql("select md5(jsonb_agg(to_jsonb(o))::text) from icash_operation_spend o")
# Hold the same operating-budget/account lock used by Pause while recovery starts.
holder = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=ENV)
holder.stdin.write(f"begin;select 1 from icash_operating_budget where id=1 for update;update icash_accounts set bot_paused=true where id='{a}';insert into icash_control_events(id,account_id,actor_user_id,action,created_at) values(gen_random_uuid(),'{a}','{a}','pause',now());select 'pause_locked';\n")
holder.stdin.flush()
assert holder.stdout.readline().strip() == "1"
assert holder.stdout.readline().strip() == "pause_locked"
with ThreadPoolExecutor(max_workers=4) as pool:
    pending = pool.submit(sql, f"select icash_resume_corrected_research_pause('{a}')")
    holder.stdin.write("commit;\n");holder.stdin.flush();holder.stdin.close()
    assert pending.result(timeout=12) == "f"
holder.wait(timeout=10)
assert holder.returncode == 0
assert sql("select bot_paused from icash_accounts") == "t"
# Both settlement entry points must serialize on the original operation.
op2 = op+":new"
sql(f"""
insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents,reserved_micros,standard_cost_multiplier,elevenlabs_cost_multiplier,dealmachine_cost_multiplier,data_unit_cost_micros,data_cost_basis)
values('{op2}','{a}','{r}','dispatched',105,350000,2,2,3,10000,'fixture');
insert into icash_discovery_results(operation_key,account_id,result,created_at) values('{op2}','{a}','{{"creditsUsed":24}}',now());
insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine','{op2}','dealmachine:search:{op2}',24,'provider_credits');
""")
with ThreadPoolExecutor(max_workers=12) as pool:
    assert set(pool.map(lambda n: sql(f"select {'icash_settle_estimate_before_sms_tokens' if n%2 else 'icash_settle_dealmachine_usage'}('{op2}')"), range(36))) == {"t"}
assert sql(f"select charged_cents from icash_operation_spend where operation_key='{op2}'") == "80"
assert sql(f"select count(*) from icash_credit_ledger where event_key='usage:{op2}'") == "1"
print("PASS native PostgreSQL: 72 concurrent correction/settlement calls, one exact credit, one usage charge, immutable original receipts and customer Pause wins recovery.")
