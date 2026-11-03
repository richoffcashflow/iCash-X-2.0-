import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const migration=read('config/owner-retry-fair-priority.sql');
const originals=JSON.parse(read('tests/fixtures/owner-retry-priority-before.json'));
const seed=(n,waiting=true,age='2 minutes')=>v('select fixture_preflight_seed($1,$2,$3::interval)',[n,waiting,age]);
const clearList=c=>q('update icash_research_private.owner_export_preflights set deleted_at=now(),cleanup_attempts=1 where id=$1',[c.preflight]);
const hint=c=>v('select icash_owner_retry_due_at($1)',[c.account]);
const candidate=c=>v('select icash_enrichment_before_prospecting_budget($1)',[c.account]);
const issue=()=>v('select icash_next_acquisition()');
const evidence=c=>v(`select jsonb_build_object('ticket',to_jsonb(t),'preflight',to_jsonb(p),'wallet',to_jsonb(w),'rate',to_jsonb(r)) from icash_automation_tickets t,icash_research_private.owner_export_preflights p,icash_wallets w,icash_operation_rates r where t.id=$1 and p.id=$2 and w.account_id=$3 and r.id=$4`,[c.ticket,c.preflight,c.account,c.rate]);
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(read('tests/fixtures/opportunity-schema.sql'));
 await pg.exec(read('tests/fixtures/owner-cleanup-ticket-recovery-native.sql'));
 for(const [file,stop] of [['config/owner-enrichment-deferral.sql','create function public.icash_defer_owner_enrichment'],['config/owner-export-preflight.sql','create function public.icash_claim_owner_preflight']]){const source=read(file);await pg.exec(source.slice(0,source.indexOf(stop))+'commit;');}
 await pg.exec(read('tests/fixtures/owner-preflight-priority-foundation.sql'));
 const foundation=JSON.parse(read('tests/fixtures/owner-preflight-priority-before.json'));
 for(const name of ['icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)','public.icash_enrichment_before_prospecting_budget(uuid)','public.icash_enrichment_before_provider_quota(uuid)','public.icash_enrichment_candidate(uuid)','public.icash_next_acquisition()'])await pg.exec(foundation[name]);
 await pg.exec('update icash_research_private.owner_export_settings set preflight_enabled=true');
 await pg.exec(read('config/owner-preflight-priority.sql'));
 for(const [signature,definition] of Object.entries(originals))assert.equal(await v('select pg_get_functiondef($1::regprocedure)',[signature]),definition,'Exact current selector prerequisite: '+signature);
 const retry=await seed(1000);await clearList(retry);
 for(let n=1;n<=129;n++)await seed(n,false,'6 minutes');
 assert.equal(await v('select icash_owner_preflight_due_at($1,null::uuid)',[retry.account]),null,'Deleted saved list supplies no existing priority');
 assert.equal(await candidate(retry),retry.fresh,'Reproduce fresh property displacing due held retry');
 await isolated(async()=>{await issue();assert.notEqual(await v("select account_id from icash_automation_tickets where state='issued'"),retry.account);});
 const before=await evidence(retry);
 const currentProof=await v("select pg_get_functiondef('icash_owner_enrichment_retry_current(uuid,uuid)'::regprocedure)");
 await pg.exec(migration);
 assert.equal(await v("select pg_get_functiondef('icash_owner_enrichment_retry_current(uuid,uuid)'::regprocedure)"),currentProof);
 assert.ok(await hint(retry));assert.equal(await candidate(retry),retry.screening);
 assert.deepEqual(await evidence(retry),before,'Ranking changes no capability, deadline, receipt, price or wallet');
 const accountAdded="  case when d.contacts_enabled and d.contact_rate_id is not null\n   and public.icash_owner_active_export_capacity() in ('disabled','ready')\n   then public.icash_owner_retry_due_at(d.account_id) end nulls last,\n";
 const propertyAdded="\n  case when t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited'\n   and t.owner_preview_deferrals between 1 and 7 and t.owner_preview_retry_after<=now() and t.owner_preview_retry_until>now()\n   then t.owner_preview_retry_after end nulls last,";
 assert.equal((await v("select pg_get_functiondef('icash_next_acquisition()'::regprocedure)")).replace(accountAdded,''),originals['public.icash_next_acquisition()'],'Exact issuer difference is only one ORDER BY expression');
 assert.equal((await v("select pg_get_functiondef('icash_enrichment_before_prospecting_budget(uuid)'::regprocedure)")).replace(propertyAdded,''),originals['public.icash_enrichment_before_prospecting_budget(uuid)'],'Exact property difference is only one ORDER BY expression');
 await isolated(async()=>{
  const result=await issue();assert(result?.token);
  const after=await evidence(retry);assert.equal(after.ticket.state,'issued');assert.notEqual(after.ticket.token,before.ticket.token);
  const mutable=new Set(['token','state','outcome','completed_at','created_at','expires_at']);
  for(const [key,value] of Object.entries(before.ticket))if(!mutable.has(key))assert.deepEqual(after.ticket[key],value,key);
  for(const key of ['preflight','wallet','rate'])assert.deepEqual(after[key],before[key]);
  assert.equal(await v('select count(*)::int from fixture_priority_reads'),1);
 });
 await isolated(async()=>{
  const saved=await seed(2000);assert((await issue())?.token);assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),saved.account,'Existing saved-list priority remains first');
 });
 await isolated(async()=>{
  const aged=await seed(2001,false,'11 minutes');assert((await issue())?.token);assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),aged.account,'Ordinary aging precedes both retry families');
  assert((await issue())?.token);assert.equal(await v("select count(*)::int from icash_automation_tickets where id=$1 and state='issued'",[retry.ticket]),1);
 });
 await isolated(async()=>{
  // Large invalid prefix is a priority hint, never a proof shortlist. The
  // original selector rejects its stale hashes, then chooses the valid retry.
  await q(`with jobs as(insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at)
   select account_id,'invalid-priority-'||n,snapshot,state,result,completed_at from icash_screening_jobs cross join generate_series(1,512)n where id=$1 returning id,account_id)
   insert into icash_automation_tickets(account_id,kind,screening_id,state,outcome,owner_preview_deferrals,owner_preview_retry_after,owner_preview_retry_until,owner_preview_screening_hash)
   select account_id,'contacts',id,'held','owner_preview_rate_limited',1,now()-interval '9 minutes',now()+interval '20 hours',repeat('0',64) from jobs`,[retry.screening]);
  await pg.exec('set local plan_cache_mode=force_generic_plan');
  assert.ok(await hint(retry));assert.equal(await candidate(retry),retry.screening);assert((await issue())?.token);
  assert.equal(await v("select count(*)::int from icash_automation_tickets where account_id=$1 and state='issued'",[retry.account]),1);
  assert.equal(await v("select screening_id from icash_automation_tickets where account_id=$1 and state='issued'",[retry.account]),retry.screening);
 });
 const gates=[
  ['update icash_accounts set bot_paused=true where id=$1',retry.account],
  ['update fixture_cleanup_policy set member=false'],['update icash_operating_budget set enabled=false'],
  ['update icash_wallets set reserved_cents=balance_cents where account_id=$1',retry.account],
  ['update icash_discovery_configs set auto_enabled=false where account_id=$1',retry.account],
  ["update icash_operation_rates set expires_at=now()-interval '1 second' where id=$1",retry.rate],
  ['update icash_operation_rates set enabled=false where id=$1',retry.rate],
  ["update icash_operation_rates set costs_micros='{}' where id=$1",retry.rate],
  ["update icash_automation_tickets set owner_preview_retry_after=now()+interval '1 minute' where id=$1",retry.ticket],
  ["update icash_automation_tickets set owner_preview_retry_until=now()-interval '1 second' where id=$1",retry.ticket],
  ['update icash_automation_tickets set owner_preview_deferrals=8 where id=$1',retry.ticket],
 ];
 for(const [sql,arg] of gates)await isolated(async()=>{await q(sql,arg?[arg]:[]);assert.equal(await hint(retry),null,sql);await issue();assert.equal(await v("select state from icash_automation_tickets where id=$1",[retry.ticket]),'held');});
 for(const change of [
  "update icash_automation_tickets set owner_preview_screening_hash=repeat('0',64) where id=$1",
  "insert into icash_cost_observations(provider,event_key,source_ref,amount,units) select 'dealmachine','owners:'||account_id||':'||screening_id||':original','SYNTHETIC unknown receipt',null,'credits' from icash_automation_tickets where id=$1",
  "insert into icash_owner_enrichment_recoveries(operation_key,ticket_id,account_id,screening_id,expected_ticket_hash,expected_screening_hash,reviewed_source,reviewed_source_hash,code_stage,approved_max_charge_cents) select 'owners:'||account_id||':'||screening_id,id,account_id,screening_id,repeat('a',64),owner_preview_screening_hash,'SYNTHETIC original approval',repeat('b',64),'owner_preview_pre_provider_local_rate_limit_v1',100 from icash_automation_tickets where id=$1",
 ])await isolated(async()=>{
  await q(change,[retry.ticket]);assert.ok(await hint(retry),'A stale cheap hint is not authorization');
  await q("update icash_screening_jobs set result='{}' where id=$1",[retry.fresh]);
  assert.equal(await candidate(retry),null,'Original full source/receipt/approval proof still rejects');
  await issue();assert.equal(await v("select state from icash_automation_tickets where id=$1",[retry.ticket]),'held');
 });
 await isolated(async()=>{
  await pg.exec("update fixture_cleanup_policy set export_capacity='export_busy'");assert.equal(await issue(),null);
  assert.equal(await v('select count(*)::int from fixture_priority_reads'),5,'Original account scan cap stays five even when capacity is busy');
 });
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'public.icash_owner_retry_due_at(uuid)','execute')",[role]),false);
 await pg.exec('set role service_role');assert.ok(await hint(retry));await pg.exec('reset role');
 assert.deepEqual(await evidence(retry),before);
 for(const table of ['icash_operation_spend','icash_credit_reservations','icash_cost_manifests','icash_credit_ledger'])assert.equal(await v('select count(*)::int from '+table),0,table);
 const paths=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(x=>x.endsWith('_owner_retry_fair_priority.sql'));assert.equal(paths.length,1);assert.equal(migration,read('supabase/migrations/'+paths[0]));
 console.log('PASS due held retry priority: exact ORDER BY-only changes, saved lists and ordinary aging preserved, valid retry beyond 512 stale hints, same finite deadline/token/cap/receipt/financial gates, five-account scan. Offline only.');
}finally{await pg.close();}
