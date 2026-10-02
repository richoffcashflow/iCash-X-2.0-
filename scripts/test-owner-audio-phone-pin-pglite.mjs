import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
// Local SQL simulation only. PGlite serializes queries: these test both logical
// race orderings, not independent PostgreSQL session/lock contention.
if(!process.argv[2])throw Error('Pass the local PGlite module path');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=await PGlite.create();
const token='a'.repeat(64),account='48dfb798-8c1a-404f-88c0-c396cc067062',user='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
const args=[account,user,'b'.repeat(64),'agtvrsn_pinFixture','private pin fixture','c'.repeat(64),'d'.repeat(64)];
const call='CA'+'e'.repeat(32),conv='conv_pinFixture';
let scenarios=0;
const query=(text,values=[])=>db.query(text,values);
const arm=async()=>(await query('select public.icash_arm_owner_audio_once($1,$2,$3,$4,$5,$6,$7) as r',args)).rows[0].r;
const restore=async(value=token)=>(await query('select public.icash_start_owner_audio_phone_restore($1) as r',[value])).rows[0].r;
const pin=()=>query('insert into public.icash_owner_audio_phone_pin(id,review_token) values(1,$1)',[token]);
const denied=async(fn,pattern=/permission denied|must be owner|duplicate key|Owner phone isolation is unavailable/i)=>{
 await query('savepoint denied_probe');
 try{await assert.rejects(fn,pattern);}finally{await query('rollback to savepoint denied_probe');await query('release savepoint denied_probe');}
};
async function scenario(name,fn){await query('begin');try{await query('set local role service_role');await fn();scenarios++;console.log('PASS '+name);}finally{await query('rollback');}}
async function oldArm(secondsAgo){await query('reset role');try{await query(`insert into public.icash_owner_audio_once
 (id,account_id,owner_user_id,state,config_hash,version_id,branch_name,challenge_salt,challenge_hash,armed_at,expires_at)
 select 1,$1,$2,'armed',$3,$4,$5,$6,$7,t-interval '5 minutes',t
 from (select clock_timestamp()-$8::double precision*interval '1 second' as t) timing`,[...args,secondsAgo]);}finally{await query('set local role service_role');}}
try{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role untrusted;
 grant usage on schema public to public;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 await db.exec(readFileSync('config/owner-audio-once.sql','utf8'));
 await db.exec(readFileSync('config/owner-audio-phone-pin.sql','utf8'));
 await scenario('ACLs survive permissive defaults; only service insert/read and restore RPC',async()=>{
  for(const role of ['anon','authenticated','untrusted']){await query(`set local role ${role}`);await denied(()=>query('select * from public.icash_owner_audio_phone_pin'));await denied(()=>pin());await denied(()=>restore());await denied(()=>query('select public.icash_owner_audio_pin_arm_guard()'));}
  await query('set local role service_role');await pin();assert.equal((await query('select * from public.icash_owner_audio_phone_pin')).rows.length,1);
  for(const stmt of ["insert into public.icash_owner_audio_phone_pin(id,review_token) values(1,repeat('b',64))","update public.icash_owner_audio_phone_pin set review_token=repeat('b',64)",'update public.icash_owner_audio_phone_pin set restore_started_at=null','delete from public.icash_owner_audio_phone_pin','truncate public.icash_owner_audio_phone_pin','select public.icash_owner_audio_pin_arm_guard()'])await denied(()=>query(stmt));
  const functions=(await query(`select proname,prosecdef,proconfig from pg_proc where proname in ('icash_owner_audio_pin_arm_guard','icash_start_owner_audio_phone_restore')`)).rows;
  assert.equal(functions.length,2);for(const fn of functions){assert.equal(fn.prosecdef,true);assert.deepEqual(fn.proconfig,['search_path=""']);}
 });
 await scenario('no pin cannot arm or restore; mismatching/null token cannot close gate',async()=>{
  await denied(()=>arm());assert.equal(await restore(),false);await pin();assert.equal(await restore('wrong'),false);assert.equal(await restore(null),false);assert.equal((await arm()).state,'armed');
 });
 await scenario('restore wins before arm; delayed stale arm cannot insert',async()=>{
  await pin();assert.equal(await restore(),true);const first=(await query('select restore_started_at from public.icash_owner_audio_phone_pin')).rows[0].restore_started_at;assert(first);
  await denied(()=>arm());assert.equal((await query('select * from public.icash_owner_audio_once')).rows.length,0);assert.equal(await restore(),true);assert.deepEqual((await query('select restore_started_at from public.icash_owner_audio_phone_pin')).rows[0].restore_started_at,first);
 });
 await scenario('arm wins before restore; active run holds restoration',async()=>{
  await pin();assert.equal((await arm()).state,'armed');assert.equal(await restore(),false);assert.equal((await query('select restore_started_at from public.icash_owner_audio_phone_pin')).rows[0].restore_started_at,null);
  await query('select public.icash_attempt_owner_audio_once($1,$2)',[call,conv]);assert.equal(await restore(),false);
  await query('select public.icash_claim_owner_audio_once($1,$2,$3,$4)',[call,conv,args[2],args[3]]);assert.equal(await restore(),false);
  await query('select public.icash_finish_owner_audio_once($1,$2,$3)',[call,conv,JSON.stringify({status:'needs_review',forwarding:'unverified',durationSeconds:null,challenge:'unverified'})]);assert.equal(await restore(),false);
 });
 for(const state of ['passed','failed'])await scenario(`${state} terminal result permits exact restoration`,async()=>{
  await pin();await arm();await query('select public.icash_attempt_owner_audio_once($1,$2)',[call,conv]);await query('select public.icash_claim_owner_audio_once($1,$2,$3,$4)',[call,conv,args[2],args[3]]);
  await query('select public.icash_finish_owner_audio_once($1,$2,$3)',[call,conv,JSON.stringify({status:state,forwarding:'unverified',durationSeconds:20,challenge:state})]);assert.equal(await restore(),true);await denied(()=>arm());
 });
 await scenario('fresh cancellation still waits through bounded uncertainty window',async()=>{await pin();await arm();await query('select public.icash_cancel_owner_audio_once($1,$2)',[account,user]);assert.equal(await restore(),false);});
 await scenario('expired armed row still holds for 90-second tail',async()=>{await pin();await oldArm(30);assert.equal(await restore(),false);});
 await scenario('expired armed row past 90-second tail permits restore',async()=>{await pin();await oldArm(100);assert.equal(await restore(),true);await denied(()=>arm());});
 await scenario('rolled-back restore start does not leave a phantom closed gate',async()=>{await pin();await query('savepoint restore_attempt');assert.equal(await restore(),true);await query('rollback to savepoint restore_attempt');await query('release savepoint restore_attempt');assert.equal((await arm()).state,'armed');assert.equal(await restore(),false);});
 await scenario('rolled-back arm allows restore to win and excludes later arm',async()=>{await pin();await query('savepoint arm_attempt');await arm();await query('rollback to savepoint arm_attempt');await query('release savepoint arm_attempt');assert.equal(await restore(),true);await denied(()=>arm());});
 console.log(`Phone pin SQL: ${scenarios} local ACL, lifecycle, race-ordering and rollback scenarios passed; real multi-session contention remains untested`);
}finally{await db.close();}
