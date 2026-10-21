import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',s='33333333-3333-4333-8333-333333333333';
const photo={url:'https://img.dealmachine.com/sv/35,-90.jpg',view:'street_view',source:'DealMachine'};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema icash_efficiency_private;grant usage on schema icash_efficiency_private to service_role;
 create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text);
 create table icash_efficiency_private.photo_cache(account_id uuid,screening_id uuid,photo jsonb,expires_at timestamptz,lease uuid);
 alter table icash_efficiency_private.photo_cache enable row level security;
 grant select on public.icash_screening_jobs,icash_efficiency_private.photo_cache to service_role;`);
 const name=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_owner_property_photo_read.sql'));
 await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.query('insert into icash_screening_jobs values($1,$2,$3)',[s,a,'complete']);
 await db.query("insert into icash_efficiency_private.photo_cache values($1,$2,$3,now()-interval '1 day',$4)",[a,s,photo,b]);
 const before=(await db.query('select * from icash_efficiency_private.photo_cache')).rows;
 await db.exec('set role service_role;begin read only;');
 const read=async(account)=>(await db.query('select public.icash_read_photo_cache($1,$2) as photo',[account,s])).rows[0].photo;
 assert.deepEqual(await read(a),photo,'Expired refresh metadata remains displayable without a new lookup');
 assert.equal(await read(b),null,'Another account cannot read the photo');
 await db.exec('commit;reset role;');
 assert.deepEqual((await db.query('select * from icash_efficiency_private.photo_cache')).rows,before,'No lease, expiry or data writes');
 await db.query("update icash_screening_jobs set state='queued' where id=$1",[s]);
 assert.equal(await read(a),null,'Incomplete screening cannot expose stale imagery');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(read(a),/permission denied/);
  await db.exec('reset role');
 }
 const [{prosecdef,provolatile}]=(await db.query("select prosecdef,provolatile from pg_proc where proname='icash_read_photo_cache'")).rows;
 assert.equal(prosecdef,false);assert.equal(provolatile,'s');
 console.log('PASS property photo cache: read-only transaction, account binding, expired metadata, incomplete screening, restricted execution and unchanged cache.');
}finally{await db.close();}
