"""Native READY continuation races on the fixed disposable local fixture DB."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from threading import Barrier

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "preflight_priority_fixture", ROOT / "scripts/test-owner-preflight-priority-postgres.py")
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
sql = fixture.sql


def setup():
    # Reuse the actual schema, retry/current checks, grants and installed
    # priority definitions, not a separate approximation of the issuer.
    fixture.setup()
    definitions = json.loads(fixture.read("tests/fixtures/owner-preflight-ready-before.json"))
    for signature in (
        "public.icash_owner_preflight_due_at(uuid,uuid)",
        "icash_research_private.owner_preflight_cohort(uuid,uuid)",
        "public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)",
    ):
        definition = definitions[signature]
        expected = hashlib.md5(definition['definition'].encode()).hexdigest()
        assert expected == definition['hash'], signature
        assert sql(f"select md5(pg_get_functiondef('{signature}'::regprocedure));") == expected, signature
    sql(fixture.read("config/owner-preflight-ready-continuity.sql"))


def ready_seed(n, checked_age="22 minutes"):
    case = fixture.seed(n)
    # Only synthetic setup bypasses the immutable trigger. It reconstructs an
    # original successful count followed by normal confirmed list cleanup.
    sql(f"""
      begin;
      alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable;
      update icash_research_private.owner_export_preflights
       set created_at=now()-interval '36 minutes',state='ready',
        started_at=now()-interval '{checked_age}'-interval '1 second',
        checked_at=now()-interval '{checked_age}',next_check_at=now()-interval '34 minutes',
        receipts=receipts||jsonb_build_object(
         'baseline',jsonb_build_object('httpStatus',200,'raw','{{"total_people":1,"total_results":1,"total_properties":1}}'::jsonb,
          'rawText','{{"total_people":1,"total_results":1,"total_properties":1}}'),
         'eligible',jsonb_build_object('httpStatus',200,'raw','{{"total_people":1,"total_results":1,"total_properties":1}}'::jsonb,
          'rawText','{{"total_people":1,"total_results":1,"total_properties":1}}')),
        cleanup_attempts=1,cleanup_token=id,deleted_at=now()-interval '{checked_age}'+interval '1 second',
        cleanup_receipts=jsonb_build_array(jsonb_build_object('token',id,
         'receipt',jsonb_build_object('httpStatus',200,'raw','{{"data":{{"deleted":true}}}}'::jsonb,
          'rawText','{{"data":{{"deleted":true}}}}')))
       where id='{case['preflight']}';
      alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable;
      commit;
    """)
    assert sql("select tgenabled from pg_trigger where tgname='owner_preflight_immutable';") == 'O'
    return case


def due(case):
    return sql(f"set role service_role;select public.icash_owner_preflight_due_at('{case['account']}','{case['screening']}') is not null;") == 't'


def run():
    setup()
    private = 'icash_research_private.owner_preflight_ready_current(uuid)'
    public = 'public.icash_owner_preflight_due_at(uuid,uuid)'
    for role in ('anon', 'authenticated', 'service_role'):
        assert sql(f"select has_function_privilege('{role}','{private}','execute');") == 'f'
        assert sql(f"select has_function_privilege('{role}','{public}','execute');") == ('t' if role == 'service_role' else 'f')
        assert sql(f"select has_schema_privilege('{role}','icash_research_private','usage');") == 'f'
        assert sql(f"select has_table_privilege('{role}','icash_research_private.owner_export_preflights','select');") == 'f'

    case = ready_seed(101)
    before = fixture.evidence(case)
    assert due(case), 'A deleted READY list retains the existing checked-at admission window'
    assert sql(f"select icash_research_private.owner_preflight_ready_current('{case['preflight']}');") == 't'
    assert sql(f"select icash_research_private.owner_preflight_cohort('{case['account']}','{case['screening']}') is not null;") == 't'
    assert sql(f"set role service_role;select public.icash_enrichment_candidate('{case['account']}');") == case['screening']
    assert fixture.evidence(case) == before, 'Priority cannot refresh the positive timestamp or original receipts'

    barrier = Barrier(24)

    def issue(_):
        barrier.wait(timeout=10)
        return json.loads(sql(fixture.ISSUE))

    with ThreadPoolExecutor(max_workers=24) as pool:
        results = list(pool.map(issue, range(24)))
    issued = [result for result in results if result is not None]
    assert len(issued) == 1 and results.count(None) == 23, results
    assert sql("select count(*) from public.icash_automation_tickets where state='issued';") == '1'
    after = fixture.evidence(case)
    assert after['ticket']['token'] == issued[0]['token']
    assert after['ticket']['token'] != before['ticket']['token']
    assert after['ticket']['state'] == 'issued'
    for field, value in before['ticket'].items():
        if field not in {'token', 'state', 'outcome', 'completed_at', 'created_at', 'expires_at'}:
            assert after['ticket'][field] == value, field
    for field in ('preflight', 'wallet', 'rate'):
        assert after[field] == before[field], field
    fixture.assert_no_paid_work()

    paused = ready_seed(102)
    fixture.late_guard(paused, f"update public.icash_accounts set bot_paused=true where id='{paused['account']}';",
                       'Late Pause must defeat READY continuation under the budget lock')
    observed = ready_seed(103)
    fixture.late_guard(observed, f"insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine','{observed['operation']}:original','synthetic-original-ready-receipt',null,'credits');",
                       'Late original unknown cost must defeat READY continuation under the budget lock')
    assert sql(f"select count(*) from public.icash_cost_observations where event_key='{observed['operation']}:original' and amount is null and not reconciled;") == '1'

    for n, mutation in ((104, 'source'), (105, 'rate')):
        blocked = ready_seed(n)
        assert due(blocked)
        if mutation == 'source':
            sql(f"update public.icash_screening_jobs set snapshot=snapshot||'{{\"propertyId\":\"prop_99999999\"}}'::jsonb where id='{blocked['screening']}';")
        else:
            sql(f"update public.icash_operation_rates set charge_cents=10001 where id='{blocked['rate']}';")
        saved = fixture.evidence(blocked)
        assert not due(blocked), mutation
        assert json.loads(sql(fixture.ISSUE)) is None, mutation
        assert fixture.evidence(blocked) == saved, mutation

    expired = ready_seed(106, '30 minutes')
    saved = fixture.evidence(expired)
    assert not due(expired), 'The original checked-at 30-minute limit cannot be extended'
    assert sql(f"select icash_research_private.owner_preflight_ready_current('{expired['preflight']}');") == 'f'
    assert sql(f"select icash_research_private.owner_preflight_cohort('{expired['account']}','{expired['screening']}') is null;") == 't'
    assert fixture.evidence(expired) == saved

    waiting = fixture.seed(107)
    sql(f"""begin;
      alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable;
      update icash_research_private.owner_export_preflights set created_at=now()-interval '30 minutes'
       where id='{waiting['preflight']}';
      alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable;
      commit;""")
    saved = fixture.evidence(waiting)
    assert not due(waiting), 'WAITING retains its original creation-age limit'
    assert sql(f"select icash_research_private.owner_preflight_cohort('{waiting['account']}','{waiting['screening']}') is null;") == 't'
    assert fixture.evidence(waiting) == saved
    fixture.assert_no_paid_work()
    print('PASS native READY continuity: 24 issuers create one ticket; original positive timestamp, receipts and retry budget stay immutable; late Pause, unknown cost, changed source and unaffordable rate reject; READY checked-at and WAITING creation-age limits remain; private helper has no service grant. No providers.')


if __name__ == '__main__':
    run()
