import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=await PGlite.create();
try {
 await db.exec(`create schema icash_research_private;
 create table icash_text_threads(id integer, sender text,recipient text,retired_at timestamptz,account_id integer);
 create table icash_customer_update_deliveries(id integer,sender text,recipient text,channel text,authorized_at timestamptz);
 create table icash_research_private.owner_exports(id uuid primary key,completed_at timestamptz);
 insert into icash_text_threads select g,'+12145550100','+1'||(3000000000+g)::text,case when g%2=0 then now() end,g%7 from generate_series(1,25000) g;
 insert into icash_customer_update_deliveries select g,'+12145550100','+1'||(3000000000+g)::text,case when g%3=0 then 'email' else 'sms' end,case when g%5<>0 then now() end from generate_series(1,5000) g;
 insert into icash_research_private.owner_exports select md5(g::text)::uuid,case when g%2=0 then now() end from generate_series(1,5000) g;
 analyze;`);
 const queries=[
  `select id from icash_text_threads where sender='+12145550100' and recipient='+13000000002' and (account_id<>1 or retired_at is null)`,
  `select id from icash_customer_update_deliveries where sender='+12145550100' and recipient='+13000000002' and channel='sms' and authorized_at is not null`,
  `select id from icash_research_private.owner_exports where id::text=md5('2')::uuid::text and completed_at is not null`,
  `select id from icash_research_private.owner_exports where id::text='malformed-original-id' and completed_at is not null`,
 ];
 const before=await Promise.all(queries.map(q=>db.query(q)));
 await db.exec(readFileSync('config/scheduler-routing-lookup-indexes.sql','utf8'));
 const after=await Promise.all(queries.map(q=>db.query(q)));
 assert.deepEqual(after.map(x=>x.rows),before.map(x=>x.rows));
 assert.equal(after[0].rows[0].id,2,'Retired other-account conversation remains binding');
 assert.equal(after[3].rows.length,0,'Malformed saved identity remains a nonmatch');
 const indexes=['icash_text_threads_all_number_pairs','icash_customer_update_authorized_sms_pair','owner_export_completed_text_identity'];
 for(let i=0;i<3;i++) {
  const plan=await db.query('explain (format json) '+queries[i]);
  assert(JSON.stringify(plan.rows).includes(indexes[i]),'Planner uses '+indexes[i]);
 }
 await db.exec(`set plan_cache_mode=force_generic_plan; prepare pair(text,text) as select id from icash_text_threads where sender=$1 and recipient=$2 and (account_id<>1 or retired_at is null);`);
 const generic=await db.query("explain (format json) execute pair('+12145550100','+13000000002')");
 assert(JSON.stringify(generic.rows).includes(indexes[0]),'Generic plan retains indexed historical routing');
 console.log('Scheduler lookup indexes: historical routing, financial identity, unchanged results and indexed generic plans passed');
} finally {await db.close();}
