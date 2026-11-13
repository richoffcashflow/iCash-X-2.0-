import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args),one=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const account='00000000-0000-4000-8000-000000000001',screen='00000000-0000-4000-8000-000000000002',contact='00000000-0000-4000-8000-000000000003';
const clock='2026-11-13T13:00:00Z',completed='2026-11-13T11:00:00Z';
const wait=async(at=clock,done=completed)=>{
 const result=await one('select icash_reliability_private.account_outreach_wait($1,$2,$3)',[account,done,at]);
 const previous=await one('select icash_reliability_private.fixture_outreach_wait_before_cost($1,$2,$3)',[account,done,at]);
 assert.equal(result,previous,'optimized predicate preserves predecessor eligibility');
 return result;
};
const evidence=()=>one('select icash_reliability_private.account_outreach_wait_evidence($1,$2,$3)',[account,completed,clock]);
const deny=async(label,sql)=>{await pg.exec('begin');try{await pg.exec(sql);assert.equal(await wait(),false,label);}finally{await pg.exec('rollback');}};
try{
 await pg.exec(read('tests/fixtures/account-work-repair.sql'));
 await pg.exec(`
 create table fixture_work_state(account_id uuid primary key,buffer integer,candidate uuid,voice_enabled boolean);
 create function icash_pending_opportunity_count(uuid) returns integer language sql stable set search_path=public as $$select buffer from fixture_work_state where account_id=$1$$;
 create function icash_enrichment_before_prospecting_budget(uuid) returns uuid language sql stable set search_path=public as $$select candidate from fixture_work_state where account_id=$1$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql stable set search_path=public as $$select voice_enabled from fixture_work_state where account_id=$1$$;
 create view icash_timezone_names as select name from pg_timezone_names;
 create table icash_customer_identities(account_id uuid primary key,principal text);
 create table icash_voice_configs(account_id uuid primary key,enabled boolean,reviewed_until timestamptz,seller_rate_id uuid);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,channel text,phone text,timezone text,timezone_basis text,source_hash text,sending_principal text,created_at timestamptz,eligibility_until timestamptz,revoked_at timestamptz);
 create table icash_contact_permissions(account_id uuid,revoked_at timestamptz,permission_until timestamptz);
 create table icash_voice_jobs(id uuid,account_id uuid,operational_contact_id uuid,state text,due_at timestamptz,operation_key text,provider_call_sid text,conversation_id text,callback_id uuid,sms_source_message_id uuid,cancellation_notice_id uuid);
 create table icash_live_callbacks(account_id uuid,state text,due_at timestamptz);
 create table icash_text_threads(id uuid,account_id uuid,deal_id uuid,recipient text,retired_at timestamptz);
 alter table icash_text_messages add column thread_id uuid,add column direction text,add column event_id uuid,add column created_at timestamptz;
 alter table icash_live_conversations add column screening_id uuid,add column contact_key text,add column conversation_id text,add column result jsonb;
 create function icash_call_has_seller_response(jsonb) returns boolean language sql immutable as $$select coalesce(($1->>'fixtureSellerResponse')::boolean,false)$$;
 `);
 const hours=read('config/first-contact-hours.sql');
 await pg.exec(hours.slice(hours.indexOf('create function public.icash_outreach_timezone'),hours.indexOf('create function public.icash_sms_outreach_window_current')));
 await pg.exec(read('config/account-work-funding-eligibility.sql'));
 let migration=read('config/account-work-outreach-wait.sql');
 assert.equal(migration,read('supabase/migrations/20261113133711_account_work_outreach_wait.sql'),'migration and reviewed SQL agree');
 const original=await one("select pg_get_functiondef('public.icash_account_work_observations()'::regprocedure)");
 const fixtureHash=await one("select md5(pg_get_functiondef('public.icash_account_work_observations()'::regprocedure))");
 assert.equal((migration.match(/e29029fce23b3856ad9cdf32ecd6848d/g)??[]).length,1);
 migration=migration.replace('e29029fce23b3856ad9cdf32ecd6848d',fixtureHash);
 await pg.exec(migration);
 let configuration=read('config/account-work-outreach-configuration.sql');
 assert.equal(configuration,read('supabase/migrations/20261113135943_account_work_outreach_configuration.sql'));
 const waitHash=await one("select md5(pg_get_functiondef('icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz)'::regprocedure))");
 assert.equal((configuration.match(/3cf72e201728ade473624fc1d3df1e2a/g)??[]).length,1);
 await pg.exec(configuration.replace('3cf72e201728ade473624fc1d3df1e2a',waitHash));
 const beforeCost=await one("select pg_get_functiondef('icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz)'::regprocedure)");
 await pg.exec(beforeCost.replace('icash_reliability_private.account_outreach_wait(', 'icash_reliability_private.fixture_outreach_wait_before_cost('));
 let cost=read('config/account-work-outreach-observation-cost.sql');
 assert.equal(cost,read('supabase/migrations/20261113144426_account_work_outreach_observation_cost.sql'));
 assert.equal((cost.match(/1f4c569012dc84b148c6e4dc46c7f499/g)??[]).length,1);
 const beforeCostHash=await one("select md5(pg_get_functiondef('icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz)'::regprocedure))");
 await pg.exec(cost.replace('1f4c569012dc84b148c6e4dc46c7f499',beforeCostHash));
 let once=read('config/account-work-observation-once.sql');
 assert.equal(once,read('supabase/migrations/20261113144655_account_work_observation_once.sql'));
 const observationHash=await one("select md5(pg_get_functiondef('public.icash_account_work_observations()'::regprocedure))");
 const evidenceHash=await one("select md5(pg_get_functiondef('icash_reliability_private.account_outreach_wait_evidence(uuid,timestamptz,timestamptz)'::regprocedure))");
 assert.equal((once.match(/ac207f34d43ecba970e86200a960ba9c/g)??[]).length,1);
 assert.equal((once.match(/724bd1b882007feedd68a7775b3d215a/g)??[]).length,1);
 await pg.exec(once.replace('ac207f34d43ecba970e86200a960ba9c',observationHash).replace('724bd1b882007feedd68a7775b3d215a',evidenceHash));
 const changed=await one("select pg_get_functiondef('public.icash_account_work_observations()'::regprocedure)");
 assert.equal(changed.replace('\n    and not icash_reliability_private.account_outreach_wait(id,completed,now())','').replace('classified as materialized (','classified as ('),original,'only the no-completed-work predicate and evaluation fence change');
 await q("insert into icash_accounts(id,owner_user_id,bot_paused,created_at,workspace_ack_version) values($1,$1,false,$2::timestamptz-interval '2 days','fixture')",[account,clock]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,1000,0)',[account]);
 await q("insert into icash_operation_rates(id,operation,enabled,expires_at,charge_cents) values($1,'property_search',true,'infinity',100)",[account]);
 await q("insert into icash_operation_rates(id,operation,enabled,expires_at,charge_cents) values($1,'seller_voice',true,'infinity',100)",[contact]);
 await q("insert into icash_voice_configs values($1,true,'infinity',$2)",[account,contact]);
 await q("insert into icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,rate_id,contact_rate_id,data_rights_until,max_open_prospects) values($1,true,true,true,$1,$1,'infinity',1)",[account]);
 await q('insert into fixture_work_state values($1,1,null,true)',[account]);
 await q("insert into icash_customer_identities values($1,'fixture-principal')",[account]);
 await q(`insert into icash_screening_jobs(id,account_id,state,result,created_at,completed_at) values($1,$2,'complete','{"financialCheck":{"status":"eligible"}}',$3,$3)`,[screen,account,completed]);
 await q("insert into icash_owner_contacts(account_id,screening_id,operation_key,result,created_at) values($1,$2,'fixture:owners','{\"syntheticSource\":1}',$3)",[account,screen,completed]);
 await q(`insert into icash_operational_contacts values($1,$2,$3,'voice','+12025550101','Pacific/Honolulu','conservative_nanp_window',encode(sha256(convert_to('{"syntheticSource": 1}','UTF8')),'hex'),'fixture-principal',$4,$5::timestamptz+interval '1 day',null)`,[contact,account,screen,completed,clock]);
 await q("insert into icash_voice_jobs(id,account_id,operational_contact_id,state,due_at) values($1,$2,$1,'ready',$3)",[contact,account,completed]);
 await q("insert into icash_operation_spend(operation_key,account_id,state,actual_micros,settled_at) values('fixture:owners',$1,'settled',1,$2)",[account,completed]);
 const originalMoney=await one("select jsonb_build_object('wallets',(select jsonb_agg(w) from icash_wallets w),'operations',(select jsonb_agg(o) from icash_operation_spend o))");
 assert.equal(await wait(),false,'staged disabled');
 assert.equal(await evidence(),true,'full evidence can be verified while live observation stays disabled');
 await pg.exec('update icash_reliability_private.outreach_wait_settings set enabled=true');
 assert.equal(await wait(),true,'fresh overnight contacts, full buffer and closed canonical Chicago window');
 assert.equal(await wait('2026-11-13T14:59:59Z'),true);
 assert.equal(await wait('2026-11-13T15:00:00Z'),false,'9 AM immediately restores the outage observation');
 assert.equal(await wait('2026-11-14T03:00:00Z'),false,'old progress cannot become healthy again at 9 PM');
 assert.equal(await wait(clock,'2026-11-13T02:59:59Z'),false,'a missed prior open window remains an outage');
 for(const done of [null,'infinity','2026-11-13T14:00:00Z','2026-11-12T12:00:00Z'])assert.equal(await wait(clock,done),false,'unknown, future or old completion is not evidence');
 assert.equal(await wait('infinity'),false);
 await deny('spare buffer means research should continue','update fixture_work_state set buffer=0');
 await deny('unknown buffer cannot prove waiting','update fixture_work_state set buffer=null');
 await deny('contact enrichment remains due',`update fixture_work_state set candidate='${screen}'`);
 await deny('disabled campaign','update fixture_work_state set voice_enabled=false');
 await deny('disabled calling configuration','update icash_voice_configs set enabled=false');
 await deny('expired calling review',`update icash_voice_configs set reviewed_until='${clock}'`);
 await deny('missing calling configuration','delete from icash_voice_configs');
 await deny('disabled calling rate',`update icash_operation_rates set enabled=false where id='${contact}'`);
 await deny('expired calling rate',`update icash_operation_rates set expires_at='${clock}' where id='${contact}'`);
 await deny('unfinished screening',"update icash_screening_jobs set state='running'");
 await deny('no prepared job',"update icash_voice_jobs set state='held'");
 await deny('already attempted job',"update icash_voice_jobs set operation_key='original-unknown'");
 await deny('expired evidence',`update icash_operational_contacts set eligibility_until='${clock}'`);
 await deny('revoked evidence',`update icash_operational_contacts set revoked_at='${completed}'`);
 await deny('wrong source',"update icash_owner_contacts set result='{}'");
 await deny('changed identity',"update icash_customer_identities set principal='different'");
 await deny('unknown recipient timezone',"update icash_operational_contacts set timezone='Invalid/Zone',timezone_basis='recipient'");
 await deny('recipient window open',"update icash_operational_contacts set timezone='Europe/London',timezone_basis='recipient'");
 await deny('old contact backlog',"update icash_operational_contacts set created_at='2026-11-13T02:00:00Z'");
 await deny('future contact timestamp',"update icash_operational_contacts set created_at='2026-11-14T01:00:00Z'");
 await deny('unfinished seller reply',`insert into icash_text_ai_jobs(account_id,state) values('${account}','pending')`);
 await deny('overdue requested callback',`insert into icash_live_callbacks values('${account}','pending_dispatch_review','2026-11-12T12:00:00Z')`);
 for(const col of ['callback_id','sms_source_message_id','cancellation_notice_id'])await deny('requested service '+col,`update icash_voice_jobs set ${col}='${screen}'`);
 await deny('active deal',`insert into icash_deal_files(account_id,stage) values('${account}','under_contract')`);
 await deny('alternate permission',`insert into icash_contact_permissions values('${account}',null,'2026-11-14T13:00:00Z')`);
 await deny('current seller conversation',`insert into icash_live_conversations(account_id,screening_id,state,completed_at,contact_key,conversation_id,result) values('${account}','${screen}','complete','${completed}',encode(sha256(convert_to('+12025550101','UTF8')),'hex'),'fixture-call','{"fixtureSellerResponse":true}')`);
 await deny('a second current channel is open',`insert into icash_operational_contacts select gen_random_uuid(),account_id,screening_id,'sms',phone,'Europe/London','recipient',source_hash,sending_principal,created_at,eligibility_until,revoked_at from icash_operational_contacts`);
 // Regress the production cost bug: cheap exclusions must not evaluate any
 // historical opportunity, enrichment or conversation scans.
 await pg.exec('begin');
 try{
  await pg.exec(`
   create or replace function icash_pending_opportunity_count(uuid) returns integer language plpgsql stable as $$begin raise exception 'unexpected opportunity history scan';end$$;
   create or replace function icash_enrichment_before_prospecting_budget(uuid) returns uuid language plpgsql stable as $$begin raise exception 'unexpected enrichment history scan';end$$;
   create or replace function icash_outreach_active_conversation(p_account uuid,p_screening uuid,p_phone text,p_clock timestamptz default now()) returns boolean language plpgsql stable as $$begin raise exception 'unexpected conversation history scan';end$$;
  `);
  for(const [label,sql] of [
   ['old contacts',"update icash_operational_contacts set created_at='2026-11-13T02:00:00Z'"],
   ['open window',"update icash_operational_contacts set timezone='Europe/London',timezone_basis='recipient'"],
   ['unknown zone',"update icash_operational_contacts set timezone='Invalid/Zone',timezone_basis='recipient'"],
   ['no contacts','delete from icash_operational_contacts'],
   ['no prepared job',"update icash_voice_jobs set state='held'"],
   ['disabled calling','update icash_voice_configs set enabled=false'],
   ['wrong source',"update icash_owner_contacts set result='{}'"],
   ['pending reply',`insert into icash_text_ai_jobs(account_id,state) values('${account}','pending')`],
  ]){
   await pg.exec('savepoint cheap');
   await pg.exec(sql);
   assert.equal(await evidence(),false,label+' skips historical scans');
   await pg.exec('rollback to cheap');
  }
  await assert.rejects(evidence,/unexpected conversation history scan/,'valid evidence still checks live conversations');
 }finally{await pg.exec('rollback');}
 assert.deepEqual(await one("select jsonb_build_object('wallets',(select jsonb_agg(w) from icash_wallets w),'operations',(select jsonb_agg(o) from icash_operation_spend o))"),originalMoney,'observations never change money or original operations');
 // Integration with the actual observation query at the test runner's clock.
 // Pick a real IANA zone that is currently 3 AM; no admission clock is stubbed.
 const utcHour=await one("select extract(hour from now() at time zone 'UTC')::integer");
 let offset=3-utcHour;if(offset < -12)offset+=24;
 const zone=offset===0?'Etc/GMT':`Etc/GMT${offset>0?'-':'+'}${Math.abs(offset)}`;
 await q("update icash_operational_contacts set timezone=$1,timezone_basis='recipient',created_at=now()-interval '2 hours',eligibility_until=now()+interval '1 day'",[zone]);
 await pg.exec("update icash_accounts set created_at=now()-interval '2 days';update icash_operation_spend set settled_at=now()-interval '2 hours';update icash_voice_jobs set due_at=now()-interval '2 hours';");
 await pg.exec('begin');
 try{
  // A fixture-only sequence records evaluation without changing any real work.
  await pg.exec(`create sequence fixture_observation_calls;
   create or replace function icash_reliability_private.account_outreach_wait_evidence(p_account uuid,p_completed timestamptz,p_clock timestamptz default now()) returns boolean
   language plpgsql stable set search_path='' as $$begin perform nextval('public.fixture_observation_calls');return false;end$$;`);
  assert.equal(await one('select count(*) from icash_account_work_observations()'),1);
  assert.equal(await one('select last_value::integer from fixture_observation_calls'),1,'classification evidence is evaluated once per account');
 }finally{await pg.exec('rollback');}
 assert.equal(await one('select count(*) from icash_account_work_observations()'),0,'actual monitor excludes proven scheduled waiting');
 await pg.exec('update icash_voice_configs set enabled=false');
 assert.equal(await one('select reason from icash_account_work_observations()'),'no_completed_work','invalid calling configuration stays observable overnight');
 await pg.exec('update icash_voice_configs set enabled=true');
 await pg.exec('update icash_reliability_private.outreach_wait_settings set enabled=false');
 assert.equal(await one('select reason from icash_account_work_observations()'),'no_completed_work','disabling restores previous observation');
 await pg.exec("update icash_reliability_private.outreach_wait_settings set enabled=true;update icash_discovery_configs set enabled=false");
 assert.equal(await one('select reason from icash_account_work_observations()'),'configuration_disabled');
 await pg.exec("update icash_discovery_configs set enabled=true,data_rights_until=now()-interval '1 day'");
 assert.equal(await one('select reason from icash_account_work_observations()'),'configuration_expired');
 await pg.exec("update icash_discovery_configs set data_rights_until='infinity';update icash_accounts set bot_paused=true");
 assert.equal(await one('select reason from icash_account_work_observations()'),'system_paused');
 await pg.exec("insert into icash_control_events(account_id,action,created_at) select id,'pause',now() from icash_accounts");
 assert.equal(await one('select count(*) from icash_account_work_observations()'),0,'explicit customer Pause remains excluded');
 await pg.exec("delete from icash_control_events;update icash_accounts set bot_paused=false;insert into icash_operation_spend(operation_key,account_id,state,charge_cap_cents,created_at) select 'held-original',id,'dispatched',950,now()-interval '2 hours' from icash_accounts");
 assert.equal(await one('select reason from icash_account_work_observations()'),'pending_work','funds held by original uncertain work remain visible');
 for(const role of ['anon','authenticated']){
  assert.equal(await one("select has_function_privilege($1,'icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz)','execute')",[role]),false);
  assert.equal(await one("select has_function_privilege($1,'icash_reliability_private.account_outreach_wait_evidence(uuid,timestamptz,timestamptz)','execute')",[role]),false);
  assert.equal(await one("select has_table_privilege($1,'icash_reliability_private.outreach_wait_settings','select')",[role]),false);
 }
 console.log('PASS scheduled outreach waits, exact hours, preserved outage reasons, active work, source/identity binding, staged activation, immutable money and private ACLs.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await pg.close();}
