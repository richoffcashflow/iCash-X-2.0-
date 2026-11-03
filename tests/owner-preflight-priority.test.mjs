import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=new PGlite(),q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const definitions=JSON.parse(read('tests/fixtures/owner-preflight-priority-before.json'));
const migration=read('config/owner-preflight-priority.sql');
const seed=(n,waiting=true,overdue='2 minutes')=>v('select fixture_preflight_seed($1,$2,$3::interval)',[n,waiting,overdue]);
const due=c=>v('select icash_owner_preflight_due_at($1,$2)',[c.account,c.screening]);
const candidate=c=>v('select icash_enrichment_before_prospecting_budget($1)',[c.account]);
const evidence=c=>v(`select jsonb_build_object('ticket',to_jsonb(t),'preflight',to_jsonb(p))
 from icash_automation_tickets t,icash_research_private.owner_export_preflights p where t.id=$1 and p.id=$2`,[c.ticket,c.preflight]);
async function isolated(test){await pg.exec('begin');try{await test();}finally{await pg.exec('rollback');}}
try{
 await pg.exec(read('tests/fixtures/opportunity-schema.sql'));
 await pg.exec(read('tests/fixtures/owner-cleanup-ticket-recovery-native.sql'));
 let source=read('config/owner-enrichment-deferral.sql');
 await pg.exec(source.slice(0,source.indexOf('create function public.icash_defer_owner_enrichment'))+'commit;');
 source=read('config/owner-export-preflight.sql');
 await pg.exec(source.slice(0,source.indexOf('create function public.icash_claim_owner_preflight'))+'commit;');
 await pg.exec(read('tests/fixtures/owner-preflight-priority-foundation.sql'));
 for(const name of ['icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)',
  'public.icash_enrichment_before_prospecting_budget(uuid)','public.icash_enrichment_before_provider_quota(uuid)','public.icash_enrichment_candidate(uuid)','public.icash_next_acquisition()'])await pg.exec(definitions[name]);
 await pg.exec(`update icash_research_private.owner_export_settings set preflight_enabled=true;
  revoke all on function icash_next_acquisition(),icash_enrichment_before_prospecting_budget(uuid),icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid) from public;
  grant execute on function icash_next_acquisition(),icash_enrichment_before_prospecting_budget(uuid),icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid) to service_role;
  revoke all on function icash_research_private.owner_preflight_cohort(uuid,uuid) from public,service_role;
  grant select,insert,update on all tables in schema public to service_role;
  grant usage on schema icash_private to service_role;grant select on all tables in schema icash_private to service_role;`);
 const waiting=await seed(1000);
 for(let n=1;n<=129;n++)await seed(n,false,'6 minutes');
 assert.equal(await candidate(waiting),waiting.fresh,'Reproduce newer high-score work displacing the existing due list');
 await isolated(async()=>{
  await v('select icash_next_acquisition()');
  assert.notEqual(await v("select account_id from icash_automation_tickets where state='issued'"),waiting.account,'Reproduce the due-list account ranking behind 129 ordinary overdue accounts');
 });
 assert.equal(migration,read('supabase/migrations/20261103002127_owner_preflight_priority.sql'));
 await pg.exec(migration);
 const saved=await evidence(waiting);
 assert.ok(await due(waiting));assert.equal(await candidate(waiting),waiting.screening);
 assert.deepEqual(await evidence(waiting),saved,'Priority reads preserve the token, deadlines, counters and original receipts');
 await isolated(async()=>{
  await v('select icash_next_acquisition()');
  const issued=(await q("select to_jsonb(t) value from icash_automation_tickets t where state='issued'")).rows.map(x=>x.value);
  assert.equal(issued.length,1);assert.equal(issued[0].screening_id,waiting.screening,'Both ranking levels choose the original due list through 130 accounts');
  for(const key of ['owner_preview_retry_after','owner_preview_retry_until','owner_preview_deferrals','owner_preview_screening_hash','issue_attempts'])assert.equal(issued[0][key],saved.ticket[key]);
  assert.notEqual(issued[0].token,saved.ticket.token,'Only the original issuer rotates the one-use capability');
  assert.deepEqual((await evidence(waiting)).preflight,saved.preflight);
  assert.equal(await v('select count(*)::int from fixture_priority_reads'),1,'The chosen due account does not scan 129 full candidate queries');
 });
 // Fresh work has an explicit aging escape; once served its normal wake time
 // yields to the existing list. No additional tickets are issued per call.
 await isolated(async()=>{
  const old=await seed(2000,false,'11 minutes');
  await v('select icash_next_acquisition()');
  assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),old.account);
  await v('select icash_next_acquisition()');
  assert.equal(await v("select count(*)::int from icash_automation_tickets where state='issued' and screening_id=$1",[waiting.screening]),1,'An overdue fresh account yields after its one normal turn');
 });
 const changes=[
  ["update icash_accounts set bot_paused=true where id=$1",waiting.account],
  ['update fixture_cleanup_policy set member=false'],
  ['update fixture_cleanup_policy set mobile=true'],
  ['update fixture_cleanup_policy set people_available=false'],
  ['update fixture_cleanup_policy set check_quota=false'],
  ['update icash_operating_budget set enabled=false'],
  ["update icash_wallets set reserved_cents=balance_cents where account_id=$1",waiting.account],
  ["update icash_discovery_configs set auto_enabled=false where account_id=$1",waiting.account],
  ["update icash_discovery_configs set contacts_enabled=false where account_id=$1",waiting.account],
  ["update icash_discovery_configs set data_rights_until=now()-interval '1 second' where account_id=$1",waiting.account],
  ["update icash_operation_rates set enabled=false where id=$1",waiting.rate],
  ["update icash_operation_rates set expires_at=now()-interval '1 second' where id=$1",waiting.rate],
  ["update icash_operation_rates set charge_cents=10001 where id=$1",waiting.rate],
  ["update icash_screening_jobs set snapshot=snapshot||'{\"propertyId\":\"prop_999999\"}' where id=$1",waiting.screening],
  ["update icash_screening_jobs set result=result||'{\"changed\":true}' where id=$1",waiting.screening],
  ["update icash_automation_tickets set owner_preview_retry_after=now()+interval '1 minute' where id=$1",waiting.ticket],
  ["update icash_automation_tickets set owner_preview_retry_until=now()-interval '1 second' where id=$1",waiting.ticket],
  ["update icash_automation_tickets set owner_preview_deferrals=8 where id=$1",waiting.ticket],
  ["update icash_automation_tickets set outcome='held' where id=$1",waiting.ticket],
  ["update icash_research_private.owner_export_preflights set next_check_at=now()+interval '1 minute' where id=$1",waiting.preflight],
  ["update icash_research_private.owner_export_preflights set cleanup_attempts=1 where id=$1",waiting.preflight],
  ["update icash_research_private.owner_export_preflights set deleted_at=now() where id=$1",waiting.preflight],
  ["update icash_research_private.owner_export_preflights set state='checking' where id=$1",waiting.preflight],
  ["insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_1000',true)",waiting.account],
  ["insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('other','owners:'||$1||':original','unknown receipt',null,'credits')",waiting.account+':'+waiting.screening],
 ];
 for(const [sql,arg] of changes)await isolated(async()=>{await q(sql,arg?[arg]:[]);assert.equal(await due(waiting),null,sql);});
 await isolated(async()=>{
  const prior=await v(`insert into icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at)
   select account_id,'synthetic-same-property-operation',snapshot,state,result,completed_at from icash_screening_jobs where id=$1 returning id`,[waiting.screening]);
  await q(`insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until)
   values('owners:'||$1||':'||$2,$1::uuid,$3::uuid,gen_random_uuid(),105,250000,now()+interval '1 day')`,[waiting.account,prior,waiting.rate]);
  assert.equal(await due(waiting),null,'A started operation on another screening of the same property cannot gain due-list priority');
  assert.equal(await candidate(waiting),waiting.fresh,'Independent work remains eligible while the original property stays fenced');
 });
 await isolated(async()=>{
  await q(`insert into icash_owner_enrichment_recoveries(operation_key,ticket_id,account_id,screening_id,expected_ticket_hash,expected_screening_hash,reviewed_source,reviewed_source_hash,code_stage,approved_max_charge_cents)
   select 'owners:'||account_id||':'||screening_id,id,account_id,screening_id,repeat('a',64),owner_preview_screening_hash,'SYNTHETIC original review',repeat('b',64),'owner_preview_pre_provider_local_rate_limit_v1',100
   from icash_automation_tickets where id=$1`,[waiting.ticket]);
  assert.equal(await due(waiting),null,'Immutable historical approval cap still limits priority eligibility');
 });
 for(const state of ['ready','empty','held'])await isolated(async()=>{
  await q('update icash_research_private.owner_export_preflights set state=$1 where id=$2',[state,waiting.preflight]);
  assert.equal(await due(waiting),null);assert.equal(await candidate(waiting),waiting.fresh,'Terminal free checks restore original opportunity ranking');
 });
 // Corrupt/expired original fixtures are inserted, never mutated through the
 // immutable production receipt trigger. They receive no new priority.
 for(const [field,value] of [['created_at',"now()-interval '31 minutes'"],['receipts',"'{}'::jsonb"],['list_id',"'\"different-list\"'::jsonb"],['list_id',"'null'::jsonb"]])await isolated(async()=>{
  await pg.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
  await q(`update icash_research_private.owner_export_preflights set ${field}=${value} where id=$1`,[waiting.preflight]);
  if(field==='list_id'&&value==="'null'::jsonb")await q("update icash_research_private.owner_export_preflights set receipts=jsonb_set(receipts,'{create,raw,data,list_id}','null') where id=$1",[waiting.preflight]);
  await pg.exec('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable');
  assert.equal(await due(waiting),null,field);
 });
 await isolated(async()=>{
  await pg.exec("update fixture_cleanup_policy set export_capacity='export_busy'");
  assert.equal(await v('select icash_next_acquisition()'),null,'Existing export-capacity gate remains authoritative');
  assert.equal(await v("select count(*)::int from icash_automation_tickets where state='issued'"),0);
  assert.equal(await v('select count(*)::int from fixture_priority_reads'),5,'Busy export retains the bounded ordinary scan');
 });
 await isolated(async()=>{
  await pg.exec('update fixture_cleanup_policy set quota=false');assert.equal(await v('select icash_next_acquisition()'),null);
  assert.equal(await v('select count(*)::int from fixture_priority_reads'),0,'Shared quota blocks before candidate ranking');
 });
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'public.icash_owner_preflight_due_at(uuid,uuid)','execute')",[role]),role==='service_role');
 assert.equal(await v("select has_schema_privilege('service_role','icash_research_private','usage')"),false);
 await pg.exec('set role service_role');assert.ok(await due(waiting));assert.equal(await candidate(waiting),waiting.screening);await pg.exec('reset role');
 assert.deepEqual(await evidence(waiting),saved);
 assert.equal(await v('select count(*)::int from icash_operation_spend'),0);
 assert.equal(await v('select count(*)::int from icash_credit_reservations'),0);
 await assert.rejects(pg.exec(migration),/already exists/);await pg.exec('rollback');
 console.log('PASS due owner preflight priority: 130-account and within-account starvation reproduced; original exact cohort/current source and financial guards, 10-minute fresh-account aging, capacity/quota, immutable evidence and private ACLs retained.');
}finally{await pg.close();}
