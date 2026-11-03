import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setupIndexingFixture,read} from './fixtures/owner-preflight-indexing-setup.mjs';
const pg=new PGlite(),q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const before=JSON.parse(read('tests/fixtures/new-user-reserve-scheduling-before.json'));
const names=['icash_owner_active_export_capacity()','icash_outbound_search_due(uuid)','icash_enrichment_candidate(uuid)',
 'icash_next_acquisition()','icash_resume_prospecting_ticket()','icash_owner_preflight_due_at(uuid,uuid)',
 'icash_claim_owner_preflight(uuid,jsonb,jsonb)','icash_research_private.owner_preflight_quota_resume(uuid,jsonb,jsonb)',
 'icash_claim_owner_preflight_cleanup(uuid)'];
const seed=(n,waiting=false,age='2 minutes')=>v('select fixture_preflight_seed($1,$2,$3::interval)',[n,waiting,age]);
async function isolated(fn){await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}}
try{
 await setupIndexingFixture(pg);
 await pg.exec(read('config/owner-preflight-list-indexing.sql'));
 await pg.exec(`
 alter table icash_research_private.owner_export_settings add column preflight_quota_recovery_enabled boolean default false;
 alter table icash_research_private.owner_exports add column if not exists terminal_at timestamptz,add column if not exists capacity_review_id uuid;
 create table icash_research_private.owner_preflight_quota_deferrals(request_id uuid,preflight_id uuid,lease uuid,step text,started_at timestamptz,receipts_hash text,created_at timestamptz default now());
 create table icash_research_private.requests(admitted boolean,operation_key text,created_at timestamptz);
 alter table public.icash_automation_tickets add column prospecting_quote_cents bigint;
 alter table public.icash_operational_contacts add column id uuid,add column channel text,add column timezone_basis text;
 create table public.icash_voice_contact_targets(id uuid,account_id uuid,eligibility_source text,revoked_at timestamptz,permission_until timestamptz,timezone text);
 create table public.fixture_reserve_accounts(account_id uuid primary key);
 create function public.icash_new_user_request_reserve_eligible(uuid) returns boolean language sql stable as $$
  select exists(select 1 from public.fixture_reserve_accounts r join public.icash_accounts a on a.id=r.account_id
   join public.icash_wallets w on w.account_id=a.id where a.id=$1 and not a.bot_paused
    and w.balance_cents>w.reserved_cents and public.icash_membership_work_allowed(a.id))$$;
 create function public.icash_dealmachine_capacity_available(integer,uuid) returns boolean language sql stable as $$
  select (select quota from public.fixture_cleanup_policy) or public.icash_new_user_request_reserve_eligible($2)$$;
 create function public.icash_search_due_before_provider_quota(uuid) returns boolean language sql stable as $$select true$$;
 create or replace function public.icash_owner_active_export_enabled() returns boolean language sql stable as $$select true$$;
 create function public.icash_owner_retry_due_at(uuid) returns timestamptz language sql stable as $$select null::timestamptz$$;
 create function public.icash_wake_funded_outreach(uuid) returns void language sql as $$select null::void$$;
 create function public.icash_outreach_window_open(text,text,timestamptz) returns boolean language sql stable as $$select true$$;
 create function public.icash_owner_demo_call_current(uuid,uuid) returns boolean language sql stable as $$select false$$;
 `);
 for(const name of names)await pg.exec(before.find(x=>x.signature===name).definition);
 await pg.exec('revoke all on all functions in schema public from public,anon,authenticated;grant execute on all functions in schema public to service_role;');
 for(const row of before.filter(x=>names.includes(x.signature)))assert.equal(await v('select md5(pg_get_functiondef($1::regprocedure))',[row.signature]),row.hash,row.signature);
 const ordinary=[];for(let i=1;i<=30;i++)ordinary.push(await seed(i));
 const starter=await seed(1000);await q('insert into fixture_reserve_accounts values($1)',[starter.account]);
 await pg.exec('update fixture_cleanup_policy set quota=false');
 assert.equal(await v('select icash_next_acquisition()'),null,'Reproduce global quota rejection before eligible starter account selection');
 assert.equal(await v('select icash_outbound_search_due($1)',[starter.account]),false);
 const wallets=await v('select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w');
 const sql=read('config/new-user-request-reserve-scheduling.sql');await pg.exec(sql);
 assert.equal(await v('select icash_outbound_search_due($1)',[starter.account]),true);
 assert.equal(await v('select icash_outbound_search_due($1)',[ordinary[0].account]),false);
 assert.equal(await v('select icash_owner_active_export_capacity()'),'quota_wait','Unbound export gate cannot borrow starter capacity');
 assert.equal(await v('select icash_owner_active_export_capacity($1)',[starter.account]),'ready');
 assert.equal(await v('select icash_owner_active_export_capacity($1)',[ordinary[0].account]),'quota_wait');
 await isolated(async()=>{
  assert.ok(await v('select icash_next_acquisition()'));
  assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),starter.account,'Thirty ordinary accounts cannot hide protected work before LIMIT');
  assert.equal(await v('select count(*)::int from fixture_priority_reads'),1,'Only the admitted account runs expensive opportunity work');
 });
 await isolated(async()=>{
  await pg.exec('update fixture_cleanup_policy set quota=true');
  assert.ok(await v('select icash_next_acquisition()'));
  assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),starter.account,'Newly funded account is prioritized while ordinary capacity remains');
 });
 await isolated(async()=>{
  await pg.exec('update fixture_cleanup_policy set quota=true');
  await q("update icash_discovery_configs set next_run_at=now()-interval '11 minutes' where account_id=$1",[ordinary[0].account]);
  assert.ok(await v('select icash_next_acquisition()'));
  assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),ordinary[0].account,'Existing ten-minute aging escape remains');
 });
 for(const mutation of [
  'update icash_accounts set bot_paused=true where id=$1',
  'update icash_wallets set reserved_cents=balance_cents where account_id=$1',
  'update icash_discovery_configs set enabled=false where account_id=$1',
  'update icash_discovery_configs set auto_enabled=false where account_id=$1',
  "update icash_discovery_configs set data_rights_until=now()-interval '1 second' where account_id=$1",
 ])await isolated(async()=>{await q(mutation,[starter.account]);assert.equal(await v('select icash_next_acquisition()'),null,mutation);});
 await isolated(async()=>{
  await pg.exec('update fixture_cleanup_policy set member=false');assert.equal(await v('select icash_next_acquisition()'),null);
 });
 await isolated(async()=>{
  await pg.exec("insert into icash_research_private.owner_exports(request) values('{}')");
  assert.equal(await v('select icash_owner_active_export_capacity($1)',[starter.account]),'export_busy','Reserve never skips the unknown-export fence');
  assert.equal(await v('select icash_enrichment_candidate($1)',[starter.account]),null);
 });
 await isolated(async()=>{
  for(const c of ordinary)await q("insert into icash_automation_tickets(account_id,kind,screening_id,state,outcome,expires_at,created_at,prospecting_quote_cents) values($1,'contacts',$2,'held','prospecting_budget_held',now()-interval '1 minute',now()-interval '1 day',105)",[c.account,c.screening]);
  await q("insert into icash_automation_tickets(account_id,kind,screening_id,state,outcome,expires_at,created_at,prospecting_quote_cents) values($1,'contacts',$2,'held','prospecting_budget_held',now()-interval '1 minute',now()-interval '1 hour',105)",[starter.account,starter.screening]);
  assert.ok(await v('select icash_resume_prospecting_ticket()'));
  assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),starter.account,'Resume capacity is account-bound before its twenty-ticket limit');
  assert.equal(await v("select count(*)::int from icash_automation_tickets where state='held'"),30);
 });
 // Exercise the real preflight body, not a replacement: both create and a later
 // count retain all original source/phone/membership gates while using reserve.
 const start=await seed(2000);await q('insert into fixture_reserve_accounts values($1)',[start.account]);
 const snapshot=await v('select snapshot from icash_screening_jobs where id=$1',[start.screening]);
 const items=[{screeningId:start.screening,snapshot,ids:['per_2000']}];
 const request={people_ids:['per_2000'],mobile_only:false,property_match:'owner',anchor:'person',require_phone:true,scrub_dnc:true,active_phones_only:true};
 const claim=await v('select icash_claim_owner_preflight($1,$2,$3)',[start.account,items,request]);
 assert.equal(claim.status,'create','New protected account can create its real bounded free preflight');
 await isolated(async()=>{
  await q('update icash_accounts set bot_paused=true where id=$1',[start.account]);
  assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[start.account,items,request])).status,'held');
 });
 await isolated(async()=>{
  await pg.exec('update fixture_cleanup_policy set people_available=false');
  assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[start.account,items,request])).status,'held');
 });
 await isolated(async()=>{
  await pg.exec('update icash_research_private.owner_export_settings set preflight_quota_recovery_enabled=true');
  await q(`insert into icash_research_private.owner_preflight_quota_deferrals(request_id,preflight_id,lease,step,started_at,receipts_hash,created_at)
   select gen_random_uuid(),id,lease,'create',started_at,md5(receipts::text),now()-interval '1 minute'
   from icash_research_private.owner_export_preflights where id=$1`,[claim.id]);
  const recovered=await v('select icash_research_private.owner_preflight_quota_resume($1,$2,$3)',[claim.id,items,request]);
  assert.equal(recovered.status,'create','A proven local preflight denial can resume with account-bound protected capacity');
  assert.equal(recovered.id,claim.id);assert.notEqual(recovered.lease,claim.lease);
  assert.deepEqual(await v('select receipts from icash_research_private.owner_export_preflights where id=$1',[claim.id]),{},'No provider evidence is invented during local denial recovery');
 });
 const waiting=await seed(3000,true);await q('insert into fixture_reserve_accounts values($1)',[waiting.account]);
 assert.ok(await v('select icash_owner_preflight_due_at($1,$2)',[waiting.account,waiting.screening]),'Existing exact due preflight is visible in protected capacity');
 const waitItems=await v('select items from icash_research_private.owner_export_preflights where id=$1',[waiting.preflight]);
 const waitRequest=await v('select request from icash_research_private.owner_export_preflights where id=$1',[waiting.preflight]);
 await isolated(async()=>{
  assert.equal((await v('select icash_claim_owner_preflight($1,$2,$3)',[waiting.account,waitItems,waitRequest])).status,'check','Delayed real count can finish in reserve');
 });
 // Existing cleanup chooses by bound account before LIMIT and returns that
 // account for the service's final atomic request admission.
 await isolated(async()=>{
  await q("update icash_research_private.owner_export_preflights set state='ready',checked_at=now() where id=$1",[waiting.preflight]);
  const cleanup=await v('select icash_claim_owner_preflight_cleanup(null)');
  assert.equal(cleanup.id,waiting.preflight);assert.equal(cleanup.accountId,waiting.account);
 });
 assert.deepEqual(await v('select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w where account_id not in ($1,$2)',[start.account,waiting.account]),wallets,'Scheduling never changes funded balances');
 assert.equal(await v('select count(*)::int from icash_operation_spend'),0,'No provider purchase is synthesized');
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'public.icash_owner_active_export_capacity(uuid)','execute')",[role]),role==='service_role');
 // Integrate the real atomic limiter and funding eligibility with the exact
 // scheduler bodies. Earlier cases isolate scheduling; this boundary uses no
 // capacity or starter-eligibility stand-ins.
 const part=(file,start,end)=>{const source=read(file),a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a);return source.slice(a,b);};
 const bridge='supabase/migrations/20260928221806_discovery_screening_bridge.sql';
 await pg.exec(part(bridge,'create table public.icash_dealmachine_request_budget','insert into public.icash_dealmachine_request_budget'));
 await pg.exec(`insert into icash_dealmachine_request_budget(id) values(1);
  alter table icash_dealmachine_request_budget drop constraint icash_dealmachine_request_budget_day_limit_check;
  update icash_dealmachine_request_budget set minute_limit=60,day_limit=9800,day_start=now()-interval '10 hours',day_used=8820;
  alter table icash_research_private.requests add column id uuid primary key,add column kind text,add column account_id uuid,
   add column finished_at timestamptz,add column result jsonb;
  alter table icash_research_private.requests alter column created_at set default now();
  create table public.icash_funding_orders(id uuid primary key default gen_random_uuid(),account_id uuid,mode text,state text,credited_at timestamptz);
  create table public.icash_support_cancel_requests(account_id uuid,confirmed_at timestamptz);
  create table public.icash_control_events(id uuid primary key default gen_random_uuid(),account_id uuid,property_id text,action text,created_at timestamptz default now());
  update public.icash_accounts set workspace_ack_version='fixture';
  drop function public.icash_new_user_request_reserve_eligible(uuid);
  drop function public.icash_dealmachine_capacity_available(integer,uuid);`);
 await pg.exec(part(bridge,'create function public.icash_take_dealmachine_request()','create function public.icash_save_discovery'));
 await pg.exec(part('config/research-request-efficiency.sql','create function public.icash_take_dealmachine_request(p_kind','create table icash_research_private.exclusions'));
 await pg.exec(part('config/provider-quota-scheduling.sql','create function public.icash_dealmachine_capacity_available','alter function public.icash_outbound_search_due').replace('create function','create or replace function'));
 await pg.exec(read('config/research-provider-feedback.sql'));
 await pg.exec(read('config/new-user-request-reserve.sql'));
 await pg.exec(`update icash_research_private.request_reserve_policy set enabled=true;
  insert into public.icash_funding_orders(account_id,mode,state,credited_at)
   select id,'live','paid',now()-interval '2 days' from public.icash_accounts;`);
 await q("update icash_funding_orders set credited_at=now()-interval '1 hour' where account_id=$1",[starter.account]);
 assert.equal(await v('select icash_dealmachine_capacity_available(2)'),false);
 assert.equal(await v('select icash_dealmachine_capacity_available(2,$1)',[starter.account]),true);
 await isolated(async()=>{
  assert.ok(await v('select icash_next_acquisition()'));
  assert.equal(await v("select account_id from icash_automation_tickets where state='issued'"),starter.account,'Actual funding+reserve helpers admit the new account at 8,820 used');
  assert.equal(await v('select icash_take_dealmachine_request($1,$2,$3,gen_random_uuid())',['search_estimate',ordinary[0].account,'fixture:ordinary']),false);
  assert.equal(await v('select icash_take_dealmachine_request($1,$2,$3,gen_random_uuid())',['search_estimate',starter.account,'fixture:starter']),true);
  assert.equal(await v('select day_used from icash_dealmachine_request_budget'),8821);
 });
 for(const mutation of [
  "update icash_research_private.quota_feedback set blocked_until=now()+interval '1 minute'",
  'update icash_dealmachine_request_budget set minute_used=60',
  'update icash_dealmachine_request_budget set day_used=9800',
  "update icash_funding_orders set credited_at=now()-interval '2 days'",
 ])await isolated(async()=>{await pg.exec(mutation);assert.equal(await v('select icash_next_acquisition()'),null,mutation);});
 await assert.rejects(pg.exec(sql),/New-user search scheduling prerequisite changed/);await pg.exec('rollback');
 console.log('PASS account-bound starter scheduling: shared-pool exhaustion reproduced; before-LIMIT acquisition/resume selection, starter priority with old-account aging, actual preflight create/count/cleanup and original customer/export/financial gates preserved.');
}finally{await pg.close();}
