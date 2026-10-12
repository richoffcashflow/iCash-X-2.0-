// Run with an existing local PGlite module. No network or provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=await PGlite.create();
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uuid(900),other=uuid(901);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text);
 create table icash_title_tasks(id uuid primary key,account_id uuid,deal_id uuid,kind text,label text,due_date date,state text,evidence text,email_state text,updated_at timestamptz,created_at timestamptz);`);
 const migration=readFileSync('supabase/migrations/20261012184500_archived_property_attention.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 for(let i=1;i<=16;i++){
  await db.query('insert into icash_screening_jobs values($1,$2,$3)',[uuid(i),i===8?other:account,i<8?'archived':'complete']);
  await db.query('insert into icash_deal_files values($1,$2,$1,$3)',[uuid(i),account,'under_contract']);
  await db.query(`insert into icash_title_tasks values($1,$2,$1,'deadline','Confirm closing date',null,'needs_review','Keep history','waiting',now(),now()+$3*interval '1 second')`,[uuid(i),account,i]);
 }
 const tasks=(offset=0,a=account)=>db.query('select * from icash_closing_task_attention($1,$2,7)',[a,offset]);
 const first=(await tasks()).rows;assert.deepEqual(first.map(r=>r.screening_id),Array.from({length:7},(_,i)=>uuid(9+i)));
 assert.deepEqual((await tasks(7)).rows.map(r=>r.screening_id),[uuid(16)]);
 assert.equal((await tasks(0,other)).rows.length,0);
 await db.query(`update icash_screening_jobs set state='archived' where account_id=$1`,[account]);
 assert.equal((await tasks()).rows.length,0);
 assert.equal((await db.query(`select count(*)::int n from icash_title_tasks where state='needs_review' and evidence='Keep history'`)).rows[0].n,16);
 assert.equal((await db.query(`select has_function_privilege('authenticated','icash_closing_task_attention(uuid,integer,integer)','execute') allowed`)).rows[0].allowed,false);
 assert.equal((await db.query(`select has_function_privilege('service_role','icash_closing_task_attention(uuid,integer,integer)','execute') allowed`)).rows[0].allowed,true);
 console.log('Closing attention SQL: active parents before pagination, tenant isolation, empty archive, preserved history, repeat migration and service-only access passed.');
}finally{await db.close();}
