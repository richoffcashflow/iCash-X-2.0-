import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),pg=new PGlite();
const q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const before=JSON.parse(read('tests/fixtures/owner-preflight-priority-before.json'));
const live=JSON.parse(read('tests/fixtures/owner-preflight-ready-before.json'));
const cohort=c=>v('select icash_research_private.owner_preflight_cohort($1,$2)',[c.account,c.screening]);
const batch=c=>v('select icash_owner_batch_candidates($1,$2)',[c.account,c.screening]);
const due=c=>v('select icash_owner_preflight_due_at($1,$2)',[c.account,c.screening]);
const current=c=>v('select icash_research_private.owner_preflight_ready_current($1)',[c.preflight]);
const candidate=c=>v('select icash_enrichment_before_prospecting_budget($1)',[c.account]);
const claim=c=>v('select icash_claim_owner_preflight($1,$2,$3)',[c.account,c.items,c.request]);
const admit=(c,preview=c.preview,request=c.request)=>v('select icash_admit_owner_active_export($1,$2,gen_random_uuid(),$3,$4,$5,$6)',[c.account,c.screening,c.items,preview,{},request]);
const evidence=c=>v(`select jsonb_build_object('ticket',to_jsonb(t),'preflight',to_jsonb(p)) from icash_automation_tickets t,icash_research_private.owner_export_preflights p where t.id=$1 and p.id=$2`,[c.ticket,c.preflight]);
async function isolated(test){await pg.exec('begin');try{await test();}finally{await pg.exec('rollback');}}
async function historical(c,changes){
 await pg.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable');
 await q('update icash_research_private.owner_export_preflights set '+changes+' where id=$1',[c.preflight]);
 await pg.exec('alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable');
}
try{
 await pg.exec(read('tests/fixtures/opportunity-schema.sql'));await pg.exec(read('tests/fixtures/owner-cleanup-ticket-recovery-native.sql'));
 let src=read('config/owner-enrichment-deferral.sql');await pg.exec(src.slice(0,src.indexOf('create function public.icash_defer_owner_enrichment'))+'commit;');
 src=read('config/owner-export-preflight.sql');await pg.exec(src.slice(0,src.indexOf('create function public.icash_claim_owner_preflight'))+'commit;');
 src=read('config/owner-preflight-renewal.sql');await pg.exec(src.slice(0,src.indexOf('create function icash_research_private.guard_owner_preflight_generation'))+'commit;');
 await pg.exec(read('tests/fixtures/owner-preflight-priority-foundation.sql'));
 for(const name of ['icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)',
  'public.icash_enrichment_before_prospecting_budget(uuid)','public.icash_enrichment_before_provider_quota(uuid)','public.icash_enrichment_candidate(uuid)','public.icash_next_acquisition()'])await pg.exec(before[name]);
 await pg.exec(read('config/owner-preflight-priority.sql'));
 await pg.exec(read('tests/fixtures/owner-preflight-ready-foundation.sql'));
 for(const name of ['public.icash_owner_batch_candidates(uuid,uuid)','public.icash_claim_owner_preflight(uuid,jsonb,jsonb)','public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'])await pg.exec(live[name].definition);
 for(const [name,{hash}] of Object.entries(live))assert.equal(await v('select md5(pg_get_functiondef($1::regprocedure))',[name]),hash,'Actual installed baseline: '+name);
 await pg.exec(`update icash_research_private.owner_export_settings set preflight_enabled=true;
  revoke all on function icash_research_private.owner_preflight_cohort(uuid,uuid) from public,anon,authenticated,service_role;
  grant select,insert,update on all tables in schema public to service_role;
  grant usage on schema icash_private to service_role;grant select on all tables in schema icash_private to service_role;`);
 const c=await v('select fixture_ready_seed(8000)'),saved=await evidence(c);
 assert.equal(await cohort(c),null);assert.equal((await batch(c)).length,5,'Reproduce valid original four-property receipt replaced by a five-property batch');
 assert.equal(await candidate(c),c.fresh);assert.equal(await due(c),null);
 assert.equal((await claim(c)).status,'ready','Actual claim still accepts checked_at+30m despite created_at+30m expiry');
 assert.equal(await admit(c),'fixture_paid_boundary','Actual paid admission accepts the original exact positive check');
 await pg.exec('truncate fixture_ready_admissions');
 const migration=read('config/owner-preflight-ready-continuity.sql');assert.equal(migration,read('supabase/migrations/20261103003917_owner_preflight_ready_continuity.sql'));await pg.exec(migration);
 assert.equal(await current(c),true);assert.deepEqual(await cohort(c),c.items);
 assert.deepEqual((await batch(c)).map(i=>i.screeningId).sort(),c.items.map(i=>i.screeningId).sort());
 assert.equal(await candidate(c),c.screening);assert.ok(await due(c));assert.deepEqual(await evidence(c),saved);
 assert.equal(await v('select icash_owner_preflight_sibling_waiting($1,$2,$3,$2)',[c.account,c.items[1].screeningId,c.items[1].snapshot]),true);
 assert.deepEqual(await v('select icash_owner_batch_candidates($1,$2)',[c.account,c.items[1].screeningId]),[],'Original siblings cannot open another cohort while the positive check remains valid');
 assert.equal((await claim(c)).status,'ready');assert.equal(await admit(c),'fixture_paid_boundary');
 await isolated(async()=>{
  const changed=structuredClone(c.preview);changed.data[0].contacts[0].is_likely_owner=false;
  assert.equal(await admit(c,changed),'held','Current owner preview is still mandatory');
  assert.equal(await admit(c,c.preview,{...c.request,active_phones_only:false}),'held','Saved positive counts cannot weaken active phone or DNC contract');
  assert.equal(await admit(c,c.preview,{...c.request,scrub_dnc:false}),'held');
 });
 for(let n=1;n<=129;n++)await v("select fixture_preflight_seed($1,false,interval '6 minutes')",[n]);
 await isolated(async()=>{
  await v('select icash_next_acquisition()');assert.equal(await v("select screening_id from icash_automation_tickets where state='issued'"),c.screening);
  const after=await evidence(c);assert.deepEqual(after.preflight,saved.preflight);
  for(const field of ['owner_preview_retry_after','owner_preview_retry_until','owner_preview_deferrals','owner_preview_screening_hash','issue_attempts'])assert.equal(after.ticket[field],saved.ticket[field]);
 });
 await isolated(async()=>{
  const older=await v("select fixture_preflight_seed(9000,false,interval '11 minutes')");await v('select icash_next_acquisition()');
  assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),older.account,'Ordinary ten-minute aging still wins');
 });
 for(const age of ["interval '30 minutes'","interval '31 minutes'"]){await isolated(async()=>{
  await historical(c,'checked_at=now()-'+age);assert.equal(await current(c),false);assert.equal(await cohort(c),null);assert.equal(await due(c),null);
  assert.equal((await claim(c)).status,'held');assert.equal(await admit(c),'held','No extension past original paid admission expiry');
 });}
 for(const changes of ["checked_at=null","checked_at=now()+interval '1 minute'","state='empty'","state='held'",
  "receipts=receipts-'baseline'","receipts=jsonb_set(receipts,'{eligible,httpStatus}','500')",
  "receipts=jsonb_set(receipts,'{eligible,rawText}','\"malformed\"')",
  "receipts=jsonb_set(receipts,'{eligible,raw,total_people}','0')",
  "receipts=jsonb_set(receipts,'{baseline,raw,total_people}','3')",
  "receipts=jsonb_set(receipts,'{eligible,raw,credits,used}','1')",
  "list_id='null'::jsonb"]){await isolated(async()=>{
  await historical(c,changes);assert.equal(await current(c),false,changes);assert.equal(await due(c),null,changes);assert.equal(await cohort(c),null,changes);
 });}
 const controls=[
  ['update icash_accounts set bot_paused=true where id=$1',c.account],['update fixture_cleanup_policy set member=false'],
  ['update fixture_cleanup_policy set mobile=true'],['update fixture_cleanup_policy set people_available=false'],
  ['update fixture_cleanup_policy set check_quota=false'],['update icash_wallets set reserved_cents=balance_cents where account_id=$1',c.account],
  ['update icash_operation_rates set charge_cents=10001 where id=$1',c.rate],['update icash_operation_rates set enabled=false where id=$1',c.rate],
  ["update icash_screening_jobs set snapshot=snapshot||'{\"propertyId\":\"prop_9999999\"}' where id=$1",c.items[1].screeningId],
  ["update icash_automation_tickets set owner_preview_deferrals=8 where id=$1",c.ticket],
  ["update icash_automation_tickets set owner_preview_retry_after=now()+interval '1 minute' where id=$1",c.ticket],
  ["insert into icash_property_controls(account_id,property_id,manual) values($1,'prop_8000',true)",c.account],
  ["insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('other','owners:'||$1||':original','unknown original',null,'credits')",c.account+':'+c.screening],
 ];
 for(const [sql,arg] of controls)await isolated(async()=>{await q(sql,arg?[arg]:[]);assert.equal(await due(c),null,sql);});
 await isolated(async()=>{
  await q(`insert into icash_owner_enrichment_recoveries(operation_key,ticket_id,account_id,screening_id,expected_ticket_hash,expected_screening_hash,reviewed_source,reviewed_source_hash,code_stage,approved_max_charge_cents)
   select 'owners:'||account_id||':'||screening_id,id,account_id,screening_id,repeat('a',64),owner_preview_screening_hash,'SYNTHETIC original review',repeat('b',64),'owner_preview_pre_provider_local_rate_limit_v1',100 from icash_automation_tickets where id=$1`,[c.ticket]);assert.equal(await due(c),null,'Immutable approval cap still applies');
 });
 await isolated(async()=>{await pg.exec("update fixture_cleanup_policy set export_capacity='export_busy'");assert.equal(await v('select icash_next_acquisition()'),null);});
 const waiting=await v('select fixture_preflight_seed(9500)');assert.ok(await due(waiting));
 await isolated(async()=>{await historical(waiting,"created_at=now()-interval '30 minutes'");assert.equal(await cohort(waiting),null);assert.equal(await due(waiting),null,'Waiting lifetime remains creation+30m');});
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'icash_research_private.owner_preflight_ready_current(uuid)','execute')",[role]),false);
 assert.equal(await v("select has_schema_privilege('service_role','icash_research_private','usage')"),false);
 await pg.exec('set role service_role');assert.ok(await due(c));assert.equal(await candidate(c),c.screening);assert.equal((await batch(c)).length,4);await pg.exec('reset role');
 assert.deepEqual(await evidence(c),saved);assert.equal(await v('select count(*)::int from icash_operation_spend'),0);assert.equal(await v('select count(*)::int from icash_credit_reservations'),0);
 console.log('PASS ready-preflight continuity: actual creation/check TTL mismatch reproduced, original four-property cohort retained through exact paid-admission expiry, due READY priority, fresh preview/active/DNC contract, source/funds/Pause/cap/unknown guards and unchanged waiting window. No provider or paid work.');
}finally{await pg.close();}
