"""Actual enrichment guards, immutable history and native generic-plan checks."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('priority_fixture',ROOT/'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql


def walk(node):
    yield node
    for child in node.get('Plans',[]):
        yield from walk(child)


def run():
    fixture.setup()
    sql((ROOT/'tests/fixtures/acquisition-property-history.sql').read_text())
    account = sql("select md5('priority-account-1')::uuid;")
    definition = sql("select pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);")
    body = definition.split('AS $function$\n')[1].split('\n$function$')[0].replace('p_account',"'"+account+"'::uuid")
    query = body[:body.index(' order by public.icash_owner_preflight_due_at')]+ ' order by s.id;'
    history = "select md5(string_agg(v,',' order by v)) from(select to_jsonb(s)::text v from public.icash_screening_jobs s union all select to_jsonb(o)::text from public.icash_operation_spend o union all select to_jsonb(c)::text from public.icash_owner_contacts c) x;"
    before = sql(query)
    before_hash = sql(history)
    before_plan = json.loads(sql('explain(analyze,buffers,format json) '+query))[0]
    migration = (ROOT/'config/acquisition-property-history-index.sql').read_text()
    versions = list((ROOT/'supabase/migrations').glob('*_acquisition_property_history_index.sql'))
    assert len(versions)==1 and versions[0].read_text()==migration
    sql(migration)
    sql('analyze public.icash_screening_jobs;')
    after_plan = json.loads(sql('explain(analyze,buffers,format json) '+query))[0]
    assert sql(query)==before and sql(history)==before_hash
    assert sql("select pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);")==definition
    assert any(n.get('Index Name')=='icash_screening_property_account' for n in walk(after_plan['Plan']))
    assert after_plan['Plan']['Shared Hit Blocks']*2 < before_plan['Plan']['Shared Hit Blocks'],(before_plan,after_plan)
    # Different account/source history never blocks this account. Exact original
    # same-account operations retain their hold even when permissions expired.
    primary = sql("select md5('priority-screening-1')::uuid;")
    for owner_account,kind,expected in [(1,'operation',False),(2,'operation',True),(1,'contacts',False),(2,'contacts',True)]:
        other = sql(f"select md5('priority-account-{owner_account}')::uuid;")
        insert_history = f"""insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
          select md5('late-property-history')::uuid,'{other}','late-property-history',snapshot,'complete',result,now()-interval '2 days'
          from public.icash_screening_jobs where id='{primary}';"""
        if kind=='operation':
            insert_history += f"insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until) values('owners:{other}:'||md5('late-property-history')::uuid,'{other}',md5('priority-rate-{owner_account}')::uuid,gen_random_uuid(),105,250000,'dispatched',now()-interval '1 day');"
        else:
            insert_history += f"insert into public.icash_owner_contacts(screening_id,account_id,operation_key,result) values(md5('late-property-history')::uuid,'{other}','late-exact-contact','{{}}');"
        rows = sql('begin;set local plan_cache_mode=force_generic_plan;prepare selected as '+query+insert_history+'execute selected;rollback;').splitlines()
        assert (primary in rows)==expected,(owner_account,kind,rows)
    assert sql(history)==before_hash
    print(f"PASS acquisition property history index: actual guards unchanged across repeated history, expired unknown operations, contacts, NULL IDs and tenant boundaries; generic plan sees late evidence; shared hits {before_plan['Plan']['Shared Hit Blocks']} -> {after_plan['Plan']['Shared Hit Blocks']}. No providers.")


if __name__=='__main__':
    run()
