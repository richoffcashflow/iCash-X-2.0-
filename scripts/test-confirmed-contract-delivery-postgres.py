"""Same confirmed agreement under native competing claims; no provider traffic."""
from concurrent.futures import ThreadPoolExecutor
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from threading import Barrier
import re

ROOT = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location('contract_fixture', ROOT/'scripts/test-owner-preflight-priority-postgres.py')
base = module_from_spec(SPEC)
SPEC.loader.exec_module(base)
sql = base.sql
read = lambda path: (ROOT/path).read_text()
a = '00000000-0000-4000-8000-000000000001'
m = '00000000-0000-4000-8000-000000000008'
send = f"select coalesce(public.icash_claim_text_before_owner_question('{a}','{m}','+12025550102')::text,'null');"
claim = "select coalesce(public.icash_claim_agreement_delivery_recovery()::text,'null');"

assert sql('select current_database();') == 'icash_reliability'
sql('drop schema if exists icash_seller_agreement_private cascade;drop schema if exists icash_call_offer_private cascade;drop schema if exists auth cascade;drop schema public cascade;create schema public;')
for role in ['anon', 'authenticated', 'service_role']:
    sql(f"do $$begin if not exists(select 1 from pg_roles where rolname='{role}') then create role {role};end if;end$$;")
sql(re.sub(r'create role (anon|authenticated|service_role);', '', read('tests/fixtures/confirmed-contract-delivery.sql')))
for name in ['icash_claim_text_before_owner_question','icash_claim_agreement_delivery_recovery']:
    sql(read(f'tests/fixtures/{name}-20261105.sql'))
assert sql(send) == 'null'
assert sql(claim) == 'null'
sql(read('config/confirmed-contract-text-delivery.sql'))

def compete(query):
    barrier = Barrier(16)
    def run(_):
        barrier.wait(timeout=10)
        return sql(query)
    with ThreadPoolExecutor(max_workers=16) as pool:
        return list(pool.map(run, range(16)))

assert sum(result != 'null' for result in compete(claim)) == 1, 'One worker claims the original agreement'
assert sum(result != 'null' for result in compete(send)) == 1, 'One worker claims the original text'
assert sql('select count(*) from public.icash_operation_spend;') == '1'
assert sql('select count(*) from public.icash_signing_envelopes;') == '1'
assert sql('select count(*) from public.icash_text_messages;') == '1'
assert sql("select result->'financialCheck'->>'status' from public.icash_screening_jobs;") == 'hold'

# Durable dispatch/unknown evidence never becomes eligible for another claim.
sql("update icash_seller_agreement_private.delivery_recovery set state='needs_review',claimed_at=now()-interval '3 minutes';update public.icash_text_messages set state='ready';")
assert all(result == 'null' for result in compete(claim))
assert all(result == 'null' for result in compete(send))
assert sql('select count(*) from public.icash_operation_spend;') == '1'
sql("delete from public.icash_operation_spend;update public.icash_accounts set bot_paused=true;")
assert all(result == 'null' for result in compete(claim))
assert all(result == 'null' for result in compete(send))
sql("update public.icash_accounts set bot_paused=false;update icash_call_offer_private.offers set state=state-'acceptedPriceCents';")
assert all(result == 'null' for result in compete(claim))
assert all(result == 'null' for result in compete(send))
assert sql("select has_function_privilege('anon','public.icash_confirmed_seller_contract_text_current(uuid,uuid)','execute') or has_function_privilege('authenticated','public.icash_confirmed_seller_contract_text_current(uuid,uuid)','execute');") == 'f'
sql('drop schema icash_seller_agreement_private cascade;drop schema icash_call_offer_private cascade;drop schema auth cascade;drop schema public cascade;create schema public;')
print('PASS native contract delivery: original failure, 16 competing recovery and dispatch claims, one original envelope/text, original screening retained, unknown operation/Pause/withdrawal blocked. No providers.')
