"""Compete for normal seller introductions on a delayed line in the local CI database."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import importlib.util
import json
import subprocess

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', root / 'scripts/test-owner-preflight-priority-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sql = fixture.sql


def main():
    assert sql('select current_database()') == 'icash_reliability'
    data = json.loads(subprocess.check_output(['node', str(root / 'tests/helpers/sender-delay-opener-fixture.mjs')], text=True))
    sql('drop schema if exists icash_text_receipt_private cascade;'
        'drop schema if exists icash_learning_policy_private cascade;'
        'drop schema if exists icash_work_private cascade;drop schema public cascade;create schema public;')
    sql(data['setup'] + data['migration'] + data['delay'] + data['age'])
    sql('alter role service_role bypassrls;select fixture_seed_admission(n,n) from generate_series(2,13) n;')
    barrier = Barrier(12)

    def issue(n):
        barrier.wait(timeout=10)
        thread = f'20000000-0000-4000-8000-{n:012d}'
        return sql(f"set role service_role;select icash_queue_seller_opener(account_id,id) from icash_text_threads where id='{thread}'")

    with ThreadPoolExecutor(max_workers=12) as workers:
        results = list(workers.map(issue, range(2,14)))
    assert sum(bool(value) for value in results) == 1, results
    assert sql('select count(*) from icash_seller_opener_assignments') == '2'
    assert sql('select count(*) from icash_operation_spend') == '1'
    print('PASS twelve concurrent queues: one normal recovery introduction and no extra spend')


if __name__ == '__main__':
    main()
