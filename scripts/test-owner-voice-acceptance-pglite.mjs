// SIMULATION ONLY. Minimal isolated PostgreSQL, no external provider or production calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
try{
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table public.icash_accounts(id uuid primary key,owner_user_id uuid references auth.users(id));');
 await pg.exec(readFileSync('config/owner-voice-acceptance.sql','utf8'));
 const user='00000000-0000-4000-8000-000000000001',account='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
 await pg.query('insert into auth.users values($1),($2)',[user,other]);await pg.query('insert into icash_accounts values($1,$2)',[account,user]);
 await pg.query(`insert into icash_owner_voice_acceptance_config(account_id,owner_user_id,phone,agent_id,phone_number_id,branch_id,branch_name,reviewed_config_hash,reviewed_version_id,approval_ref,expires_at) values($1,$2,'+12145550123','agent_fixture','phnum_fixture','agtbrch_fixture','owner-test-fixture',$3,'agtvrsn_fixture','SIMULATION explicit owner approval',now()+interval '1 hour')`,[account,user,'a'.repeat(64)]);
 const config=async()=> (await pg.query('select to_jsonb(c) c from icash_owner_voice_acceptance_config c')).rows[0].c;
 const claim=async(u=user,h='a'.repeat(64),snapshot)=>{snapshot??=await config();return (await pg.query('select icash_claim_owner_voice_acceptance($1,$2,$3,$4,$5) r',[account,u,h,'agtvrsn_fixture',snapshot])).rows[0].r;};
 assert.equal(await claim(),null,'Default OFF');await pg.exec('update icash_owner_voice_acceptance_config set enabled=true');
 assert.equal(await claim(other),null);assert.equal(await claim(user,'b'.repeat(64)),null);
 const stale=await config();await pg.exec("update icash_owner_voice_acceptance_config set phone='+12145550124'");assert.equal(await claim(user,'a'.repeat(64),stale),null,'Changed destination invalidates preflight');
 await pg.exec('begin');await pg.exec("update icash_owner_voice_acceptance_config set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'");assert.equal(await claim(),null);await pg.exec('rollback');
 const run=await claim();assert(run.id);assert.equal(run.configuration.phone,'+12145550124');assert.equal(await claim(),null);assert.equal((await config()).enabled,false);
 await pg.query('select icash_finish_owner_voice_acceptance($1,$2,$3,null,null)',[account,user,run.id]);
 await pg.exec('update icash_owner_voice_acceptance_config set enabled=true');assert.equal(await claim(),null,'Cannot rearm consumed attempt');
 assert.equal((await pg.query('select state from icash_owner_voice_acceptance_runs')).rows[0].state,'needs_review');
 assert.equal((await pg.query("select has_table_privilege('authenticated','icash_owner_voice_acceptance_config','SELECT') b")).rows[0].b,false);
 assert.equal((await pg.query("select has_function_privilege('anon','icash_claim_owner_voice_acceptance(uuid,uuid,text,text,jsonb)','EXECUTE') b")).rows[0].b,false);
 console.log('Owner acceptance SQL: disabled default, exact owner, hash/version/snapshot, changed-phone/expiry, atomic one-use, permanent uncertain hold and no public grants pass. No provider calls.');
}finally{await pg.close();}
