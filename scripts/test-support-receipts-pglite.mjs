// Isolated Postgres only. No provider requests, credentials or production state.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
const path=process.argv[2];if(!path||!isAbsolute(path))throw Error('Supply an existing official PGlite module path');
const {PGlite}=await import(pathToFileURL(path).href);const pg=await PGlite.create();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scalar=async(q,args)=>(await pg.query(q,args)).rows[0];
const receive=async(n,email='one@example.com',mode='live')=>{await pg.query('select icash_support_request_email_cancel($1,$2,$3)',[email,id(n),mode]);return (await scalar('select id from icash_support_cancel_requests where provider_email_id=$1',[id(n)]))?.id;};
const claim=async(n,mode='live')=>(await scalar('select icash_support_claim_cancel_receipt($1,$2) as job',[id(n),mode])).job;
const finish=async(request,provider=null)=>pg.query('select icash_support_finish_cancel_receipt($1,$2)',[request,provider]);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid references auth.users(id),bot_paused boolean default false);
 create table public.icash_daily_plans(id uuid primary key,account_id uuid references public.icash_accounts(id),state text,mode text);
 create table public.icash_trusted_operators(user_id uuid primary key,revoked_at timestamptz,expires_at timestamptz,scopes text[] not null default '{}');
 grant usage on schema public,auth to service_role;grant all on all tables in schema public,auth to service_role;`);
 const sql=readFileSync(new URL('../config/support-center.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql); // reapplication must preserve data/grants and succeed
 await pg.query('insert into auth.users values ($1,$2,now()),($3,$4,now())',[id(1),'one@example.com',id(2),'two@example.com']);
 await pg.query('insert into icash_accounts values ($1,$2,false),($3,$4,false)',[id(11),id(1),id(12),id(2)]);
 await pg.query("insert into icash_daily_plans values ($1,$2,'active','live')",[id(21),id(11)]);
 await pg.exec('set role service_role');
 assert.equal(await claim(99),null);assert.equal(await receive(99,'nobody@example.com'),undefined);
 const request=await receive(30);
 assert.equal(await claim(30,'test'),null,'Mode isolation');
 const raced=await Promise.all([claim(30),claim(30)]);assert.equal(raced.filter(Boolean).length,1,'Duplicate delivery claims at most one receipt');
 const job=raced.find(Boolean);assert.deepEqual(job,{id:request,recipient:'one@example.com'},'Recipient comes from verified auth owner');
 assert.equal((await scalar('select state from icash_support_cancel_requests where id=$1',[request])).state,'awaiting_confirmation');
 assert.equal((await scalar('select bot_paused from icash_accounts where id=$1',[id(11)])).bot_paused,false);assert.equal((await scalar('select state from icash_daily_plans where id=$1',[id(21)])).state,'active');
 await finish(request);assert.equal((await scalar('select receipt_state from icash_support_cancel_requests where id=$1',[request])).receipt_state,'needs_review');assert.equal(await claim(30),null,'Failure/ambiguity never authorizes a resend');
 await finish(request,id(80));assert.equal((await scalar('select receipt_state from icash_support_cancel_requests where id=$1',[request])).receipt_state,'needs_review','A late finish cannot override a consumed failure');
 const hourly=await receive(31);assert.equal(await claim(31),null);assert.equal((await scalar('select receipt_state from icash_support_cancel_requests where id=$1',[hourly])).receipt_state,'rate_limited');
 await pg.query("update icash_support_cancel_requests set created_at=now()-interval '2 hours',receipt_claimed_at=case when receipt_claimed_at is not null then now()-interval '2 hours' end");
 for(const n of [32,33]){const r=await receive(n);assert((await claim(n))?.id===r);await finish(r,id(n+100));await pg.query("update icash_support_cancel_requests set created_at=now()-interval '2 hours',receipt_claimed_at=case when receipt_claimed_at is not null then now()-interval '2 hours' end");}
 const daily=await receive(34);assert.equal(await claim(34),null);assert.equal((await scalar('select receipt_state from icash_support_cancel_requests where id=$1',[daily])).receipt_state,'rate_limited','Maximum three receipts/account/24 hours including failures');
 // A changed owner is re-resolved and cannot receive the old owner's request.
 const changed=await receive(40,'two@example.com');await pg.query('update icash_accounts set owner_user_id=$1 where id=$2',[id(1),id(12)]);assert.equal(await claim(40),null);assert.equal((await scalar('select receipt_state from icash_support_cancel_requests where id=$1',[changed])).receipt_state,'needs_review');await pg.query('update icash_accounts set owner_user_id=$1 where id=$2',[id(2),id(12)]);
 // Existing notification suppression is read, never changed, and prevents receipts.
 await pg.exec('reset role');await pg.exec('create table icash_attention_email_preferences(account_id uuid primary key,consent_email text,suppressed_at timestamptz);grant select on icash_attention_email_preferences to service_role;');await pg.query('insert into icash_attention_email_preferences values ($1,$2,now())',[id(12),'two@example.com']);await pg.exec('set role service_role');
 const suppressed=await receive(41,'two@example.com');assert.equal(await claim(41),null);assert.equal((await scalar('select receipt_state from icash_support_cancel_requests where id=$1',[suppressed])).receipt_state,'suppressed');assert((await scalar('select suppressed_at from icash_attention_email_preferences where account_id=$1',[id(12)])).suppressed_at);
 // Permission failures are not interpreted as a clean suppression check.
 await pg.exec('reset role;revoke select on icash_attention_email_preferences from service_role;set role service_role');await receive(42,'two@example.com');await assert.rejects(claim(42));await pg.exec('reset role;grant select on icash_attention_email_preferences to service_role;');await pg.query('delete from icash_attention_email_preferences where account_id=$1',[id(12)]);await pg.exec('set role service_role');
 await pg.query("insert into icash_support_cancel_requests(account_id,user_id,mode,source,receipt_state,receipt_claimed_at) select $1,$2,'live','email','accepted',now() from generate_series(1,100)",[id(11),id(1)]);
 assert.equal(await claim(42),null);assert.equal((await scalar('select receipt_state from icash_support_cancel_requests where provider_email_id=$1',[id(42)])).receipt_state,'rate_limited','Global receipt budget is bounded to 100/24 hours');
 await pg.exec('reset role');
 for(const role of ['anon','authenticated'])for(const fn of ['icash_support_claim_cancel_receipt(uuid,text)','icash_support_finish_cancel_receipt(uuid,uuid)'])assert.equal((await scalar("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,fn])).allowed,false);
 console.log('Support receipt PostgreSQL: re-runnable additive schema, verified-owner routing, one-use concurrent claims, failure no-resend, hourly/daily/global budgets, owner/mode isolation, suppression fail-closed, unchanged account/plan state and browser-role denial passed.');
}finally{await pg.close();}
