import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const captured=JSON.parse(read('tests/fixtures/research-capacity-isolation-before.json'));
export const migration=read('config/research-capacity-isolation.sql');
export const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
const exec=(db,sql)=>db.exec?db.exec(sql):db.query(sql);
export const capacityScans=db=>value(db,'select case when is_called then last_value else 0 end::integer from public.fixture_capacity_scans');
export const resetScans=db=>exec(db,"select setval('public.fixture_capacity_scans',1,false)");

// The production function is captured verbatim. Only its independent eligibility
// boundaries are synthetic; every join, source guard and branch runs as shipped.
export async function installFixture(db){
 await exec(db,`
 do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
 end$$;
 create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb,result jsonb);
 create table public.icash_text_suppressions(phone text primary key);
 create table public.icash_contact_suppressions(contact_key text primary key);
 create table public.icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table public.icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table public.icash_voice_contact_targets(id uuid primary key,account_id uuid,screening_id uuid,party text,phone text,contact_key text,permission_until timestamptz,revoked_at timestamptz,dnc_clear boolean);
 create table public.icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,operational_contact_id uuid,callback_id uuid,sms_source_message_id uuid,cancellation_notice_id uuid,state text,outcome text,provider_call_sid text,conversation_id text,operation_key text,due_at timestamptz default now());
 create unique index icash_voice_jobs_operation_key_key on public.icash_voice_jobs(operation_key);
 create table public.icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,paused boolean default false,manual_only boolean default false,retired_at timestamptz,eligibility_until timestamptz,permission_until timestamptz,recipient text);
 create table public.icash_text_messages(id uuid primary key,thread_id uuid,account_id uuid,direction text,state text,customer_author_id uuid,provider_id text,last_delivery_at timestamptz);
 create table public.icash_automation_tickets(id uuid primary key,account_id uuid,opener_message_id uuid,state text,outcome text,kind text,expires_at timestamptz);
 create table public.fixture_policy(voice_current boolean default true,sms_current boolean default true,capacity boolean default true,hours boolean default true,spacing boolean default true,inventory boolean default true,slow_capacity boolean default false);
 insert into public.fixture_policy default values;
 create sequence public.fixture_capacity_scans;
 create sequence public.fixture_detailed_checks;
 create function public.icash_outgoing_voice_capacity_open() returns boolean language plpgsql stable set search_path='' as $$
 begin
  perform nextval('public.fixture_capacity_scans');
  if (select slow_capacity from public.fixture_policy) then perform pg_sleep(0.25);end if;
  return (select capacity from public.fixture_policy);
 end$$;
 create function public.icash_outreach_voice_current(uuid) returns boolean language sql stable set search_path='' as $$select voice_current from public.fixture_policy$$;
 create function public.icash_outreach_sms_current(uuid) returns boolean language sql stable set search_path='' as $$select sms_current from public.fixture_policy$$;
 create function public.icash_voice_outreach_hours_current(uuid,uuid) returns boolean language plpgsql stable set search_path='' as $$
 begin perform nextval('public.fixture_detailed_checks');return (select hours from public.fixture_policy);end$$;
 create function public.icash_seller_phone_call_current(uuid,uuid) returns boolean language sql stable set search_path='' as $$select spacing from public.fixture_policy$$;
 create function public.icash_sms_outreach_window_current(uuid,uuid) returns boolean language sql stable set search_path='' as $$select hours from public.fixture_policy$$;
 create function public.icash_cold_inventory_available(uuid,uuid,text) returns boolean language sql stable set search_path='' as $$select inventory from public.fixture_policy$$;
 `);
 await exec(db,captured.definition);
 await exec(db,captured.definition.replace('public.icash_research_waiting_on_outreach(','public.fixture_waiting_before('));
 await exec(db,`revoke all on function public.icash_research_waiting_on_outreach(uuid) from public,anon,authenticated;
 grant execute on function public.icash_research_waiting_on_outreach(uuid) to service_role;
 grant usage on schema public to service_role;
 grant select on all tables in schema public to service_role;
 grant usage on all sequences in schema public to service_role;`);
 assert.equal(await value(db,"select md5(pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure))"),captured.hash);
}
export async function seedVoice(db){
 await db.query("insert into public.icash_screening_jobs values($1,$2,'complete','{\"propertyId\":\"synthetic-property\"}','{\"financialCheck\":{\"status\":\"eligible\"}}')",[id(2),id(1)]);
 await db.query("insert into public.icash_voice_contact_targets values($1,$2,$3,'seller','+12125550101','synthetic-contact',now()+interval '1 day',null,true)",[id(3),id(1),id(2)]);
 await db.query("insert into public.icash_voice_jobs(id,account_id,operational_contact_id,state) values($1,$2,$3,'ready')",[id(4),id(1),id(3)]);
}
const metadata=db=>value(db,`select jsonb_build_object('volatility',provolatile,'definer',prosecdef,'config',proconfig,'acl',proacl::text,'owner',proowner,'language',prolang)
 from pg_proc where oid='public.icash_research_waiting_on_outreach(uuid)'::regprocedure`);
const state=db=>value(db,`select jsonb_build_object(
 'jobs',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_voice_jobs x),
 'targets',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_voice_contact_targets x),
 'screenings',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_screening_jobs x),
 'messages',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_text_messages x),
 'tickets',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_automation_tickets x))`);
export async function verifyIsolation(db){
 const beforeMetadata=await metadata(db),beforeState=await state(db);
 // Installation is source-pinned and failure restores the original function.
 await exec(db,'begin');
 await exec(db,captured.definition.replace(' select (case when',' -- synthetic source drift\n select (case when'));
 await assert.rejects(exec(db,migration),/prerequisite changed/);await exec(db,'rollback');
 await assert.rejects(exec(db,'begin;'+migration+'select 1/0;commit;'),/division by zero/);await exec(db,'rollback');
 assert.equal(await value(db,"select md5(pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure))"),captured.hash);
 assert.equal(await value(db,"select to_regclass('public.icash_voice_jobs_possible_introduction')"),null,'Failed installation leaves no partial index');
 await exec(db,'begin;'+migration+'commit;');
 assert.deepEqual(await metadata(db),beforeMetadata,'Language, volatility, invoker rights, search path, owner and ACL are unchanged');
 assert.deepEqual(await state(db),beforeState,'Installation cannot alter work or source evidence');
 const installed=await value(db,"select pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure)");
 const restored=installed.replace(/ select \(case when exists\([\s\S]*?\n \) then case when/,' select (case when').replace(') else false end else false end) or (',') else false end) or (');
 assert.equal(restored,captured.definition,'Every detailed voice/SMS predicate remains byte-for-byte unchanged');
 const check=async(account=id(1))=>{
  const before=await value(db,'select public.fixture_waiting_before($1)',[account]);
  const snapshot=await state(db);
  const after=await value(db,'select public.icash_research_waiting_on_outreach($1)',[account]);
  assert.equal(after,before);assert.deepEqual(await state(db),snapshot,'Eligibility is read-only');return after;
 };
 for(const fn of ['fixture_waiting_before','icash_research_waiting_on_outreach']){
  await resetScans(db);
  for(let n=50;n<150;n++)assert.equal(await value(db,'select public.'+fn+'($1)',[id(n)]),false);
  assert.equal(await capacityScans(db),fn==='fixture_waiting_before'?100:0);
 }
 assert.equal(await check(null),false);
 await seedVoice(db);assert.equal(await check(),true);
 let nullCases=0;
 for(const voice of [true,false,null])for(const capacity of [true,false,null])for(const hours of [true,false,null]){
  await db.query('update public.fixture_policy set voice_current=$1,capacity=$2,hours=$3',[voice,capacity,hours]);await check();nullCases++;
 }
 await exec(db,'update public.fixture_policy set voice_current=true,capacity=true,hours=true');
 for(const mutation of [
  "state='complete'","state='held',outcome='provider_outcome_unknown_no_retry'","state=null",
  "callback_id='"+id(90)+"'","sms_source_message_id='"+id(90)+"'","cancellation_notice_id='"+id(90)+"'",
  "provider_call_sid='original-call'","conversation_id='original-conversation'","operation_key='original-unknown'",
  "due_at=now()+interval '1 hour'","due_at=null","account_id='"+id(90)+"'"
 ]){
  await exec(db,'begin');try{
   await db.query('update public.icash_voice_jobs set '+mutation+' where id=$1',[id(4)]);
   await check();await resetScans(db);assert.equal(await value(db,'select public.icash_research_waiting_on_outreach($1)',[id(1)]),false);
   assert.equal(await capacityScans(db),0,mutation);
  }finally{await exec(db,'rollback');}
 }
 for(const mutation of ["state='issued'","state='held',outcome='prospecting_budget_held'"]){
  await exec(db,'begin');try{
   await db.query('update public.icash_voice_jobs set '+mutation+' where id=$1',[id(4)]);
   assert.equal(await check(),true);await resetScans(db);await value(db,'select public.icash_research_waiting_on_outreach($1)',[id(1)]);assert.equal(await capacityScans(db),1);
  }finally{await exec(db,'rollback');}
 }
 for(const mutation of [
  "update public.icash_voice_contact_targets set revoked_at=now()",
  "update public.icash_voice_contact_targets set permission_until=now()-interval '1 second'",
  "update public.icash_voice_contact_targets set dnc_clear=false",
  "update public.icash_voice_contact_targets set account_id='"+id(90)+"'",
  "update public.icash_screening_jobs set result='{}'",
  "update public.icash_screening_jobs set snapshot='{\"sellerRequest\":true}'",
  "insert into public.icash_text_suppressions values('+12125550101')",
  "insert into public.icash_contact_suppressions values('synthetic-contact')",
  "insert into public.icash_property_controls values('"+id(1)+"','synthetic-property',true)",
  "update public.fixture_policy set spacing=false",
  "update public.fixture_policy set inventory=false"
 ]){
  await exec(db,'begin');try{await exec(db,mutation);assert.equal(await check(),false);}finally{await exec(db,'rollback');}
 }
 // Keep the original cheap provider-full shortcut when a local candidate exists.
 await exec(db,"update public.fixture_policy set capacity=false;select setval('public.fixture_detailed_checks',1,false)");
 assert.equal(await value(db,'select public.icash_research_waiting_on_outreach($1)',[id(1)]),false);
 assert.equal(await value(db,'select is_called from public.fixture_detailed_checks'),false);
 await exec(db,'update public.fixture_policy set capacity=true');
 // SMS remains independently authoritative even with no local voice candidate.
 await db.query('update public.icash_voice_jobs set operation_key=$1 where id=$2',['original-unknown',id(4)]);
 await db.query('insert into public.icash_deal_files values($1,$2,$3)',[id(5),id(1),id(2)]);
 await db.query("insert into public.icash_text_threads(id,account_id,deal_id,party,permission_until,recipient) values($1,$2,$3,'seller',now()+interval '1 day','+12125550101')",[id(6),id(1),id(5)]);
 await db.query("insert into public.icash_text_messages values($1,$2,$3,'outgoing','ready',null,null,null)",[id(7),id(6),id(1)]);
 assert.equal(await check(),true);await resetScans(db);
 assert.equal(await value(db,'select public.icash_research_waiting_on_outreach($1)',[id(1)]),true);assert.equal(await capacityScans(db),0);
 await db.query("insert into public.icash_automation_tickets values($1,$2,$3,'held','held_for_reconciliation','seller_opener',now()-interval '1 hour')",[id(8),id(1),id(7)]);
 assert.equal(await check(),false,'Uncertain SMS stays held');
 for(const role of ['anon','authenticated','service_role'])assert.equal(await value(db,"select has_function_privilege($1,'public.icash_research_waiting_on_outreach(uuid)','execute')",[role]),role==='service_role');
 return {emptyAccounts:100,originalGlobalScans:100,optimizedGlobalScans:0,nullCases,definitionMd5:await value(db,"select md5(pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure))")};
}
