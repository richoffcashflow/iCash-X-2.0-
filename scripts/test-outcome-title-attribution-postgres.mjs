// Real concurrent title queues on a fixed disposable localhost database only.
// No application environment, provider requests, title emails or billing calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Client}=require(process.env.ICASH_PG_MODULE||'pg');
const cfg={host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',connectionTimeoutMillis:5000};
const clients=[],id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const value=async(c,sql,args=[])=>Object.values((await c.query(sql,args)).rows[0]??{})[0];
const connect=async name=>{
 const c=new Client({...cfg,application_name:'outcome-title-'+name});clients.push(c);await c.connect();
 await c.query("set statement_timeout='10s';set lock_timeout='8s';set timezone='UTC';");return c;
};
try{
 const admin=await connect('admin');
 assert.deepEqual((await admin.query('select current_database() db,current_user username,host(inet_server_addr()) host,inet_server_port() port')).rows[0],
  {db:'icash_reliability',username:'postgres',host:'127.0.0.1',port:55443},'Only the fixed disposable local target may be reset');
 await admin.query('drop schema if exists icash_learning_private cascade;drop schema public cascade;create schema public;');
 await admin.query(`do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
 end$$;
 grant usage on schema public to anon,authenticated,service_role;
 create table icash_accounts(id uuid primary key);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,snapshot jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
 create table icash_disposition_authorities(deal_id uuid primary key,account_id uuid,market text,expires_at timestamptz,purchase_envelope_id uuid);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,state text,test_mode boolean);
 create table icash_title_contacts(deal_id uuid,account_id uuid,enabled boolean,verified_until timestamptz);
 create table icash_operation_spend(operation_key text primary key,state text);
 create table icash_credit_ledger(id uuid,account_id uuid,event_key text,delta_cents bigint);
 `);
 await admin.query(read('config/title-directory.sql'));
 await admin.query(read('config/outcome-title-cost-attribution.sql'));
 await admin.query('insert into icash_accounts values($1)',[id(1)]);
 for(const n of [10,11,12]){
  await admin.query('insert into icash_screening_jobs values($1,$2,$3)',[id(n+1000),id(1),{propertyId:'property-'+n}]);
  await admin.query("insert into icash_deal_files values($1,$2,$3,'under_contract','{\"state\":\"TX\"}')",[id(n),id(1),id(n+1000)]);
  await admin.query("insert into icash_signing_envelopes values($1,$2,'completed',false)",[id(n+2000),id(1)]);
  await admin.query("insert into icash_disposition_authorities values($1,$2,'Dallas',now()+interval '1 day',$3)",[id(n),id(1),id(n+2000)]);
 }
 for(const n of [100,101,102])await admin.query("insert into icash_title_directory(id,domain,name,source_url,public_email,claimed_states,contact_checked_until) values($1,$2,'Fixture Office','https://example.invalid/office','office@example.invalid',array['TX'],now()+interval '1 day')",[id(n),'office-'+n+'.invalid']);
 await admin.query("update icash_title_directory set status='qualified',qualification_evidence='fixture:verified-office',verified_states=array['TX'],verified_until=now()+interval '1 day' where id=$1",[id(101)]);
 const a=await connect('a'),b=await connect('b');
 await Promise.all([a.query('set role service_role'),b.query('set role service_role')]);
 const queue=(client,deal)=>client.query('select icash_queue_title_qualification($1,$2)',[id(1),id(deal)]);
 // Hold the real account/market lock so both independent queue calls reach it
 // before either can insert. Releasing it creates a real two-session race.
 await admin.query('begin');
 await admin.query("select pg_advisory_xact_lock(hashtextextended($1::text||':Dallas',917406251))",[id(1)]);
 const race=[queue(a,10),queue(b,11)].map(p=>p.then(()=>({ok:true}),error=>({error})));
 let waiting=false;
 for(let i=0;i<100;i++){
  waiting=await value(admin,"select count(*)=2 from pg_stat_activity where pid=any($1::integer[]) and wait_event_type='Lock'",[[a.processID,b.processID]]);
  if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.equal(waiting,true,'Both different-deal queues must reach the native lock concurrently');
 assert.equal(await value(admin,'select count(*)::int from icash_title_qualification_jobs'),0,'Blocked queues cannot partially insert work');
 await admin.query('commit');
 for(const result of await Promise.all(race))assert.equal(result.ok,true,result.error?.message);
 const jobs=(await admin.query('select id,company_id,state,provider_id from icash_title_qualification_jobs order by company_id')).rows;
 assert.equal(jobs.length,2,'The original two-office limit is shared by both requests');
 assert.deepEqual(jobs.map(j=>j.company_id),[id(100),id(101)],'Qualified-first selection is preserved');
 assert(jobs.every(j=>j.state==='ready'&&j.provider_id===null),'Queueing does not send title email');
 const origins=(await admin.query('select * from icash_learning_private.title_qualification_origins order by job_id')).rows;
 const reuses=(await admin.query('select * from icash_learning_private.title_qualification_reuses order by job_id,deal_id')).rows;
 assert.equal(origins.length,2);assert.equal(reuses.length,2);
 const winners=new Set(origins.map(o=>o.deal_id));assert.equal(winners.size,1,'One transaction owns both original jobs');
 const winner=origins[0].deal_id,loser=winner===id(10)?id(11):id(10);
 assert([id(10),id(11)].includes(winner));
 for(const j of jobs){
  const own=origins.find(o=>o.job_id===j.id),reuse=reuses.find(r=>r.job_id===j.id);
  assert.equal(own.account_id,id(1));assert.equal(own.deal_id,winner);
  assert.equal(own.screening_id,winner===id(10)?id(1010):id(1011));
  assert.equal(own.property_id,winner===id(10)?'property-10':'property-11');
  assert.equal(reuse.account_id,id(1));assert.equal(reuse.deal_id,loser);
  assert.equal(reuse.screening_id,loser===id(10)?id(1010):id(1011));
  assert.equal(reuse.property_id,loser===id(10)?'property-10':'property-11');
 }
 await Promise.all([queue(a,10),queue(b,11)]);
 assert.deepEqual((await admin.query('select * from icash_learning_private.title_qualification_origins order by job_id')).rows,origins,'Concurrent retries preserve original cost owners and timestamps');
 assert.deepEqual((await admin.query('select * from icash_learning_private.title_qualification_reuses order by job_id,deal_id')).rows,reuses,'Concurrent retries preserve original reuse records');
 await queue(a,12);
 assert.equal(await value(admin,'select count(*)::int from icash_title_qualification_jobs'),2);
 assert.equal(await value(admin,'select count(*)::int from icash_learning_private.title_qualification_reuses where deal_id=$1',[id(12)]),2,'A later third property records reuse without another cost owner');
 await assert.rejects(admin.query('update icash_learning_private.title_qualification_origins set deal_id=$1',[id(12)]),/immutable/);
 await assert.rejects(admin.query('delete from icash_learning_private.title_qualification_reuses'),/immutable/);
 await assert.rejects(a.query('delete from icash_learning_private.title_qualification_origins'),/permission denied/);
 assert.equal(await value(admin,'select count(*)::int from icash_operation_spend'),0,'No billing operation created');
 assert.equal(await value(admin,'select count(*)::int from icash_credit_ledger'),0,'No customer usage charged');
 console.log('PASS native PostgreSQL title attribution: two blocked concurrent deals, exactly two jobs, one immutable origin per job, stable retries/later reuse, service-only writes and zero billing.');
}catch(e){console.error('FAIL native title attribution:',e.message,e.where??'');process.exitCode=1;}
finally{
 await Promise.allSettled(clients.map(c=>c.query('rollback')));
 await Promise.allSettled(clients.map(c=>c.end()));
}
