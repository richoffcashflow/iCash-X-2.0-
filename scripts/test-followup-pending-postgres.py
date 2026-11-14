"""Isolated native proof that a zero-due poll cannot finish pending originals."""
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
    result = subprocess.run(CMD, input="set statement_timeout='12s';set timezone='UTC';\n"+query,
                            env=ENV, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()

assert sql("select current_database()||':'||inet_server_port()") == 'icash_reliability:5432'
sql('drop schema if exists icash_work_private cascade;drop schema if exists icash_reliability_private cascade;drop schema if exists icash_research_private cascade;drop schema if exists icash_owner_review_private cascade;drop schema if exists icash_private cascade;drop schema public cascade;create schema public;')
setup = subprocess.run(['node','--input-type=module','-e',
    "import {followupCheckpointSetup} from './tests/helpers/followup-checkpoint-fixture.mjs';process.stdout.write(followupCheckpointSetup());"],
    cwd=ROOT, capture_output=True, text=True, check=True).stdout
sql(setup)
sql((ROOT/'config/followup-step-checkpoints.sql').read_text())
sql('begin;'+(ROOT/'config/followup-pending-originals.sql').read_text()+'commit;')
pending_definition=sql("select pg_get_functiondef('icash_account_followup_pending(uuid,uuid,text)'::regprocedure)")
sql("alter function icash_account_followup_pending(uuid,uuid,text) set statement_timeout='4s';")
assert sql("select icash_work_private.activate_followup_steps(repeat('c',40))")=='f', 'Drifted completion predicate cannot activate'
sql(pending_definition)
account='00000000-0000-4000-8000-000000000001'
other='00000000-0000-4000-8000-000000000002'
ticket='00000000-0000-4000-8000-000000000003'
voice='00000000-0000-4000-8000-000000000004'
research='00000000-0000-4000-8000-000000000005'
sql(f"""insert into icash_accounts(id,owner_user_id) values('{account}','{account}'),('{other}','{other}');
 insert into icash_automation_tickets(id,account_id,kind,state) values('{ticket}','{account}','account_reconcile','consumed');
 insert into icash_work_private.account_followups(account_id,ticket_id,lease_until,claimed_version,claimed_notify_version,notify_version)
 values('{account}','{ticket}',now()+interval '5 minutes',1,1,1);
 insert into icash_operation_rates(id,operation) values('{voice}','seller_call'),('{research}','property_search');
 insert into icash_operation_spend(operation_key,account_id,rate_id,state,estimate_checked_at)
 values('voice:cooldown','{account}','{voice}','dispatched',now()),('voice:reserved','{account}','{voice}','reserved',now());
 insert into icash_operation_spend(operation_key,account_id,rate_id,state) select 'research:'||n,'{account}','{research}','dispatched' from generate_series(1,26) n;
""")

def pending(step, a=account, t=ticket):
    return sql(f"set role service_role;select icash_account_followup_pending('{a}','{t}','{step}');")

before=sql('select md5(jsonb_agg(to_jsonb(o) order by operation_key)::text) from icash_operation_spend o;')
assert pending('voice_receipts')=='t', 'Reserved/cooldown and absent conversation remain pending'
assert pending('estimates')=='t'
with ThreadPoolExecutor(max_workers=12) as pool:
    assert set(pool.map(lambda _: pending('voice_receipts'), range(24)))=={'t'}
assert sql('select md5(jsonb_agg(to_jsonb(o) order by operation_key)::text) from icash_operation_spend o;')==before
assert pending('estimates',other)=='' and pending('invalid')==''
for role in ('anon','authenticated'):
    assert sql(f"select has_function_privilege('{role}','icash_account_followup_pending(uuid,uuid,text)','execute')")=='f'
# One bounded batch settles 25 originals, leaving the 26th visible.
sql("update icash_operation_spend set state='settled' where operation_key like 'research:%' and operation_key<>'research:26';")
assert pending('estimates')=='t'
sql("update icash_operation_spend set state='settled' where operation_key='research:26';")
assert pending('estimates')=='f' and pending('voice_receipts')=='t', 'Independent rate families do not block each other'
sql("update icash_operation_spend set state='settled' where operation_key like 'voice:%';")
assert pending('voice_receipts')=='f'
sql(f"insert into icash_operation_spend(operation_key,account_id,state) values('unknown-rate','{account}','reserved');")
assert pending('voice_receipts')=='t' and pending('estimates')=='t', 'Missing rate is uncertainty, not completed work'
sql("delete from icash_operation_spend where operation_key='unknown-rate';")
# New original work after the zero-pending read wakes a new source version.
# Install the actual existing operation wake functions and trigger.
source=(ROOT/'config/runtime-cost-efficiency.sql').read_text()
wake=source[source.index('create function icash_work_private.wake_account_followup('):source.index('create or replace function icash_work_private.enqueue_account_followup(')]
operation=source[source.index('create function icash_work_private.wake_on_operation_change('):source.index('create function icash_work_private.wake_on_cost_receipt(')]
sql(wake+operation)
assert sql("select icash_work_private.activate_followup_steps(repeat('c',40))")=='t'
claim=json.loads(sql(f"select icash_claim_followup_step('{account}','{ticket}','voice_receipts');"))
assert pending('voice_receipts')=='f'
sql(f"insert into icash_operation_spend(operation_key,account_id,rate_id,state) values('voice:new','{account}','{voice}','dispatched');")
assert sql(f"select icash_finish_followup_step('{account}','{ticket}','voice_receipts','{claim['id']}',true,'{{\"pending\":false}}');")=='t'
assert sql(f"select icash_finish_account_followup('{account}','{ticket}',true);")=='t'
assert sql('select requested_version>completed_version and next_run_at<=clock_timestamp() from icash_work_private.account_followups;')=='t'
sql(f"insert into icash_automation_tickets(id,account_id,kind,state) values('{other}','{account}','account_reconcile','consumed');update icash_work_private.account_followups set ticket_id='{other}',claimed_version=requested_version,lease_until=now()+interval '5 minutes';")
replacement=json.loads(sql(f"select icash_claim_followup_step('{account}','{other}','voice_receipts');"))
assert replacement['status']=='claimed', 'Old completed version cannot suppress new original work'
assert pending('voice_receipts',t=other)=='t'
sql('update icash_work_private.account_followups set lease_until=now()-interval \'1 second\';')
assert pending('voice_receipts',t=other)==''
print('PASS PostgreSQL 17: pending-original completion proof, 26-record partial batch, cooldown/reserved/unknown identity, independent rate families, 24 readers, actual wake-trigger race, source-version recovery and private ACLs. No providers or financial changes by the reader.')
