// SYNTHETIC PostgreSQL only. No provider/network calls. PGlite serializes queued
// requests: multi-worker idempotency is tested, not real multi-session lock races.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args);
const one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),other=id(2),rate=id(3),screen=id(4),ticket=id(5),op=`owners:${account}:${screen}`;
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
const rejected=async(action,pattern)=>{await pg.exec('savepoint expected_error');try{await assert.rejects(action(),pattern);}finally{await pg.exec('rollback to expected_error');await pg.exec('release expected_error');}};
const originalToken='00000000-0000-4000-8000-000000000000'.repeat(2);
try{
 await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 await pg.exec(read('tests/fixtures/opportunity-schema.sql'));
 await pg.exec(`create schema icash_private;create table icash_private.provider_costs(operation_key text);
 create table icash_operational_contacts(account_id uuid,screening_id uuid);
 create table icash_contact_permissions(account_id uuid,screening_id uuid);
 create table fixture_policy(member boolean not null);insert into fixture_policy values(true);
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select member from public.fixture_policy$$;
 create function icash_vip_active(uuid) returns boolean language sql as $$select false$$;
 create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_reception_credit_bound(uuid,text,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_general_reception_pause_exempt(uuid,text,bigint) returns boolean language sql as $$select false$$;
 create function icash_customer_text_operation(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_limited_seller_voice(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select false$$;
 create function icash_meta_voice_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_seller_lead_rate_multiplier(uuid,text,uuid) returns numeric language sql as $$select 2::numeric$$;
 create function icash_research_state_allowed(text) returns boolean language sql as $$select $1='TX'$$;
 create function icash_research_zip_known(text) returns boolean language sql as $$select $1='75217'$$;
 create function icash_credit_acquisition_allowed(uuid) returns boolean language sql as $$select true$$;
 create function icash_seller_acquisition_quote(uuid) returns jsonb language sql as $$select null::jsonb$$;
 create function icash_seller_assignment_due(integer,timestamptz,timestamptz) returns timestamptz language sql as $$select now()$$;
 create function icash_next_automation() returns jsonb language sql as $$select null::jsonb$$;
 create table icash_voice_contact_targets(id uuid primary key,account_id uuid,screening_id uuid,party text);`);
 await pg.exec(read('tests/fixtures/opportunity-dependencies.sql'));
 await pg.exec(read('supabase/migrations/20261019150042_dealmachine_usage_and_opportunity_engine.sql'));
 await pg.exec(read('config/opportunity-score-bounds.sql'));
 await pg.exec(read('tests/fixtures/prospecting-funding.sql'));
 await pg.exec(read('tests/fixtures/prospecting-flexible-voice.sql'));
 const claim=read('config/customer-funded-margins.sql').split('CREATE OR REPLACE FUNCTION public.icash_claim_operation')[1].split('CREATE OR REPLACE FUNCTION public.icash_launch_checks')[0];
 await pg.exec('CREATE OR REPLACE FUNCTION public.icash_claim_operation'+claim);
 await pg.exec(read('config/owner-enrichment-claim.sql'));
 const automation=read('supabase/migrations/20260928222744_automatic_work_and_contacts.sql');
 await pg.exec(automation.slice(automation.indexOf('create function public.icash_consume_automation'),automation.indexOf('create function public.icash_save_contacts')));
 await q("insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused) values($1,$1,'Fixture',false),($2,$2,'Other fixture',false)",[account,other]);
 await q('insert into icash_wallets(account_id,balance_cents) values($1,10000),($2,10000)',[account,other]);
 await pg.exec("insert into icash_operating_budget(id,enabled,require_company_reserve,standard_cost_multiplier,elevenlabs_cost_multiplier) values(1,true,false,2,2);insert into icash_data_cost_settings(provider,credit_micros,cost_basis,source_ref) values('dealmachine',10000,'estimated','SYNTHETIC allocation');insert into icash_acquisition_policy(id,mode) values(1,'outbound');");
 const categories=['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'];
 const costs=Object.fromEntries(categories.map(k=>[k,k==='dealmachine'?250000:0]));
 await q("insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled) values($1,'owner_enrichment','SYNTHETIC owner',105,$2,0,'SYNTHETIC cost evidence',now()-interval '1 day',now()+interval '1 day',true)",[rate,costs]);
 await q("insert into icash_discovery_configs(account_id,enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,contacts_enabled,contact_rate_id,contact_credit_cap,exhausted) values($1,true,'75217',$2,10000,now()+interval '1 day',100000,true,$2,25,true)",[account,rate]);
 await pg.exec(read('config/funded-prospecting-budget.sql'));
 await pg.exec(read('config/prospecting-delivery-pacing.sql'));
 await pg.exec(read('config/first-day-prospecting-pacing.sql'));
 await q("insert into icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at) values($1,$2,'SYNTHETIC owner screening',jsonb_build_object('propertyId','prop_123','propertyType','house','fetchedAt',now(),'sellerCostReserveCents',100000,'raw',jsonb_build_object('data',jsonb_build_object('dm_property_id','prop_123','state','TX','zip','75217'))),'complete','{\"financialCheck\":{\"status\":\"eligible\"}}',now())",[screen,account]);
 await q("insert into icash_automation_tickets(id,token,account_id,kind,screening_id,state,issue_attempts) values($1,$2,$3,'contacts',$4,'consumed',3)",[ticket,originalToken,account,screen]);
 const before=await one('select to_jsonb(t) from icash_automation_tickets t where id=$1',[ticket]);
 const sql=read('config/owner-enrichment-deferral.sql');
 assert.equal(sql,read('supabase/migrations/20261020012200_owner_enrichment_deferral.sql'));
 await pg.exec(sql);
 const strip=t=>Object.fromEntries(Object.entries(t).filter(([k])=>!k.startsWith('owner_preview_')));
 assert.deepEqual(strip(await one('select to_jsonb(t) from icash_automation_tickets t where id=$1',[ticket])),before,'Migration never reclassifies historical rows');
 assert.equal(Number(await one('select count(*) from icash_owner_enrichment_recoveries')),0);
 const defer=(args=[ticket,account,screen,originalToken,op])=>one('select icash_defer_owner_enrichment($1,$2,$3,$4,$5)',args);
 const eligible=()=>one('select icash_enrichment_candidate($1)',[account]);
 const due=()=>pg.exec("update icash_automation_tickets set owner_preview_retry_after=now()-interval '1 second';update icash_discovery_configs set next_run_at=now()-interval '1 second'");
 const hashes=async()=>[(await one('select icash_owner_enrichment_ticket_hash(t) from icash_automation_tickets t where id=$1',[ticket])),(await one('select icash_owner_enrichment_screening_hash(s) from icash_screening_jobs s where id=$1',[screen]))];
 const held=()=>q("update icash_automation_tickets set state='held',outcome='held_for_reconciliation',completed_at=now() where id=$1",[ticket]);
 const recoveryArgs=async()=>[ticket,account,screen,op,...await hashes(),'SYNTHETIC reviewed production request fixture','a'.repeat(64),'owner_preview_pre_provider_local_rate_limit_v1',105];
 const recover=args=>one('select icash_recover_owner_enrichment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',args);
 const reserve=(key=op,r=rate)=>one("select icash_reserve_before_fractional($1,$2,$3,(select data_rights_until from icash_discovery_configs where account_id=$1),now(),true)",[account,key,r]);
 const finalClaim=()=>one("select icash_claim_owner_enrichment($1,$2,$3,(select snapshot from icash_screening_jobs where id=$2),$4,25,10000,250000,(select data_rights_until from icash_discovery_configs where account_id=$1))",[account,screen,op,rate]);
 assert.equal(await one('select icash_owner_enrichment_retry_current($1,$2)',[account,screen]),true);
 await isolated(async()=>{
  assert.equal(await defer(),true);const parked=await one('select to_jsonb(t) from icash_automation_tickets t where id=$1',[ticket]);
  assert.equal(parked.outcome,'owner_preview_rate_limited');assert.equal(parked.issue_attempts,3);assert.equal(parked.owner_preview_deferrals,1);
  assert(new Date(parked.owner_preview_retry_after)>new Date(parked.completed_at));
  assert.equal(await eligible(),null,'Backoff is durable');assert.equal(await defer(),false,'Same consumed capability cannot defer twice');
  await one("select icash_finish_automation($1,false,'held_for_reconciliation')",[ticket]);assert.equal(await one('select outcome from icash_automation_tickets where id=$1',[ticket]),'owner_preview_rate_limited','Uncertain deferral response fallback cannot overwrite parked state');
  await due();assert.equal(await eligible(),screen);const work=await one('select icash_next_acquisition()');assert(work?.token);assert.notEqual(work.token,originalToken);
  assert.equal(await one('select icash_consume_automation($1)',[originalToken]),null,'Old capability never works again');
  const results=await Promise.all(Array.from({length:8},()=>one('select icash_consume_automation($1)',[work.token])));
  assert.equal(results.filter(Boolean).length,1,'Queued multi-worker token admission is exactly once');
  assert.equal(await one('select issue_attempts from icash_automation_tickets where id=$1',[ticket]),3,'Local throttles never overflow legacy issue_attempts');
  assert.equal(await defer([ticket,account,screen,work.token,op]),true);
  assert.equal(await one('select owner_preview_deferrals from icash_automation_tickets where id=$1',[ticket]),2);
  const wait=Number(await one('select extract(epoch from owner_preview_retry_after-completed_at) from icash_automation_tickets where id=$1',[ticket]));assert.equal(wait,60,'Deferral backoff doubles independently');
 });
 for(const bad of [[other,account,screen,originalToken,op],[ticket,other,screen,originalToken,op],[ticket,account,other,originalToken,op],[ticket,account,screen,'wrong',op],[ticket,account,screen,originalToken,op+':other']])assert.equal(await defer(bad),false);
 const blockers=[
  "update icash_automation_tickets set expires_at=now()-interval '1 second'",
  "update icash_automation_tickets set state='issued'",
  "update icash_automation_tickets set owner_preview_deferrals=8",
  "update icash_screening_jobs set completed_at=now()-interval '25 hours'",
  "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}',to_jsonb((now()-interval '25 hours')::text))",
  "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}','\"malformed\"')",
  "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}',to_jsonb((now()+interval '1 hour')::text))",
  "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{raw,data,dm_property_id}','\"prop_999\"')",
  "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{raw,data,state}','\"ZZ\"')",
  "update icash_screening_jobs set snapshot=snapshot||'{\"sellerRequest\":{}}'",
  "update icash_screening_jobs set snapshot=snapshot||'{\"practice\":true}'",
  "update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"ineligible\"}}'",
  `insert into icash_credit_reservations(account_id,operation_key,amount_cents,status) values('${account}','${op}',105,'released')`,
  ...['',':people',':properties',':deduplicated'].map(s=>`insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine','${op+s}','SYNTHETIC partial receipt',0,'provider_credits')`),
  `insert into icash_cost_observations(provider,event_key,source_ref,amount,units) values('dealmachine','SYNTHETIC unrelated event','dealmachine:owners:${op}:people',0,'provider_credits')`,
  `insert into icash_cost_manifests(operation_key,charge_cents,actual_micros,components,evidence_ref) values('${op}',0,0,'{}','SYNTHETIC zero receipt')`,
  `insert into icash_owner_contacts(screening_id,account_id,operation_key,result) values('${screen}','${account}','${op}','{}')`,
  `insert into icash_private.provider_costs values('${op}')`,
  `insert into icash_operational_contacts values('${account}','${screen}')`,
  `insert into icash_contact_permissions values('${account}','${screen}')`,
 ];
 const controls=[
  "update icash_accounts set bot_paused=true",'update fixture_policy set member=false',
  'update icash_operating_budget set enabled=false','update icash_wallets set balance_cents=0',
  'update icash_discovery_configs set enabled=false','update icash_discovery_configs set auto_enabled=false','update icash_discovery_configs set contacts_enabled=false',
  "update icash_discovery_configs set data_rights_until=now()-interval '1 second'",
  "update icash_operation_rates set enabled=false","update icash_operation_rates set verified_at=now()+interval '1 hour'",
  "update icash_operation_rates set expires_at=now()-interval '1 second'",
  `insert into icash_property_controls(account_id,property_id,manual) values('${account}','prop_123',true)`,
  'update icash_prospecting_budgets set baseline_cents=2',
 ];
 for(const mutation of controls)await isolated(async()=>{await pg.exec(mutation);assert.equal(await defer(),true,'Temporary controls still allow safe parking: '+mutation);await due();assert.equal(await eligible(),null,'Temporary controls prevent reissue: '+mutation);});
 for(const mutation of blockers)await isolated(async()=>{await pg.exec(mutation);assert.equal(await defer(),false,mutation);});
 await isolated(async()=>{await reserve();assert.equal(await defer(),false,'Reserved operation is never retried');await pg.exec("update icash_operation_spend set state='cancelled'");assert.equal(await defer(),false,'Cancelled operation is not proof of an unstarted preview');});
 await isolated(async()=>{await defer();await due();await pg.exec("update icash_screening_jobs set result=result||'{\"changed\":true}'");assert.equal(await eligible(),null,'Changed screening hash prevents reissue');});
 for(const mutation of ["update icash_automation_tickets set owner_preview_retry_until=now()-interval '1 second'","update icash_automation_tickets set owner_preview_deferrals=8"]){
  await isolated(async()=>{await defer();await due();await pg.exec(mutation);assert.equal(await eligible(),null,mutation);await pg.exec("update icash_automation_tickets set outcome='expired',issue_attempts=1");assert.equal(await eligible(),null,'Legacy expiry cannot bypass the dedicated retry bound');});
 }
 await isolated(async()=>{
  await defer();await due();const p=id(40);await q("insert into icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at) select $1,account_id,'SYNTHETIC duplicate',snapshot,state,result,completed_at from icash_screening_jobs where id=$2",[p,screen]);
  await q("insert into icash_owner_contacts(screening_id,account_id,operation_key,result) values($1,$2,'SYNTHETIC prior owner receipt','{}')",[p,account]);assert.equal(await eligible(),null,'Recent same-property contacts on another screening prevent retries');
  await pg.exec("update icash_owner_contacts set created_at=now()-interval '31 days'");assert.equal(await eligible(),screen,'Historical duplicate policy remains 30 days');
 });
 await isolated(async()=>{
  await held();const args=await recoveryArgs();const results=await Promise.all(Array.from({length:8},()=>recover(args)));
  assert.equal(results.filter(Boolean).length,1,'Concurrent queued reviewed recovery is idempotent');assert.equal(Number(await one('select count(*) from icash_owner_enrichment_recoveries')),1);
  const recovered=await one('select to_jsonb(t) from icash_automation_tickets t where id=$1',[ticket]);assert.equal(recovered.token,originalToken,'Recovery parks; only scheduler issues a fresh capability');
  assert.equal(await recover(args),false);assert.deepEqual(await one('select to_jsonb(t) from icash_automation_tickets t where id=$1',[ticket]),recovered,'Repeated recovery is a full no-op');
  await rejected(()=>q('update icash_owner_enrichment_recoveries set approved_max_charge_cents=106'),/immutable/);
  await rejected(()=>q('delete from icash_owner_enrichment_recoveries'),/immutable/);
 });
 for(const [index,value] of [[4,'b'.repeat(64)],[5,'b'.repeat(64)],[6,'short'],[7,'bad'],[8,'paid_request_rate_limited'],[9,0],[0,other],[1,other],[2,other],[3,op+':other']])await isolated(async()=>{await held();const args=await recoveryArgs();args[index]=value;assert.equal(await recover(args),false,`Recovery input ${index}`);});
 await isolated(async()=>{await held();const args=await recoveryArgs();await q("update icash_automation_tickets set completed_at=completed_at-interval '1 second'");assert.equal(await recover(args),false,'Changed ticket evidence is rejected');});
 await isolated(async()=>{await held();const args=await recoveryArgs();await pg.exec("update icash_screening_jobs set snapshot=snapshot||'{\"changed\":true}'");assert.equal(await recover(args),false,'Changed snapshot is rejected');});
 await isolated(async()=>{await held();const args=await recoveryArgs();await reserve();assert.equal(await recover(args),false,'New reservation after review blocks recovery');});
 await isolated(async()=>{
  await held();assert.equal(await recover(await recoveryArgs()),true);
  await pg.exec('update icash_operation_rates set charge_cents=106');assert.equal(await eligible(),null,'Raised rate cannot be scheduled');
  await rejected(()=>reserve(),/recovery approval exceeded/);assert.equal(Number(await one('select count(*) from icash_credit_reservations')),0,'Cap rejection rolls back before a durable authorization');
 });
 // Savepoints keep intentional trigger failures from poisoning each transaction.
 await isolated(async()=>{
  await held();assert.equal(await recover(await recoveryArgs()),true);await reserve();assert.equal(await finalClaim(),true);assert.equal(await finalClaim(),false,'Paid claim is exactly once');
  assert.equal(await defer(),false,'Dispatched work cannot return to retry queue');
 });
 await isolated(async()=>{
  await held();assert.equal(await recover(await recoveryArgs()),true);await reserve();await pg.exec('update icash_operation_rates set charge_cents=106');assert.equal(await finalClaim(),false,'Final paid claim checks later rate drift');
 });

 // The cap is not merely a one-time reclassification-time quote check.
 await isolated(async()=>{
  await held();assert.equal(await recover(await recoveryArgs()),true);await reserve();
  await rejected(()=>q('update icash_credit_reservations set amount_cents=106'),/approval exceeded/);
  await rejected(()=>q('update icash_credit_reservations set account_id=$1',[other]),/approval exceeded/);
  await rejected(()=>q("update icash_credit_reservations set operation_key='different-operation'"),/identity is immutable/);
  await rejected(()=>q('update icash_operation_spend set charge_cap_cents=106'),/approval exceeded/);
  await rejected(()=>q('update icash_operation_spend set customer_price_micros=1060000'),/approval exceeded/);
  await rejected(()=>q('update icash_operation_spend set charged_cents=106'),/approval exceeded/);
  await rejected(()=>q("update icash_operation_spend set operation_key='different-operation'"),/identity is immutable/);
  assert.equal(await finalClaim(),true,'Rejected mutations leave the approved original usable');
 });
 await isolated(async()=>{
  await held();assert.equal(await recover(await recoveryArgs()),true);
  const reservations=await Promise.all(Array.from({length:8},()=>reserve()));assert.equal(reservations.length,8);
  assert.equal(Number(await one('select count(*) from icash_credit_reservations')),1,'Queued workers reserve the same original operation once');
  assert.equal(Number(await one('select count(*) from icash_operation_spend')),1);
  const claims=await Promise.all(Array.from({length:8},()=>finalClaim()));assert.equal(claims.filter(Boolean).length,1,'Queued workers make only one paid claim');
 });
 await isolated(async()=>{
  await held();assert.equal(await recover(await recoveryArgs()),true);await reserve();
  await pg.exec("update icash_screening_jobs set result=result||'{\"changedAfterIssue\":true}'");
  assert.equal(await finalClaim(),false,'Hash remains authoritative after token issue and reservation');
  await rejected(()=>q("update icash_operation_spend set state='dispatched'"),/screening changed/,'Direct dispatch cannot bypass the pinned scope');
 });
 for(const [mutation,expected] of [["update icash_automation_tickets set owner_preview_deferrals=8",'owner_preview_retry_exhausted'],["update icash_automation_tickets set owner_preview_retry_until=now()-interval '1 second'",'owner_preview_expired']])await isolated(async()=>{
  assert.equal(await defer(),true);await due();await pg.exec(mutation);assert.equal(await one('select icash_next_acquisition()'),null);
  assert.equal(await one('select outcome from icash_automation_tickets where id=$1',[ticket]),expected,'Scheduler makes terminal proof state explicit');
 });
 for(const mutation of ['update icash_accounts set bot_paused=true','update icash_prospecting_budgets set baseline_cents=2','update icash_discovery_configs set contacts_enabled=false','update icash_operation_rates set charge_cents=106'])await isolated(async()=>{
  await held();const args=await recoveryArgs();await pg.exec(mutation);assert.equal(await recover(args),true,'Reviewed unstarted work can wait behind temporary controls');assert.equal(await eligible(),null);
  assert.equal(await one('select approved_max_charge_cents::int from icash_owner_enrichment_recoveries'),105);
 });
 // Expired reissued capabilities cannot be consumed or upgraded to fresh proof.
 await isolated(async()=>{await defer();await due();const work=await one('select icash_next_acquisition()');await pg.exec("update icash_automation_tickets set expires_at=now()-interval '1 second'");assert.equal(await one('select icash_consume_automation($1)',[work.token]),null);assert.equal(await defer([ticket,account,screen,work.token,op]),false);});

 await isolated(async()=>{
  assert.equal(await defer(),true);await due();const work=await one('select icash_next_acquisition()');assert(await one('select icash_consume_automation($1)',[work.token]));
  const current=await one('select to_jsonb(t) from icash_automation_tickets t where id=$1',[ticket]);
  await one("select icash_finish_automation($1,false,'held_for_reconciliation')",[ticket]);
  assert.deepEqual(await one('select to_jsonb(t) from icash_automation_tickets t where id=$1',[ticket]),current,'Legacy delayed completion cannot clobber newly consumed token');
  assert.equal(await one("select icash_finish_owner_enrichment($1,$2,$3,$4,false,'held_for_reconciliation')",[ticket,account,screen,originalToken]),false,'Old token cannot complete a new attempt');
  assert.deepEqual(await one('select to_jsonb(t) from icash_automation_tickets t where id=$1',[ticket]),current);
  assert.equal(await one("select icash_finish_owner_enrichment($1,$2,$3,$4,true,'contacts_saved')",[ticket,account,screen,work.token]),true);
  assert.equal(await one('select state from icash_automation_tickets where id=$1',[ticket]),'complete');
 });
 // Reconstruct prerequisite production privileges that schema-only fixtures omit.
 await pg.exec(`grant usage on schema public,icash_private to service_role;grant select on icash_private.provider_costs to service_role;
 do $$declare table_name text;begin for table_name in select tablename from pg_tables where schemaname='public' and tablename<>'icash_owner_enrichment_recoveries' loop
 execute format('grant select,insert,update,delete on public.%I to service_role',table_name);end loop;end$$;
 grant usage,select on all sequences in schema public to service_role;`);
 await isolated(async()=>{await pg.exec('set local role service_role');assert.equal(await defer(),true,'Real service-role deferral has necessary privileges');});
 await isolated(async()=>{await held();const args=await recoveryArgs();await pg.exec('set local role service_role');assert.equal(await recover(args),true,'Real service-role audited recovery can insert approval');await reserve();assert.equal(await finalClaim(),true,'Real service-role reservation and paid gate remain callable');});
 assert.equal(await one("select has_table_privilege('service_role','icash_owner_enrichment_recoveries','update')"),false);
 for(const role of ['anon','authenticated'])for(const fn of ['icash_defer_owner_enrichment(uuid,uuid,uuid,text,text)','icash_recover_owner_enrichment(uuid,uuid,uuid,text,text,text,text,text,text,bigint)','icash_owner_enrichment_retry_current(uuid,uuid)','icash_finish_owner_enrichment(uuid,uuid,uuid,text,boolean,text)'])assert.equal(await one("select has_function_privilege($1,$2,'execute')",[role,fn]),false);
 console.log('PASS owner preview deferral/recovery: inert migration, exact stage/hash evidence, single-use tokens, bounded separate backoff, existing candidate guards, partial-receipt exclusion, persistent 105-cent approval, queued worker idempotency. PGlite only; real multi-session lock races not exercised.');
}catch(error){console.error(error.stack);console.error(error.query??'');process.exitCode=1;}finally{await pg.close();}
