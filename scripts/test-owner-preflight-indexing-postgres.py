"""Original-list polling races in the fixed disposable PostgreSQL fixture only."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
from threading import Barrier

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("priority", ROOT / "scripts/test-owner-preflight-priority-postgres.py")
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)
sql, read = fixture.sql, fixture.read


def literal(value):
    return "'" + json.dumps(value, separators=(',', ':')).replace("'", "''") + "'::jsonb"


def receipt(raw):
    return {'httpStatus': 200, 'raw': raw, 'rawText': json.dumps(raw, separators=(',', ':'))}


def metadata(case, status='completed', count=1):
    return receipt({'data': {'list_id': 'list-'+case['id'], 'name': case['name'],
                            'source_type': 'people', 'status': status, 'total_count': count}})


def count(value):
    return receipt({'total_people': value, 'total_results': value, 'total_properties': value, 'credits': {'used': 0}})


def setup():
    fixture.setup()
    src = read('config/owner-enrichment-deferral.sql')
    sql(src[src.index('create function public.icash_defer_owner_enrichment'):src.index('-- A delayed response')])
    src = read('config/owner-preflight-renewal.sql')
    sql(src[:src.index('create function icash_research_private.guard_owner_preflight_generation')]+'commit;')
    sql(read('tests/fixtures/owner-preflight-ready-foundation.sql'))
    ready = json.loads(read('tests/fixtures/owner-preflight-ready-before.json'))
    for name in ('public.icash_owner_batch_candidates(uuid,uuid)', 'public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'):
        sql(ready[name]['definition'])
    definitions = json.loads(read('tests/fixtures/owner-preflight-indexing-before.json'))
    sql(definitions['icash_research_private.owner_preflight_ready_current(uuid)']['definition'])
    for signature, item in definitions.items():
        sql(item['definition'])
        assert sql(f"select md5(pg_get_functiondef('{signature}'::regprocedure));") == item['hash']
    src = read('config/owner-export-preflight.sql')
    sql(src[src.index('create function public.icash_record_owner_preflight_cleanup'):src.index('-- Keep final purchase authority')])
    sql(read('config/owner-preflight-list-indexing.sql'))
    sql('update icash_research_private.owner_export_settings set preflight_indexing_enabled=true;')


def seed(n):
    c = json.loads(sql(f'select fixture_preflight_seed({n},false);'))
    snapshot = json.loads(sql(f"select snapshot from icash_screening_jobs where id='{c['screening']}';"))
    c['items'] = [{'screeningId': c['screening'], 'snapshot': snapshot, 'ids': ['per_'+str(n)]}]
    c['request'] = {'people_ids': ['per_'+str(n)], 'mobile_only': False, 'property_match': 'owner',
                    'anchor': 'person', 'require_phone': True, 'scrub_dnc': True, 'active_phones_only': True}
    c.update(json.loads(sql(claim(c))))
    return c


def claim(c):
    return f"select icash_claim_owner_preflight('{c['account']}',{literal(c['items'])},{literal(c['request'])});"


def record(c, step, observation):
    return f"select icash_record_owner_preflight('{c['id']}','{c['lease']}','{step}',{literal(observation)});"


def due(c):
    sql(f"update icash_research_private.owner_export_preflights set next_check_at=now()-interval '1 second' where id='{c['id']}';")


def concurrent(query, total=24):
    barrier = Barrier(total)

    def run(_):
        barrier.wait(timeout=10)
        return sql(query)

    with ThreadPoolExecutor(max_workers=total) as pool:
        return list(pool.map(run, range(total)))


def row(c):
    return json.loads(sql(f"select to_jsonb(p) from icash_research_private.owner_export_preflights p where id='{c['id']}';"))


def held_evidence(c):
    """The entire original capability, receipts, controls and financial scope."""
    return json.loads(sql(f"""select jsonb_build_object(
      'preflight',(select to_jsonb(p) from icash_research_private.owner_export_preflights p where p.id='{c['id']}'),
      'account',(select to_jsonb(a) from icash_accounts a where a.id='{c['account']}'),
      'wallet',(select to_jsonb(w) from icash_wallets w where w.account_id='{c['account']}'),
      'rate',(select to_jsonb(r) from icash_operation_rates r where r.id='{c['rate']}'),
      'config',(select to_jsonb(d) from icash_discovery_configs d where d.account_id='{c['account']}'),
      'tickets',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from icash_automation_tickets t where t.account_id='{c['account']}'),
      'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.operation_key),'[]') from icash_operation_spend o where o.account_id='{c['account']}'),
      'reservations',(select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_key),'[]') from icash_credit_reservations r where r.account_id='{c['account']}'),
      'original_costs',(select coalesce(jsonb_agg(to_jsonb(o) order by o.provider,o.event_key),'[]') from icash_cost_observations o
        where o.event_key='owners:{c['account']}:{c['screening']}:original'));
    """))


def assert_blocked_contention(c, kind):
    saved = held_evidence(c)
    assert json.loads(sql(claim(c))) == {'status': 'held'}, kind+' must be held without contention'
    # Prove the deliberate early-return branch instead of treating "pending"
    # as an admission. With the original account lock held, every contender must
    # return before the Pause/receipt checks and without returning a capability.
    blocker = subprocess.Popen(fixture.CMD, env=fixture.ENV, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        blocker.stdin.write(f"begin;set local statement_timeout='8s';do $$begin perform pg_advisory_xact_lock(hashtextextended('owner-preflight:{c['account']}',0));end$$;select 'indexing_account_locked';\n")
        blocker.stdin.flush()
        fixture.wait_for_marker(blocker, 'indexing_account_locked')
        locked_results = [json.loads(value) for value in concurrent(claim(c))]
        assert locked_results == [{'status': 'pending'}]*24, (kind, locked_results)
        assert held_evidence(c) == saved, kind+' locked contenders changed original evidence or caps'
        blocker.stdin.write('commit;\n\\q\n')
        blocker.stdin.flush()
        blocker.wait(timeout=5)
        assert blocker.returncode == 0, blocker.stderr.read()
    finally:
        if blocker.poll() is None:
            blocker.kill()
            blocker.wait(timeout=5)
    # Uncoordinated competing callers may lose the advisory lock, but the lock
    # winner must still reject. No create/check status, lease or other capability
    # fields are permitted in either outcome.
    results = [json.loads(value) for value in concurrent(claim(c))]
    assert {'status': 'held'} in results and all(result in ({'status': 'held'}, {'status': 'pending'}) for result in results), (kind, results)
    assert json.loads(sql(claim(c))) == {'status': 'held'}, kind+' must remain held after all contenders'
    assert held_evidence(c) == saved, kind+' changed receipts, lease, counters, customer controls or financial evidence'
    assert sql(f"select count(*) from icash_automation_tickets where account_id='{c['account']}' and state in ('issued','consumed');") == '0'
    print(f"PASS native indexing {kind}: 24 locked contenders return only pending; unlocked winner held; no capability or original-evidence changes.")


def run():
    setup()
    c = seed(20001)
    original = metadata(c, 'idle', 0)
    assert sql(record(c, 'create', original)) == 'pending'
    due(c)
    candidates = [json.loads(value) for value in concurrent(claim(c))]
    checks = [v for v in candidates if v['status'] == 'check']
    assert len(checks) == 1 and sum(v['status'] == 'pending' for v in candidates) == 23
    c.update(checks[0])
    assert c['nextStep'] == 'metadata'
    old_lease = c['lease']
    assert concurrent(record(c, 'metadata', metadata(c))) == ['checking']*24
    assert concurrent(record(c, 'baseline', count(0))) == ['pending']*24
    before = row(c)
    assert before['receipts']['create'] == original and 'baseline' not in before['receipts']
    assert concurrent(f"select icash_claim_owner_preflight_cleanup('{c['id']}');") == ['']*24
    due(c)
    candidates = [json.loads(value) for value in concurrent(claim(c))]
    checks = [v for v in candidates if v['status'] == 'check']
    assert len(checks) == 1
    c.update(checks[0])
    assert c['nextStep'] == 'baseline' and c['lease'] != old_lease
    old = {**c, 'lease': old_lease}
    assert sql(record(old, 'baseline', count(1))) == 'held', 'A late old handler cannot complete the new attempt'
    assert concurrent(record(c, 'baseline', count(1))) == ['checking']*24
    assert concurrent(record(c, 'eligible', count(1))) == ['ready']*24
    after = row(c)
    for key, observation in before['receipts'].items():
        assert after['receipts'][key] == observation
    assert sql(f"select icash_research_private.owner_preflight_ready_current('{c['id']}');") == 't'
    cleanup = concurrent(f"select icash_claim_owner_preflight_cleanup('{c['id']}');")
    assert len([value for value in cleanup if value]) == 1
    assert row(c)['cleanup_attempts'] == 1
    # Customer Pause and an original unknown operation both block another poll;
    # neither control is altered just to recover indexing progress.
    for n, kind in ((20002, 'pause'), (20003, 'original')):
        held = seed(n)
        sql(record(held, 'create', metadata(held, 'idle', 0)))
        due(held)
        if kind == 'pause':
            sql(f"update icash_accounts set bot_paused=true where id='{held['account']}';")
        else:
            sql(f"insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine','owners:{held['account']}:{held['screening']}:original','synthetic-original',null,'credits');")
        assert_blocked_contention(held, kind)
    # Competing issuers with a large waiting backlog advance independent work.
    sql('update icash_discovery_configs set enabled=false;')
    for n in range(21000, 21130):
        sql(f"select fixture_preflight_seed({n},true,interval '6 minutes');")
    sql("""update icash_automation_tickets set owner_preview_retry_after=now()+interval '90 seconds' where state='held';
      update icash_research_private.owner_export_preflights set next_check_at=now()+interval '90 seconds' where state='waiting';
      update icash_screening_jobs set result='{"financialCheck":{"status":"ineligible"}}' where event_key like 'synthetic-fresh-%';""")
    eligible = [json.loads(sql(f"select fixture_preflight_seed({n},false,interval '11 minutes');"))['account'] for n in range(22000, 22003)]
    results = concurrent(fixture.ISSUE)
    assert len([v for v in results if v != 'null']) == 3, results
    actual = json.loads(sql("select jsonb_agg(account_id::text order by account_id) from icash_automation_tickets where state='issued';"))
    assert actual == sorted(eligible)
    assert sql('select count(*) from icash_operation_spend;') == '0'
    assert sql('select count(*) from icash_credit_reservations;') == '0'
    assert sql('select count(*) from fixture_ready_admissions;') == '0'
    print('PASS native original list indexing: 24 competing claims/saves/cleanups preserve one handler, old leases fail, original evidence/Pause/holds survive; 130 waiting accounts yield to three eligible accounts; no providers or paid work.')


if __name__ == '__main__':
    run()
