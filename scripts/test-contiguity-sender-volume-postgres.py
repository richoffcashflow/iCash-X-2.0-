"""Race independent property, marketing and transactional grants for the last SMS slots."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import importlib.util

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fixture", root / "scripts/test-owner-preflight-priority-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql

def race(queries):
    barrier = Barrier(len(queries))
    def run(query):
        barrier.wait(timeout=20)
        return sql(query)
    with ThreadPoolExecutor(max_workers=len(queries)) as threads:
        return list(threads.map(run, queries))

def main():
    assert sql("select current_database()") == "icash_reliability"
    migration, = (root / "supabase/migrations").glob("*_contiguity_sender_volume.sql")
    sql("drop schema if exists icash_sender_private cascade;drop schema public cascade;create schema public;")
    sql((root / "tests/fixtures/contiguity-volume-predecessors.sql").read_text())
    sql((root / "tests/fixtures/contiguity-volume-admission.sql").read_text())
    sql(migration.read_text())
    sql("grant usage on schema public to service_role;grant select,insert,update on all tables in schema public to service_role;")
    line = "'+14155550100'"
    owner = "md5('owner')::uuid"
    sql(f"insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'history',md5(i::text)::uuid,{line},true,now() from generate_series(1,99) i;")
    jobs = [sql(f"select fixture_message('race{i}',fixture_thread('race{i}'))") for i in range(8)]
    claims = [f"set role service_role;select public.icash_claim_text({owner},'{job}',{line}) is not null" for job in jobs]
    assert race(claims).count("t") == 1
    assert sql("select count(*) from public.icash_operation_spend") == "1"
    assert sql("select count(*) from icash_sender_private.waiting") == "7"

    # All channels contend on the real sending number, even from different accounts.
    sql(f"insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at) select 'service',md5(i::text)::uuid,{line},false,now() from generate_series(1,899) i;")
    assert race([f"set role service_role;select icash_sender_private.take('access-code',md5('code{i}')::uuid,{line},false)" for i in range(8)]).count("t") == 1
    assert sql(f"select count(*) from icash_sender_private.uses where sender={line}") == "1000"
    assert sql("select icash_sender_private.take('access-code',md5('separate')::uuid,'+16195550100',false)") == "t"
    # A reservation-safe deferral cannot retry after the customer's draft changes.
    sql("update icash_sender_private.uses set admitted_at=now()-interval '25 hours';"
        "update public.icash_text_messages set body='Replacement' where state='ready';"
        "update icash_sender_private.waiting set next_check_at=now()-interval '1 second';")
    assert sql("select public.icash_next_sender_volume_retry() is null") == "t"
    assert sql("select count(*) from icash_sender_private.waiting") == "0"
    assert sql("select count(*) from public.icash_operation_spend") == "1"
    print("PASS shared rolling sender slots, charged-work rollback, independent lines, and superseded unsent messages under native PostgreSQL contention")

if __name__ == "__main__":
    main()
