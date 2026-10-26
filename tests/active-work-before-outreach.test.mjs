// Real active-work selectors over synthetic local queues; no provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const baseline=JSON.parse(read('tests/fixtures/active-work-before-outreach-baseline.json')),sql=read('config/active-work-before-outreach.sql');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=uid(1);
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_voice_scheduler(id int,last_dispatch_at timestamptz);insert into icash_voice_scheduler values(1,null);
 create table icash_operating_budget(id int,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);insert into icash_accounts(id) values('${account}');
 create table icash_wallets(account_id uuid,balance_cents bigint);insert into icash_wallets values('${account}',10000);
 create table icash_operation_spend(operation_key text,state text,charged_cents bigint);insert into icash_operation_spend values('unknown','dispatched',null);
 create table icash_text_ai_jobs(id uuid primary key,account_id uuid,thread_id uuid,state text default 'pending',next_attempt_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now());
 create table icash_text_threads(id uuid primary key,paused boolean default false,ai_mode text default 'auto');
 create table icash_operation_rates(id uuid primary key,enabled boolean default true,expires_at timestamptz default now()+interval '1 day');insert into icash_operation_rates(id) values('${uid(2)}');
 create table icash_text_ai_settings(enabled boolean,rate_id uuid);insert into icash_text_ai_settings values(true,'${uid(2)}');
 create table icash_title_followup_settings(id int,enabled boolean);insert into icash_title_followup_settings values(1,true);
 create table icash_deal_files(id uuid primary key,account_id uuid,stage text default 'under_contract');
 create table icash_title_tasks(id uuid primary key,account_id uuid,deal_id uuid,kind text default 'follow_up',state text default 'scheduled',due_date date default (now() at time zone 'America/Chicago')::date,email_retry_at timestamptz default now(),email_state text default 'waiting',updated_at timestamptz default now());
 create table icash_fulfillment_jobs(id uuid primary key,account_id uuid,state text default 'ready',updated_at timestamptz default now());
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,text_ai_job_id uuid,title_task_id uuid,fulfillment_job_id uuid,created_at timestamptz default now(),token text default gen_random_uuid()::text);
 create table fixture_receipts(ready boolean);insert into fixture_receipts values(false);
 create function icash_issue_due_signing_result() returns jsonb language sql as $$select case when ready then '{"token":"original-receipt"}'::jsonb end from public.fixture_receipts$$;
 create function icash_issue_due_voice_result() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_issue_ready_voice_ticket() returns jsonb language sql as $$select '{"token":"new-voice"}'::jsonb$$;
 create function icash_next_before_unstarted_sms_recovery() returns jsonb language sql as $$select '{"token":"new-text"}'::jsonb$$;
 create function icash_next_before_fulfillment() returns jsonb language sql as $$select '{"token":"old-fallback"}'::jsonb$$;
 create function icash_queue_fulfillment() returns void language sql as $$select$$;
 `);
 for(const definition of Object.values(baseline))await pg.exec(definition);
 for(const name of Object.keys(baseline))await pg.exec(`revoke all on function ${name}() from public,anon,authenticated;grant execute on function ${name}() to service_role;`);
 const add=async(kind,n)=>{
  const id=uid(n);
  if(kind==='text_ai'){await q('insert into icash_text_threads(id) values($1)',[id]);await q('insert into icash_text_ai_jobs(id,account_id,thread_id) values($1,$2,$1)',[id,account]);}
  if(kind==='title_followup'){await q('insert into icash_deal_files(id,account_id) values($1,$2)',[id,account]);await q('insert into icash_title_tasks(id,account_id,deal_id) values($1,$2,$1)',[id,account]);}
  if(kind==='fulfillment')await q('insert into icash_fulfillment_jobs(id,account_id) values($1,$2)',[id,account]);
 };
 const picked=async()=>{const result=await one('select icash_next_outreach_channel()');return ['new-voice','new-text','original-receipt'].includes(result?.token)?result.token:result?.token?one('select kind from icash_automation_tickets where token=$1',[result.token]):null;};
 for(const kind of ['text_ai','title_followup','fulfillment'])await isolated(async()=>{await add(kind,100);assert.equal(await picked(),'new-voice','reproduces active work being skipped behind sustained outreach');assert.equal(await one('select count(*) from icash_automation_tickets'),0);});
 await pg.exec(sql);
 const specs=[['icash_next_before_inventory','icash_issue_due_text_ai','icash_next_before_text_ai'],['icash_next_before_text_ai','icash_issue_due_title_followup','icash_next_before_title_followup'],['icash_next_before_title_followup','icash_issue_ready_fulfillment','icash_next_before_fulfillment']];
 for(const [old,helper,tail] of specs)assert.equal(await one(`select pg_get_functiondef('${helper}()'::regprocedure)`),baseline[old].replace('FUNCTION public.'+old+'()','FUNCTION public.'+helper+'()').replace('return public.'+tail+'();','return null;'),'original active-work selection and retry rules remain exact');
 for(const kind of ['text_ai','title_followup','fulfillment'])await isolated(async()=>{
  await add(kind,100);await add(kind,101);
  assert.equal(await picked(),kind);assert.equal(await picked(),'new-voice','existing per-kind issuance interval prevents starving outreach');
  assert.equal(await one('select count(*) from icash_automation_tickets'),1);
 });
 await isolated(async()=>{
  await add('text_ai',100);await add('title_followup',101);await add('fulfillment',102);
  await pg.exec('update fixture_receipts set ready=true');assert.equal(await picked(),'original-receipt');
  await pg.exec('update fixture_receipts set ready=false');
  assert.equal(await picked(),'text_ai');assert.equal(await picked(),'title_followup');assert.equal(await picked(),'fulfillment');assert.equal(await picked(),'new-voice');
 });
 for(const kind of ['text_ai','title_followup','fulfillment'])await isolated(async()=>{await add(kind,100);await pg.exec('update icash_accounts set bot_paused=true');assert.equal(await picked(),'new-voice','paused account work is not issued');assert.equal(await one('select count(*) from icash_automation_tickets'),0);});
 for(const blocker of ['thread','rate','disabled','issued'])await isolated(async()=>{
  await add('text_ai',100);await pg.exec({thread:'update icash_text_threads set paused=true',rate:"update icash_operation_rates set expires_at=now()-interval '1 second'",disabled:'update icash_text_ai_settings set enabled=false',issued:"update icash_text_ai_jobs set state='issued'"}[blocker]);
  assert.equal(await picked(),'new-voice');assert.equal(await one('select count(*) from icash_automation_tickets'),0);
 });
 for(const blocker of ['future','closed','disabled','issued'])await isolated(async()=>{
  await add('title_followup',100);await pg.exec({future:"update icash_title_tasks set due_date=due_date+1",closed:"update icash_deal_files set stage='closed'",disabled:'update icash_title_followup_settings set enabled=false',issued:"update icash_title_tasks set email_state='issued'"}[blocker]);
  assert.equal(await picked(),'new-voice');assert.equal(await one('select count(*) from icash_automation_tickets'),0);
 });
 await isolated(async()=>{await add('fulfillment',100);await pg.exec("update icash_fulfillment_jobs set state='issued'");assert.equal(await picked(),'new-voice');});
 assert.equal(await one("select icash_next_before_inventory()->>'token'"),'old-fallback','original empty-chain fallthrough remains intact');
 assert.equal(await one('select balance_cents from icash_wallets'),10000);assert.equal(await one('select state from icash_operation_spend'),'dispatched');
 for(const role of ['anon','authenticated'])for(const [,helper] of specs)assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,helper+'()']),false);
 assert.equal(sql,read('supabase/migrations/20261026175052_active_work_before_outreach.sql'));
 console.log('Active work priority: due text AI, title follow-up and fulfillment progress before new outreach while receipts, original intervals, Pause, configuration, retry gates and money holds remain intact. Local fixtures only.');
}finally{await pg.close();}
