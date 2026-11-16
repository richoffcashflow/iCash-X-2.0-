import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const captured=JSON.parse(read('tests/fixtures/sms-projection-screening-before.json'));
export const migration=read('config/sms-projection-screening.sql');
export const id=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const value=async(db,s,a=[])=>Object.values((await db.query(s,a)).rows[0]??{})[0];
export const exec=(db,s)=>db.exec?db.exec(s):db.query(s);
export async function install(db){
 await exec(db,`
 do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
 end$$;
 create table public.icash_operating_budget(id int primary key);
 insert into public.icash_operating_budget values(1);
 create table public.icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table public.icash_outreach_campaigns(account_id uuid primary key);
 create table public.icash_wallets(account_id uuid primary key,balance_cents bigint);
 create table public.icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create table public.icash_customer_identities(account_id uuid primary key,principal text);
 create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb,result jsonb,completed_at timestamptz);
 create table public.icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table public.icash_handoffs(account_id uuid,screening_id uuid,state text);
 create table public.icash_deal_files(id uuid primary key default gen_random_uuid(),account_id uuid,screening_id uuid,terms jsonb,stage text default 'draft',unique(account_id,screening_id));
 create table public.icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,channel text,phone text,timezone text,dnc_receipt_id uuid,eligibility_until timestamptz,revoked_at timestamptz);
 create table public.icash_dnc_verification_receipts(id uuid primary key,phone text,checked_at timestamptz,clear boolean,evidence_kind text);
 create table public.icash_text_senders(phone text primary key,enabled boolean);
 insert into public.icash_text_senders values('+12125550100',true);
 create table public.icash_operation_rates(id uuid primary key,operation text,verified_at timestamptz,expires_at timestamptz);
 insert into public.icash_operation_rates values('${id(900)}','sms_send',now()-interval '1 hour',now()+interval '2 days');
 create table public.icash_communication_prices(operation text primary key,customer_micros bigint);
 insert into public.icash_communication_prices values('sms_segment',1000);
 create table public.icash_text_threads(id uuid primary key default gen_random_uuid(),sender_pool_assigned boolean,account_id uuid,deal_id uuid,sender text,recipient text,timezone text,dnc_checked_at timestamptz,dnc_clear boolean,sms_rate_id uuid,paused boolean,party text,ai_mode text,sms_intake_pending boolean,operational_contact_id uuid,eligibility_until timestamptz,operational_sms_sender text,operational_sms_rate_hash text,operational_sms_price_micros bigint,retired_at timestamptz,owner_buyer_test_id uuid);
 create unique index fixture_active_thread on public.icash_text_threads(account_id,deal_id,sender,recipient) where retired_at is null and owner_buyer_test_id is null;
 create sequence public.fixture_source_checks;
 create sequence public.fixture_route_checks;
 create table public.fixture_policy(source_ok boolean default true,route_ok boolean default true,sms_ok boolean default true,member_ok boolean default true,block_final boolean default false);
 insert into public.fixture_policy default values;
 create function public.icash_prepare_operational_contacts(uuid) returns integer language sql as $$select 0$$;
 create function public.icash_sms_intake_rate_current(uuid) returns boolean language sql as $$select true$$;
 create function public.icash_owner_sms_quality_candidate(uuid,uuid,text) returns boolean language sql as $$select true$$;
 create function public.icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language plpgsql as $$begin
  perform nextval('public.fixture_source_checks');return (select source_ok from public.fixture_policy);end$$;
 create function public.icash_business_conversation_sender(uuid,uuid,text) returns text language plpgsql as $$begin
  perform nextval('public.fixture_route_checks');return '+12125550100';end$$;
 create function public.icash_prospect_sms_route_available(uuid,uuid,text,text) returns boolean language sql as $$select route_ok from public.fixture_policy$$;
 create function public.icash_outreach_sms_current(uuid) returns boolean language plpgsql as $$begin
  if (select block_final from public.fixture_policy) then perform pg_advisory_xact_lock(198213);end if;
  return (select sms_ok from public.fixture_policy);end$$;
 create function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select member_ok from public.fixture_policy$$;
 create function public.icash_research_state_allowed(text) returns boolean language sql as $$select true$$;
 `);
 await exec(db,captured.definition);
 await exec(db,`revoke all on function public.icash_project_operational_sms_contacts(uuid) from public,anon,authenticated;
 grant execute on function public.icash_project_operational_sms_contacts(uuid) to service_role;`);
 assert.equal(await value(db,"select md5(pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure))"),captured.hash);
}
export async function seed(db,n,age='1 hour'){
 const a=id(n),s=id(n+10000),c=id(n+20000),phone='+1212555'+String(n).padStart(4,'0');
 await db.query('insert into public.icash_accounts values($1,false)',[a]);
 await db.query('insert into public.icash_outreach_campaigns values($1)',[a]);
 await db.query('insert into public.icash_wallets values($1,10000)',[a]);
 await db.query("insert into public.icash_customer_identities values($1,'Fixture buyer')",[a]);
 await db.query(`insert into public.icash_screening_jobs values($1,$2,'complete',
  jsonb_build_object('propertyId',$3::text,'propertyType','house','fetchedAt',now(),'raw',jsonb_build_object('data',jsonb_build_object('state','TX'))),
  jsonb_build_object('property',jsonb_build_object('propertyId',$3::text,'address','100 Fixture Street'),'financialCheck',jsonb_build_object('status','eligible')),now()-$4::interval)`,[s,a,'synthetic-'+n,age]);
 await db.query("insert into public.icash_operational_contacts values($1,$2,$3,'sms',$4,'America/Chicago',$1,now()+interval '1 day',null)",[c,a,s,phone]);
 await db.query("insert into public.icash_dnc_verification_receipts values($1,$2,now(),true,'national_provider_observation')",[c,phone]);
 return {a,s,c,phone};
}
const metadata=db=>db.query("select oid,proowner,proacl,provolatile,prosecdef,proconfig from pg_proc where oid='public.icash_project_operational_sms_contacts(uuid)'::regprocedure");
const snapshot=db=>value(db,`select jsonb_build_object(
 'threads',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_text_threads t),
 'deals',(select jsonb_agg(to_jsonb(d) order by id) from public.icash_deal_files d),
 'contacts',(select jsonb_agg(to_jsonb(c) order by id) from public.icash_operational_contacts c))`);
export async function verify(db){
 const originalMetadata=(await metadata(db)).rows,originalState=await snapshot(db);
 await exec(db,captured.definition.replace('AS $function$','AS $function$\n-- synthetic drift'));
 await assert.rejects(exec(db,migration),/SMS projection screening prerequisite changed/);await exec(db,'rollback');
 await exec(db,captured.definition);
 // Reproduce starvation through the actual complete function: all first 100
 // contacts have expired screening, while the later funded contact is valid.
 for(let n=1;n<=125;n++)await seed(db,n,'25 hours');
 const valid=await seed(db,126);
 await exec(db,'begin');
 assert.equal(await value(db,'select public.icash_project_operational_sms_contacts(null)'),0,'Old queue repeatedly selects stale prospects before the eligible account');
 const oldChecks=Number(await value(db,'select last_value from public.fixture_route_checks'));
 assert(oldChecks>=100);await exec(db,'rollback');
 const beforeState=await snapshot(db);
 await exec(db,migration);
 assert.deepEqual((await metadata(db)).rows,originalMetadata,'Function rights, volatility, ownership and search path are unchanged');
 assert.deepEqual(await snapshot(db),beforeState,'Migration changes no evidence or queued work');
 const after=await value(db,"select pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure)");
 assert.equal(after.slice(after.indexOf('\n loop')),captured.definition.slice(captured.definition.indexOf('\n loop')),'Every final locked check and insertion stays byte-for-byte unchanged');
 await exec(db,"select setval('public.fixture_route_checks',1,false)");
 assert.equal(await value(db,'select public.icash_project_operational_sms_contacts(null)'),1,'Eligible account behind 125 rejected prospects progresses');
 const newChecks=Number(await value(db,'select last_value from public.fixture_route_checks'));
 assert.equal(newChecks,2,'Only the valid source reaches routing and its final recheck');
 assert.equal(await value(db,'select account_id::text from public.icash_text_threads'),valid.a);
 assert.equal(await value(db,'select public.icash_project_operational_sms_contacts(null)'),0,'A repeated poll cannot duplicate the thread');
 await exec(db,'truncate public.icash_text_threads,public.icash_deal_files');
 const cases=[
  ["update public.icash_screening_jobs set completed_at=null",0],
  ["update public.icash_screening_jobs set completed_at=now()+interval '1 minute'",0],
  ["update public.icash_screening_jobs set state=null",0],
  ["update public.icash_screening_jobs set result=result-'financialCheck'",0],
  ["update public.icash_screening_jobs set result=jsonb_set(result,'{financialCheck,status}','\"ineligible\"')",0],
  ["insert into public.icash_property_controls select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs",0],
  ["insert into public.icash_property_controls select account_id,snapshot->>'propertyId',null from public.icash_screening_jobs",1],
  ["update public.fixture_policy set source_ok=false",0],
  ["update public.fixture_policy set source_ok=null",0],
  ["update public.fixture_policy set route_ok=false",0],
  ["update public.icash_wallets set balance_cents=0",0],
  ["update public.icash_accounts set bot_paused=true",0],
  ["update public.icash_operational_contacts set revoked_at=now()",0],
  ["update public.icash_operational_contacts set eligibility_until=now()-interval '1 second'",0],
  ["update public.fixture_policy set member_ok=false",0],
  ["insert into public.icash_billing_reviews select id,null from public.icash_accounts",0],
 ];
 for(const [change,expected] of cases){
  await exec(db,'begin');try{await exec(db,change);
   assert.equal(await value(db,'select public.icash_project_operational_sms_contacts($1)',[valid.a]),expected,change);
  }finally{await exec(db,'rollback');}
 }
 // Missing or foreign screening, unsupported auto-draft and existing non-draft
 // deals still cannot grant a thread through the earlier read-only hint.
 for(const change of [
  "update public.icash_screening_jobs set account_id='"+id(999)+"'",
  "update public.icash_screening_jobs set snapshot=snapshot-'fetchedAt'",
  "insert into public.icash_handoffs select account_id,id,'manual' from public.icash_screening_jobs",
  "insert into public.icash_deal_files(account_id,screening_id,terms,stage) select account_id,id,'{}','signed' from public.icash_screening_jobs",
 ]){await exec(db,'begin');try{await exec(db,change);assert.equal(await value(db,'select public.icash_project_operational_sms_contacts($1)',[valid.a]),0,change);}finally{await exec(db,'rollback');}}
 for(const role of ['anon','authenticated'])assert.equal(await value(db,"select has_function_privilege($1,'public.icash_project_operational_sms_contacts(uuid)','execute')",[role]),false);
 return {oldChecks,newChecks,skipped:125,prepared:1,cases:cases.length,originalState};
}
