// In-memory fixtures only. No calls, provider requests, or production data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema icash_recording_private;
 create table public.icash_call_recordings(id integer primary key,from_phone text,provider_account_sid text);
 create table public.icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table public.icash_text_threads(account_id uuid,deal_id uuid,recipient text,sender text,sender_pool_assigned boolean,retired_at timestamptz,party text);`);
 await pg.exec(readFileSync('supabase/migrations/20261008192616_business_voice_numbers.sql','utf8'));
 const ac='AC'+'a'.repeat(32),pn='PN'+'b'.repeat(32);
 await assert.rejects(pg.query('insert into icash_call_recordings values(1,$1,$2,null)',['+14244377030',ac]),/verification required/);
 await pg.query('select icash_save_business_voice_number($1,null,true,false)',[ac]);
 await assert.rejects(pg.query('insert into icash_call_recordings values(1,$1,$2,null)',['+14244377030',ac]),/verification required/);
 await pg.query('select icash_save_business_voice_number($1,$2,true,true)',[ac,pn]);
 await pg.query('select icash_save_business_voice_number($1,$2,true,true)',[ac,pn]);
 assert.equal((await pg.query('select count(*)::int n from icash_business_voice_numbers')).rows[0].n,1);
 await pg.query('insert into icash_call_recordings values(1,$1,$2,null)',['+14244377030',ac]);
 assert.equal((await pg.query('select caller_id_sid from icash_call_recordings where id=1')).rows[0].caller_id_sid,pn);
 await assert.rejects(pg.query('update icash_call_recordings set caller_id_sid=null where id=1'),/immutable/);
 await pg.query('insert into icash_call_recordings values(2,$1,$2,null)',['+14243948384',ac]);
 await assert.rejects(pg.query('insert into icash_call_recordings values(3,$1,$2,null)',['+14244377030','AC'+'c'.repeat(32)]),/verification required/);
 for(const role of ['anon','authenticated']){
  await pg.exec('set role '+role);
  await assert.rejects(pg.query('select * from icash_business_voice_numbers'),/permission denied/);
  await assert.rejects(pg.query('select icash_save_business_voice_number($1,$2,true,true)',[ac,pn]),/permission denied/);
  await pg.exec('reset role');
 }
 const a='11111111-1111-4111-8111-111111111111',s='22222222-2222-4222-8222-222222222222',d='33333333-3333-4333-8333-333333333333';
 await pg.query('insert into icash_deal_files values($1,$2,$3)',[d,a,s]);
 await pg.query('insert into icash_text_threads values($1,$2,$3,$4,true,null,\'seller\')',[a,d,'+12125550100','+14244377030']);
 const read=async(account,screen,phone)=>(await pg.query('select icash_property_voice_threads($1,$2,$3) v',[account,screen,phone])).rows[0].v;
 assert.deepEqual(await read(a,s,'+12125550100'),[{sender:'+14244377030',sender_pool_assigned:true}]);
 assert.deepEqual(await read(s,s,'+12125550100'),[]);assert.deepEqual(await read(a,a,'+12125550100'),[]);assert.deepEqual(await read(a,s,'+12125550101'),[]);
 await pg.exec('update icash_text_threads set retired_at=now()');assert.deepEqual(await read(a,s,'+12125550100'),[]);
 console.log('PASS SQL: caller verification and account binding, immutable historical receipts, private permissions, idempotent setup and exact property/thread routing');
}finally{await pg.close();}
