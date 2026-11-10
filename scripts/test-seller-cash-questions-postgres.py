"""Direct cash questions under real queue locks, using disposable localhost PG."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import subprocess
from threading import Barrier
import time
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('opener_fixture',ROOT/'scripts/test-seller-opener-bounded-postgres.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
sql=fixture.sql
data=json.loads(subprocess.check_output(['node',str(ROOT/'tests/helpers/seller-cash-questions-fixture.mjs')],text=True))
QUEUE="set role service_role;set application_name='cash-question-queue';"+data['queueSql']+';'
def setup(migrated=True):
 assert sql('select current_database();')=='icash_reliability'
 sql('drop schema if exists icash_learning_policy_private cascade;drop schema if exists icash_work_private cascade;drop schema if exists icash_sender_private cascade;drop schema if exists icash_text_receipt_private cascade;drop schema public cascade;create schema public;')
 sql(data['setupSql']);sql('alter role service_role bypassrls;')
 if migrated:sql(data['migration']+data['enableSql'])
 return sql('select to_jsonb(w) from icash_wallets w;')
def wait_lock():
 deadline=time.monotonic()+4
 while sql("select exists(select 1 from pg_stat_activity where application_name='cash-question-queue' and wait_event_type='Lock');")!='t':
  assert time.monotonic()<deadline;time.sleep(.025)
def run():
 # An old compiled invocation finishes with its old helper and original body.
 setup(False)
 patch=data['migration'].replace('\nbegin;\n','\n',1).removesuffix('commit;\n')
 holder=fixture.holder(patch+data['enableSql'],'cash_migration_ready')
 try:
  with ThreadPoolExecutor(max_workers=1) as pool:
   future=pool.submit(sql,QUEUE);wait_lock();fixture.release(holder);assert future.result()
  assert sql("select learning_context from icash_seller_opener_assignments;")=='identity-v4'
  assert 'Do you own' in sql('select body from icash_text_messages;')
 finally:fixture.stop(holder)
 wallet=setup();barrier=Barrier(3)
 def queue(_):barrier.wait(timeout=5);return sql(QUEUE)
 with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(queue,range(3)))
 assert sum(bool(r) for r in results)==1
 assert sql("select count(*) from icash_seller_opener_assignments where learning_context='cash-question-v6';")=='1'
 assert sql('select count(*) from icash_text_messages;')=='1'
 assert sql("select a.body=m.body and a.message_id=m.id and o.owner_question_id=m.id and o.owner_reply_id is null from icash_seller_opener_assignments a join icash_text_messages m on m.id=a.message_id join icash_sms_seller_openings o on o.thread_id=a.thread_id;")=='t'
 assert sql('select to_jsonb(w) from icash_wallets w;')==wallet
 assert sql('select count(*) from icash_operation_spend;')=='0'
 # Late Pause and withdrawn source review survive a queue waiting on budget.
 for change in ['update icash_text_threads set paused=true;','update icash_text_threads set review_allowed=false;']:
  setup();holder=fixture.holder('select 1 from icash_operating_budget where id=1 for update;'+change,'cash_pause_ready')
  try:
   with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(sql,QUEUE);wait_lock();fixture.release(holder);assert future.result()==''
   assert sql('select count(*) from icash_text_messages;')=='0';assert sql('select count(*) from icash_seller_opener_assignments;')=='0'
  finally:fixture.stop(holder)
 print('PASS native cash questions: old compiled queue, competing queues, immutable exact message binding, unchanged wallets and late Pause/source-review holds.')
if __name__=='__main__':run()
