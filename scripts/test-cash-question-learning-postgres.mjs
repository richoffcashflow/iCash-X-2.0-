// Native contention check against a disposable, fixed localhost database only.
// No application env, credentials or provider requests are accepted.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setupSql,costsSetup,migration} from '../tests/helpers/cash-question-learning-fixture.mjs';
const require=createRequire(import.meta.url),{Client}=require(process.env.ICASH_PG_MODULE||'pg');
const cfg={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',connectionTimeoutMillis:5000};
const clients=[];
const connect=async name=>{const c=new Client({...cfg,application_name:'cash-learning-'+name});clients.push(c);await c.connect();await c.query("set statement_timeout='10s';set lock_timeout='8s';");return c;};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',release='a'.repeat(40);
const value=async(c,sql,args=[])=>Object.values((await c.query(sql,args)).rows[0]??{})[0];
try{
 const admin=await connect('admin');
 await admin.query(`drop schema if exists public cascade;create schema public;drop schema if exists icash_learning_policy_private cascade;drop schema if exists icash_learning_private cascade;drop schema if exists icash_recorded_reception_private cascade;drop schema if exists icash_seller_agreement_private cascade;drop schema if exists icash_reception_private cascade;drop schema if exists icash_reliability_private cascade;drop schema if exists icash_contact_refresh_private cascade;drop schema if exists icash_seller_recovery_private cascade;`);
 await admin.query(`do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;`);
 await admin.query(setupSql.replace('create role anon;create role authenticated;create role service_role;','')+costsSetup);
 await admin.query(migration);
 await admin.query('update icash_learning_private.policy_releases set completed_at=clock_timestamp(),registered_at=clock_timestamp()');
 await admin.query('update icash_learning_policy_private.settings set activated_at=clock_timestamp(),evidence_after=clock_timestamp()');
 await admin.query('select icash_activate_cash_question_learning($1,$2,true)',[owner,release]);
 const seed=async n=>{
  const account=id(1),thread=id(n+2);
  await admin.query('insert into icash_accounts(id,owner_user_id) values($1,$2) on conflict do nothing',[account,id(2)]);
  await admin.query("insert into icash_customer_identities values($1,'Fixture Buyer',null) on conflict do nothing",[account]);
  await admin.query("insert into icash_screening_jobs(id,account_id,event_key,snapshot) values($1,$2,'discovery:fixture',$3)",[id(n),account,{propertyId:'fixture-'+n}]);
  await admin.query("insert into icash_deal_files(id,account_id,screening_id,terms,stage) values($1,$2,$3,'{\"address\":\"123 Fixture Street\"}','draft')",[id(n+1),account,id(n)]);
  await admin.query("insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'seller','+12125550100')",[thread,account,id(n+1)]);return {account,thread};
 };
 const a=await connect('a'),b=await connect('b');
 const blocked=async name=>{
  for(let i=0;i<80;i++){
   if(await value(admin,"select exists(select 1 from pg_stat_activity where application_name=$1 and wait_event_type='Lock')",['cash-learning-'+name]))return;
   await new Promise(resolve=>setTimeout(resolve,20));
  }throw new Error('Expected native lock wait');
 };
 const first=await seed(100);
 await a.query('begin');
 const selected=await value(a,'select icash_assign_seller_opener_v6($1,$2)',[first.account,first.thread]);
 await b.query('begin');let done=false;
 const concurrent=value(b,'select icash_assign_seller_opener_v6($1,$2)',[first.account,first.thread]).then(v=>{done=true;return v;});
 await blocked('b');assert.equal(done,false);await a.query('commit');assert.deepEqual(await concurrent,selected);await b.query('commit');
 assert.equal(await value(admin,'select count(*)::int from icash_seller_opener_assignments'),1);
 assert.equal(await value(admin,'select count(*)::int from icash_learning_private.policy_applications'),1,'Concurrent retry cannot duplicate assignment evidence');
 const second=await seed(200);
 await a.query('begin');await a.query('select icash_activate_cash_question_learning($1,$2,false)',[owner,release]);
 const afterPause=value(b,'select icash_assign_seller_opener_v6($1,$2)',[second.account,second.thread]);await blocked('b');await a.query('commit');await afterPause;
 assert.equal(await value(admin,'select learning_decision_id from icash_seller_opener_assignments where thread_id=$1',[second.thread]),null,'Assignment after disable uses original balanced path');
 assert.equal(await value(admin,'select count(*)::int from icash_learning_private.policy_applications'),1);
 assert.deepEqual(await value(admin,'select icash_assign_seller_opener_v6($1,$2)',[first.account,first.thread]),selected,'Cutover cannot reassign prior experiment');
 await assert.rejects(admin.query('update icash_seller_opener_assignments set learning_decision_id=1 where thread_id=$1',[second.thread]),/immutable|relabelled/);
 console.log('PASS native PostgreSQL cash learning: concurrent assignment exactly once, serialized disable/assignment, immutable historical allocation and original fallback.');
}catch(e){console.error('FAIL native cash learning:',e.message,e.where??'');process.exitCode=1;}
finally{await Promise.allSettled(clients.map(c=>c.end()));}
