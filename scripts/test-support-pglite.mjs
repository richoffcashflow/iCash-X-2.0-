// Local PostgreSQL/WASM verification only. No external services or credentials.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
const path=process.argv[2];if(!path||!isAbsolute(path))throw Error('Supply an existing official PGlite module path');
const {PGlite}=await import(pathToFileURL(path).href);const pg=await PGlite.create();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scalar=async(q,args)=>(await pg.query(q,args)).rows[0];
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table public.icash_accounts(id uuid primary key,owner_user_id uuid references auth.users(id),bot_paused boolean default false);
 create table public.icash_daily_plans(id uuid primary key,account_id uuid references public.icash_accounts(id),state text,mode text);
 create table public.icash_trusted_operators(user_id uuid primary key,revoked_at timestamptz,expires_at timestamptz,scopes text[] not null default '{}');
 grant usage on schema public,auth to service_role;grant all on all tables in schema public,auth to service_role;`);
 await pg.exec(readFileSync(new URL('../config/support-center.sql',import.meta.url),'utf8'));
 await pg.query('insert into auth.users values ($1,$2,now()),($3,$4,now())',[id(1),'one@example.com',id(2),'two@example.com']);
 await pg.query('insert into icash_accounts values ($1,$2,false),($3,$4,false)',[id(11),id(1),id(12),id(2)]);
 await pg.query('insert into icash_daily_plans values ($1,$2,$3,$4),($5,$2,$3,$6)',[id(20),id(11),'active','live',id(21),'test']);
 await pg.exec('set role service_role');
 const begin=(account,user,request,message='Why paused?',thread=null)=>scalar('select icash_support_begin_message($1,$2,$3,$4,$5) as result',[account,user,thread,request,message]);
 await assert.rejects(begin(id(11),id(2),id(30)));
 const first=(await begin(id(11),id(1),id(30))).result;assert.equal(first.replay,false);const thread=first.threadId;
 assert.equal((await begin(id(11),id(1),id(30))).result.replay,true);
 await assert.rejects(begin(id(11),id(1),id(30),'Changed request'));
 await assert.rejects(begin(id(12),id(2),id(31),'Steal',thread));
 await pg.query('select icash_support_finish_message($1,$2,$3,$4,$5,$6)',[id(11),id(1),thread,id(30),'Direct check: paused','[]']);
 assert.equal((await begin(id(11),id(1),id(30))).result.response.content,'Direct check: paused');
 assert.equal((await scalar("select count(*)::int as n from icash_support_messages")).n,2);
 for(let i=31;i<36;i++)await begin(id(11),id(1),id(i));
 assert.equal((await begin(id(11),id(1),id(36))).result.rateLimited,true);
 await pg.query('select icash_support_request_email_cancel($1,$2,$3)',['one@example.com',id(40),'live']);
 await pg.query('select icash_support_request_email_cancel($1,$2,$3)',['one@example.com',id(40),'live']);
 assert.equal((await scalar('select count(*)::int as n from icash_support_cancel_requests')).n,1);
 assert.equal((await scalar('select bot_paused from icash_accounts where id=$1',[id(11)])).bot_paused,false,'Email never pauses');
 assert.equal((await scalar('select state from icash_daily_plans where id=$1',[id(20)])).state,'active','Email never stops renewals');
 const request=(await scalar('select id from icash_support_cancel_requests')).id,nonce='a'.repeat(64);
 await assert.rejects(pg.query('select icash_support_prepare_cancel($1,$2,$3,$4,$5)',[id(12),id(2),'live',request,nonce]));
 await pg.query('select icash_support_prepare_cancel($1,$2,$3,$4,$5)',[id(11),id(1),'live',request,nonce]);
 await assert.rejects(pg.query('select icash_support_prepare_cancel($1,$2,$3,$4,$5)',[id(11),id(1),'test',request,nonce]));
 assert.equal((await scalar('select icash_support_claim_cancel($1,$2,$3,$4,$5) as ok',[id(11),id(1),'test',request,nonce])).ok,false,'Cross-mode claim denied');
 assert.equal((await scalar('select icash_support_claim_cancel($1,$2,$3,$4,$5) as ok',[id(11),id(1),'live',request,'b'.repeat(64)])).ok,false);
 assert.equal((await scalar('select icash_support_claim_cancel($1,$2,$3,$4,$5) as ok',[id(11),id(1),'live',request,nonce])).ok,true);
 assert.equal((await scalar('select icash_support_claim_cancel($1,$2,$3,$4,$5) as ok',[id(11),id(1),'live',request,nonce])).ok,false,'Consumed token cannot replay');
 assert.equal((await scalar('select bot_paused from icash_accounts where id=$1',[id(11)])).bot_paused,true);
 assert.equal((await scalar('select state from icash_daily_plans where id=$1',[id(20)])).state,'stop_requested');
 assert.equal((await scalar('select state from icash_daily_plans where id=$1',[id(21)])).state,'active','Live cancellation cannot touch test daily plans');

 assert.equal((await scalar('select bot_paused from icash_accounts where id=$1',[id(12)])).bot_paused,false);
 await assert.rejects(pg.query('select icash_support_operator_update($1,$2,$3,$4,$5)',[id(1),thread,'resolved','No membership',id(50)]));
 await pg.query("insert into icash_trusted_operators(user_id,expires_at,scopes) values($1,now()+interval '1 day',ARRAY['authority_review'])",[id(2)]);
 await assert.rejects(pg.query('select icash_support_operator_update($1,$2,$3,$4,$5)',[id(2),thread,'resolved',null,id(53)]),'Authority reviewers have no support access by default');
 await pg.query("update icash_trusted_operators set scopes=ARRAY['support'] where user_id=$1",[id(2)]);
 await pg.query('select icash_support_operator_update($1,$2,$3,$4,$5)',[id(2),thread,'waiting_on_customer','Please describe the last step.',id(51)]);
 assert.equal((await scalar('select status from icash_support_threads where id=$1',[thread])).status,'waiting_on_customer');
 await pg.query('update icash_trusted_operators set revoked_at=now() where user_id=$1',[id(2)]);
 await assert.rejects(pg.query('select icash_support_operator_update($1,$2,$3,$4,$5)',[id(2),thread,'resolved',null,id(52)]));
 await pg.exec('reset role');
 for(const role of ['anon','authenticated']){
  for(const table of ['icash_support_threads','icash_support_messages','icash_support_cancel_requests']){
   const grants=await scalar("select has_table_privilege($1,$2,'SELECT') as allowed",[role,table]);assert.equal(grants.allowed,false);
  }
  assert.equal((await scalar("select has_function_privilege($1,'icash_support_claim_cancel(uuid,uuid,text,uuid,text)','EXECUTE') as allowed",[role])).allowed,false);
 }
 console.log('Support PostgreSQL: migration applied; owner isolation, replay and rate limits, email request-only safety, atomic one-use cancellation, durable stop queue, operator revocation and browser-role denial passed.');
}finally{await pg.close();}
