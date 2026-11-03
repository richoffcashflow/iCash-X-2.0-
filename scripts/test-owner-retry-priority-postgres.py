"""Actual retry ordering and lock races in the fixed disposable local database."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from threading import Barrier
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('priority', ROOT / 'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
sql, read, ISSUE = fixture.sql, fixture.read, fixture.ISSUE


def setup(install=True):
    fixture.setup()
    definitions = json.loads(read('tests/fixtures/owner-retry-priority-before.json'))
    for definition in definitions.values():
        sql(definition)
    if install:
        sql(read('config/owner-retry-fair-priority.sql'))


def seed(n, waiting=False, overdue='2 minutes', fresh=False):
    c = json.loads(sql(f"select fixture_preflight_seed({n},true,interval '{overdue}');"))
    c['operation'] = f"owners:{c['account']}:{c['screening']}"
    if not waiting:
        # Synthetic confirmed cleanup, not mutation of production history.
        sql(f"update icash_research_private.owner_export_preflights set deleted_at=now(),cleanup_attempts=1 where id='{c['preflight']}';")
    if not fresh:
        sql(f"update icash_screening_jobs set result='{{\"financialCheck\":{{\"status\":\"ineligible\"}}}}' where id='{c['fresh']}';")
    return c


def only(c):
    sql(f"update icash_discovery_configs set enabled=(account_id='{c['account']}');")


def candidate(c):
    return sql(f"select public.icash_enrichment_before_prospecting_budget('{c['account']}');")


def hint(c):
    return sql(f"select public.icash_owner_retry_due_at('{c['account']}') is not null;") == 't'


def selected():
    return json.loads(sql("select coalesce(jsonb_agg(account_id::text order by account_id),'[]') from icash_automation_tickets where state='issued';"))


def concurrent_issue(total=24):
    barrier = Barrier(total)

    def issue(_):
        barrier.wait(timeout=10)
        return json.loads(sql(ISSUE))

    with ThreadPoolExecutor(max_workers=total) as pool:
        return list(pool.map(issue, range(total)))


def no_paid():
    fixture.assert_no_paid_work()


def late_refusal(c, mutation, kind):
    only(c)
    assert hint(c) and candidate(c) == c['screening']
    before = fixture.evidence(c)
    blocker = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write("begin;set local statement_timeout='8s';do $$begin perform 1 from icash_operating_budget where id=1 for update;end$$;"+mutation+"select 'retry_guard_locked';\n")
        blocker.stdin.flush()
        fixture.wait_for_marker(blocker, 'retry_guard_locked')
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(sql, ISSUE)
            deadline = time.monotonic()+5
            waiting = False
            while time.monotonic() < deadline:
                waiting = sql("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and application_name='preflight-priority-contender' and wait_event_type='Lock' and query like '%icash_next_acquisition%');") == 't'
                if waiting:
                    break
                time.sleep(0.025)
            assert waiting, kind+' issuer did not reach original budget lock'
            blocker.stdin.write('commit;\n\\q\n')
            blocker.stdin.flush()
            blocker.wait(timeout=5)
            assert blocker.returncode == 0, blocker.stderr.read()
            assert json.loads(future.result()) is None, kind+' cannot issue after committed guard'
        after = fixture.evidence(c)
        assert after['preflight'] == before['preflight'], kind+' changed historical list/receipts'
        if kind == 'deadline':
            for key, value in before['ticket'].items():
                if key not in ('owner_preview_retry_until', 'outcome'):
                    assert after['ticket'][key] == value, (kind, key)
            assert after['ticket']['outcome'] == 'owner_preview_expired'
            assert sql(f"select owner_preview_retry_until<=now() from icash_automation_tickets where id='{c['ticket']}';") == 't'
        else:
            assert after['ticket'] == before['ticket'], kind+' changed original capability, retry counters or deadlines'
        if kind == 'reserved':
            assert after['wallet']['reserved_cents'] == before['wallet']['balance_cents']
            assert after['wallet']['balance_cents'] == before['wallet']['balance_cents']
        else:
            assert after['wallet'] == before['wallet'], kind+' changed wallet'
        assert after['rate'] == before['rate'], kind+' changed approved rate/cap'
        assert sql(f"select count(*) from icash_automation_tickets where account_id='{c['account']}' and state='issued';") == '0'
        assert candidate(c) == '', kind+' final candidate must reject even if an ordering hint remains'
        no_paid()
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.wait(timeout=5)


def plan_nodes(plan):
    yield plan
    for child in plan.get('Plans', []):
        yield from plan_nodes(child)


def generic_hint_plan(source, c, drop=False, generic=True):
    pre = 'begin;'+('drop index public.icash_automation_owner_retry_due;' if drop else '')
    mode = 'force_generic_plan' if generic else 'auto'
    result = sql(pre+f"set local plan_cache_mode='{mode}';prepare retry_hint(uuid) as "+source.replace('p_account', '$1')+
                 f"\nexplain(analyze,buffers,format json) execute retry_hint('{c['account']}');rollback;")
    return json.loads(result)[0]


def budget_call_proof(c):
    # Preserve each boundary's return behavior but prevent SQL inlining, so the
    # native function statistics count real nested calls without introducing
    # writes into STABLE functions or approximating the account hint itself.
    sql("""create or replace function public.icash_membership_work_allowed(uuid) returns boolean
      language plpgsql stable set search_path='' as $$begin return (select member from public.fixture_cleanup_policy);end$$;
      create or replace function public.icash_prospecting_available(uuid) returns bigint
      language plpgsql stable set search_path='' as $$begin return (select balance_cents-reserved_cents from public.icash_wallets where account_id=$1);end$$;
      create or replace function public.icash_research_admission_quote(uuid,text,bigint) returns bigint
      language plpgsql stable set search_path='' as $$begin return $3;end$$;""")
    names = "('icash_membership_work_allowed','icash_prospecting_available','icash_research_admission_quote')"

    fresh = [json.loads(sql(f"select fixture_preflight_seed({n},false,interval '2 minutes');"))['account'] for n in range(33000, 33117)]
    ids = ','.join("'"+a+"'::uuid" for a in fresh)
    # Transaction-local function statistics are synchronous; no sleeps, global
    # counter resets or asynchronous statistics-flush assumptions are needed.
    measured = 'select jsonb_object_agg(p.proname,coalesce(s.calls,0)) from pg_proc p left join pg_stat_xact_user_functions s on s.funcid=p.oid where p.pronamespace=\'public\'::regnamespace and p.proname in '+names+';'
    observed = json.loads(sql("begin;set local track_functions='all';do $$declare a uuid;begin foreach a in array array["+ids+"] loop if public.icash_owner_retry_due_at(a) is not null then raise exception 'Unexpected due retry';end if;end loop;end$$;"+measured+'rollback;'))
    assert observed == {name: 0 for name in ('icash_membership_work_allowed', 'icash_prospecting_available', 'icash_research_admission_quote')}, observed
    observed = json.loads(sql(f"begin;set local track_functions='all';do $$begin if public.icash_owner_retry_due_at('{c['account']}') is null then raise exception 'Due account not found';end if;end$$;"+measured+'rollback;'))
    assert all(value == 1 for value in observed.values()) and len(observed) == 3, observed
    print('PASS native retry hint cost: 117 ordinary no-due accounts make zero membership/budget/quote calls; one due account makes exactly one call to each boundary.')


def run():
    setup(False)
    retry = seed(30001, fresh=True)
    for n in range(30100, 30229):
        sql(f"select fixture_preflight_seed({n},false,interval '6 minutes');")
    before = fixture.evidence(retry)
    assert candidate(retry) == retry['fresh'], 'Reproduce higher score displacing a due original retry without a surviving list'
    old_choice = sql("begin;do $$begin perform icash_next_acquisition();end$$;select account_id from icash_automation_tickets where state='issued';rollback;")
    assert old_choice != retry['account'], 'Reproduce newer fresh accounts winning ahead of due retry'
    sql(read('config/owner-retry-fair-priority.sql'))
    assert hint(retry) and candidate(retry) == retry['screening']
    assert fixture.evidence(retry) == before, 'Read-only preference cannot change original evidence'
    new_choice = sql("begin;do $$begin perform icash_next_acquisition();end$$;select account_id from icash_automation_tickets where state='issued';rollback;")
    assert new_choice == retry['account'], 'Due original retry advances ahead of 129 fresh accounts'
    only(retry)
    results = concurrent_issue()
    assert len([r for r in results if r is not None]) == 1 and selected() == [retry['account']], results
    after = fixture.evidence(retry)
    for key, value in before['ticket'].items():
        if key not in ('token', 'state', 'outcome', 'completed_at', 'created_at', 'expires_at'):
            assert after['ticket'][key] == value, key
    for key in ('preflight', 'wallet', 'rate'):
        assert after[key] == before[key], key
    no_paid()
    print('PASS native retry priority: old displacement reproduced; 129 fresh accounts yield; 24 issuers rotate one exact original capability without changing retry caps/deadlines or financial evidence.')

    # Saved original lists retain the existing first priority. Persistent retry
    # traffic cannot defeat the original ten-minute ordinary-account escape.
    sql('update icash_discovery_configs set enabled=false;')
    rows = [seed(n) for n in range(30300, 30325)]
    saved = seed(30350, waiting=True)
    chosen = sql("begin;do $$begin perform icash_next_acquisition();end$$;select account_id from icash_automation_tickets where state='issued' and account_id<>('"+retry['account']+"');rollback;")
    assert chosen == saved['account'], 'Saved preflight priority remains ahead of generic retries'
    # Replenished cohorts model sustained retry arrivals, not repeated sends.
    for n in range(30400, 30404):
        ordinary = json.loads(sql(f"select fixture_preflight_seed({n},false,interval '11 minutes');"))
        assert json.loads(sql(ISSUE)) is not None
        assert ordinary['account'] in selected(), 'Ordinary aged account must win despite continuing due retry traffic'
        seed(n+100)
    no_paid()

    # Current admission is authoritative even when cheap ordering hints are stale.
    paused = seed(30600)
    late_refusal(paused, f"update icash_accounts set bot_paused=true where id='{paused['account']}';", 'pause')
    reserved = seed(30601)
    late_refusal(reserved, f"update icash_wallets set reserved_cents=balance_cents where account_id='{reserved['account']}';", 'reserved')
    changed = seed(30602)
    late_refusal(changed, f"update icash_screening_jobs set snapshot=snapshot||'{{\"propertyId\":\"prop_999999999\"}}' where id='{changed['screening']}';", 'source')
    expired = seed(30603)
    late_refusal(expired, f"update icash_automation_tickets set owner_preview_retry_until=now()-interval '1 second' where id='{expired['ticket']}';", 'deadline')
    capped = seed(30604)
    late_refusal(capped, f"""insert into icash_owner_enrichment_recoveries(operation_key,ticket_id,account_id,screening_id,expected_ticket_hash,expected_screening_hash,
      reviewed_source,reviewed_source_hash,code_stage,approved_max_charge_cents)
      select '{capped['operation']}',id,account_id,screening_id,repeat('a',64),owner_preview_screening_hash,'SYNTHETIC immutable original cap',repeat('b',64),
       'owner_preview_pre_provider_local_rate_limit_v1',100 from icash_automation_tickets where id='{capped['ticket']}';""", 'cap')
    unknown = seed(30605)
    late_refusal(unknown, f"insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('other','{unknown['operation']}:original','synthetic-original',null,'credits');", 'receipt')
    assert sql(f"select count(*) from icash_cost_observations where event_key='{unknown['operation']}:original' and amount is null and not reconciled;") == '1'
    print('PASS native retry priority: late customer Pause, reserved wallet, changed source, deadline, original approval cap and unknown receipt defeat the actual issuer under its original budget lock.')

    # An invalid prefix cannot hide a valid later account forever. Every empty
    # pass advances only its existing five configurations, preserving records.
    sql('update icash_discovery_configs set enabled=false;')
    bad = []
    for n in range(30700, 30817):
        c = seed(n)
        sql(f"update icash_automation_tickets set owner_preview_screening_hash=repeat('0',64) where id='{c['ticket']}';")
        bad.append(c)
    valid = seed(30850)
    sql(f"update icash_automation_tickets set owner_preview_retry_after=now()-interval '1 minute' where id='{valid['ticket']}';")
    original = [fixture.evidence(c) for c in bad]
    issued = False
    for _ in range(24):
        reads_before = int(sql('select count(*) from fixture_priority_reads;'))
        result = json.loads(sql(ISSUE))
        reads_after = int(sql('select count(*) from fixture_priority_reads;'))
        assert reads_after-reads_before <= 5
        if result is not None:
            assert valid['account'] in selected()
            issued = True
            break
    assert issued, 'Valid account after 117 stale hints must advance within 24 bounded passes'
    for c, evidence in zip(bad, original):
        assert fixture.evidence(c) == evidence, 'Stale ordering hint must not mutate original ticket/evidence'
    no_paid()

    # Generic plans over large ticket history: the account hint reads one indexed
    # finite retry; expensive complete-source proof stays in final selection.
    large = seed(30900)
    only(large)
    sql(f"""insert into icash_automation_tickets(account_id,kind,state,outcome,created_at,expires_at)
      select '{large['account']}', 'contacts','complete','synthetic-history',now()-interval '2 days',now()-interval '2 days' from generate_series(1,100000);
      insert into icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
      select md5('retry-invalid-screen-'||g)::uuid,account_id,'retry-invalid-screen-'||g,
       snapshot||jsonb_build_object('propertyId','prop_'||(40000+g),'padding',repeat('x',16000)),state,result,completed_at
      from icash_screening_jobs s,generate_series(1,1000) g where s.id='{large['screening']}';
      insert into icash_automation_tickets(id,account_id,kind,screening_id,state,outcome,created_at,expires_at,owner_preview_deferrals,
       owner_preview_retry_after,owner_preview_retry_until,owner_preview_screening_hash)
      select md5('retry-invalid-ticket-'||g)::uuid,'{large['account']}','contacts',md5('retry-invalid-screen-'||g)::uuid,'held','owner_preview_rate_limited',
       now()-interval '8 minutes',now()-interval '7 minutes',2,now()-interval '6 minutes',now()+interval '20 hours',repeat('0',64) from generate_series(1,1000) g;
      update icash_automation_tickets set owner_preview_retry_after=now()-interval '1 minute' where id='{large['ticket']}';
      analyze icash_automation_tickets;analyze icash_screening_jobs;""")
    assert candidate(large) == large['screening'], 'Final selector rejects 1000 invalid full-source hashes and reaches the valid later ticket'
    body = sql("select prosrc from pg_proc where oid='public.icash_owner_retry_due_at(uuid)'::regprocedure;")
    assert 'icash_owner_enrichment_screening_hash(' not in body and 'icash_screening_jobs' not in body
    first_read_start = body.index(' select t.owner_preview_retry_after')
    first_read = body[first_read_start:body.index(';', first_read_start)+1].replace(' into due_at', '')
    assert 'limit 1' in first_read and 'icash_screening_jobs' not in first_read
    before_plan = generic_hint_plan(first_read, large, True)
    after_plan = generic_hint_plan(first_read, large)
    default_plan = generic_hint_plan(first_read, large, generic=False)
    nodes = list(plan_nodes(after_plan['Plan']))
    indexed = [node for node in nodes if node.get('Index Name') == 'icash_automation_owner_retry_due']
    assert indexed and sum(node.get('Actual Rows', 0)*node.get('Actual Loops', 1) for node in indexed) == 1, after_plan
    assert any(node.get('Index Name') == 'icash_automation_owner_retry_due' for node in plan_nodes(default_plan['Plan'])), default_plan
    old_buffers = before_plan['Plan'].get('Shared Hit Blocks', 0)+before_plan['Plan'].get('Shared Read Blocks', 0)
    new_buffers = after_plan['Plan'].get('Shared Hit Blocks', 0)+after_plan['Plan'].get('Shared Read Blocks', 0)
    assert new_buffers < old_buffers, (old_buffers, new_buffers)
    final_plan = json.loads(sql(f"explain(analyze,buffers,format json) select icash_enrichment_before_prospecting_budget('{large['account']}');"))[0]
    print('PASS native retry hint generic plan: 100000 historical tickets + 1000 invalid prefix; indexed rows=1; buffers '+str(old_buffers)+' -> '+str(new_buffers)+
          '; hint execution ms='+str(after_plan['Execution Time'])+'; separate complete-source candidate ms='+str(final_plan['Execution Time'])+'.')
    budget_call_proof(large)
    for role in ('anon', 'authenticated', 'service_role'):
        assert sql(f"select has_function_privilege('{role}','public.icash_owner_retry_due_at(uuid)','execute');") == ('t' if role == 'service_role' else 'f')
    no_paid()


if __name__ == '__main__':
    run()
