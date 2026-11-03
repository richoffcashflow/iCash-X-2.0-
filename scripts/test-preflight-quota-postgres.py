"""Concurrent locally-denied free-preflight recovery; fixed isolated DB only."""
from concurrent.futures import ThreadPoolExecutor
import json, os, re, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ENV={**os.environ,'PGPASSWORD':'isolated-fixture-only','PGCONNECT_TIMEOUT':'5'}
CMD=['psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55443','-U','postgres','-d','icash_reliability']
def sql(s):
 r=subprocess.run(CMD,input="set statement_timeout='8s';\n"+s,env=ENV,text=True,capture_output=True,timeout=15)
 if r.returncode: raise AssertionError(r.stderr)
 return r.stdout.strip()
def lit(v):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
def uid(n):return f'00000000-0000-4000-8000-{n:012d}'
assert sql('select current_database();')=='icash_reliability'
sql('drop schema if exists icash_research_private cascade;drop schema public cascade;create schema public;')
sql(re.sub(r'create role (anon|authenticated|service_role);','',(ROOT/'tests/fixtures/owner-preflight-foundation.sql').read_text()))
for f in ['config/owner-export-preflight.sql','tests/fixtures/owner-preflight-quota.sql','config/owner-preflight-quota-recovery.sql']:sql((ROOT/f).read_text())
sql('update icash_research_private.owner_export_settings set preflight_enabled=true,preflight_quota_recovery_enabled=true;')
def setup(n):
 a,s=uid(n),uid(n+1);snap={'propertyId':f'prop_{n+1}'};items=[{'screeningId':s,'snapshot':snap,'ids':[f'per_{n+1}']}]
 request={'people_ids':items[0]['ids'],'property_match':'owner','anchor':'person','require_phone':True,'scrub_dnc':True,'active_phones_only':True}
 sql(f"insert into icash_accounts values('{a}',false);insert into icash_screening_jobs values('{s}','{a}','complete',{lit(snap)});insert into fixture_recovery_gates(account_id,eligible) values('{a}',true);")
 query=f"select icash_claim_owner_preflight('{a}',{lit(items)},{lit(request)});"
 return a,json.loads(sql(query)),query
def deny(a,c,n,step='create',admitted=False):
 sql(f"insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result) values('{uid(n)}','owner_preview','{a}','owner-preflight:{c['id']}:{step}',{'true' if admitted else 'false'},{lit({'outcome':'unknown' if admitted else 'quota_wait'})});")
 return f"select icash_defer_owner_preflight_quota('{c['id']}','{c['lease']}','{step}','{uid(n)}');"
def due():
 sql("alter table icash_research_private.owner_preflight_quota_deferrals disable trigger owner_preflight_quota_immutable;update icash_research_private.owner_preflight_quota_deferrals set created_at=now()-interval '31 seconds';alter table icash_research_private.owner_preflight_quota_deferrals enable trigger owner_preflight_quota_immutable;")
a,c,claim=setup(100);deferral=deny(a,c,110)
with ThreadPoolExecutor(max_workers=12) as pool:assert set(pool.map(lambda _:sql(deferral),range(24)))=={'t'}
assert sql('select count(*) from icash_research_private.owner_preflight_quota_deferrals;')=='1'
due()
with ThreadPoolExecutor(max_workers=12) as pool:claims=list(pool.map(lambda _:json.loads(sql(claim)),range(24)))
assert sum(c['status']=='create' for c in claims)==1,claims
assert all(c['status'] in ('create','pending') for c in claims),claims
assert sql('select count(*) from fixture_purchases;')=='0'
print('PASS native quota recovery: 24 repeated denial saves are idempotent; 24 workers issue exactly one new lease, no provider purchase.')

# One waiting account yields immediately; independently eligible accounts can
# obtain their own original free check even with a large pending cohort.
waiting=[]
for n in range(200,1200,10):
 a,c,query=setup(n);sql(deny(a,c,n+2));waiting.append(query)
sql('update fixture_settings set quota=false;')
with ThreadPoolExecutor(max_workers=12) as pool:assert all(x['status']=='pending' for x in pool.map(lambda query:json.loads(sql(query)),waiting))
sql('update fixture_settings set quota=true;')
a,independent,query=setup(1300);assert independent['status']=='create'
print('PASS native quota recovery: 100 waiting accounts do not block independent accounts or consume new provider quota.')

# Pause takes the ordinary budget lock before recovery's final current gate.
a,c,query=setup(1400);sql(deny(a,c,1402));due()
pause=subprocess.Popen(CMD,env=ENV,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
try:
 pause.stdin.write(f"begin;select id from icash_operating_budget where id=1 for update;update icash_accounts set bot_paused=true where id='{a}';select 'locked';\n");pause.stdin.flush()
 while pause.stdout.readline().strip()!='locked':
  if pause.poll() is not None:raise AssertionError(pause.stderr.read())
 with ThreadPoolExecutor(max_workers=1) as pool:
  future=pool.submit(sql,query)
  for _ in range(80):
   if sql(f"select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%icash_claim_owner_preflight%{a}%');")=='t':break
   time.sleep(.025)
  else:raise AssertionError('Claim did not reach current eligibility lock')
  pause.stdin.write('commit;\n\\q\n');pause.stdin.flush();pause.wait(timeout=5)
  assert json.loads(future.result())['status']=='held'
 assert sql(f"select lease='{c['lease']}'::uuid from icash_research_private.owner_export_preflights where id='{c['id']}';")=='t'
finally:
 if pause.poll() is None:pause.kill();pause.wait(timeout=5)
print('PASS native quota recovery: committed customer Pause wins before capability rotation.')

# A known admitted provider request, changed snapshot or an expired window is
# never revived merely because a limiter refusal also exists.
for n,kind in [(1500,'admitted'),(1600,'source'),(1700,'expired'),(1800,'funds'),(1820,'membership'),(1840,'reserved')]:
 a,c,query=setup(n);sql(deny(a,c,n+2));due()
 if kind=='admitted':deny(a,c,n+3,admitted=True)
 if kind=='source':sql(f"update icash_screening_jobs set snapshot='{{\"propertyId\":\"changed\"}}' where account_id='{a}';")
 if kind=='expired':sql(f"alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable;update icash_research_private.owner_export_preflights set created_at=now()-interval '6 minutes' where id='{c['id']}';alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable;")
 if kind=='reserved':sql(f"update fixture_recovery_gates set reserved_cents=balance_cents where account_id='{a}';")
 if kind=='membership':sql(f"update fixture_recovery_gates set membership=false where account_id='{a}';")
 if kind=='funds':sql(f"update fixture_recovery_gates set eligible=false where account_id='{a}';")
 assert json.loads(sql(query))['status']=='held',kind
 assert sql(f"select lease='{c['lease']}'::uuid from icash_research_private.owner_export_preflights where id='{c['id']}';")=='t'
print('PASS native quota recovery: admitted unknown request, changed source, expired window and current insufficient headroom remain held.')

a,c,query=setup(1900)
for i in range(7):
 assert sql(deny(a,c,1950+i))=='t';due();c=json.loads(sql(query));assert c['status']=='create'
assert sql(deny(a,c,1957))=='f','Existing bounded retry ceiling must not become an endless queue'
assert sql('select count(*) from fixture_purchases;')=='0'
print('PASS native quota recovery: seven immutable local deferrals exhaust safely; no paid receipt, customer usage or reservation is changed.')
