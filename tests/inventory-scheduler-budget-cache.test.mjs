import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(s)=>db.query(s),one=async s=>(await q(s)).rows[0];
try{
await db.exec(`
 create table icash_operating_budget(id integer,enabled boolean);
 insert into icash_operating_budget values(1,true);
 create table icash_accounts(id uuid primary key,bot_paused boolean,allowance bigint,waiting boolean,member boolean);
 create table budget_reads(account_id uuid);
 create table icash_automation_tickets(id uuid primary key,account_id uuid,kind text,screening_id uuid,voice_job_id uuid,opener_message_id uuid,state text,outcome text,expires_at timestamptz,created_at timestamptz,completed_at timestamptz,prospecting_quote_cents bigint,token text);
 create table icash_operation_spend(operation_key text primary key);
 create table icash_live_conversations(operation_key text);
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select member from public.icash_accounts where id=$1$$;
 create function icash_research_waiting_on_outreach(uuid) returns boolean language sql as $$select waiting from public.icash_accounts where id=$1$$;
 create function icash_prospecting_available(uuid) returns bigint language plpgsql as $$begin insert into public.budget_reads values($1);return (select allowance from public.icash_accounts where id=$1);end$$;
 insert into icash_accounts select md5(i::text)::uuid,i=1,100,false,i<>2 from generate_series(1,21) i;
 insert into icash_automation_tickets(id,account_id,kind,screening_id,state,outcome,expires_at,created_at,prospecting_quote_cents)
 select gen_random_uuid(),a.id,'contacts',gen_random_uuid(),'held','prospecting_budget_held',now()-interval '1 minute',now()-interval '1 hour',200 from icash_accounts a cross join generate_series(1,30);
`);
await db.exec(read('tests/fixtures/inventory-resume-function.sql'));
await db.exec(read('config/inventory-scheduler-budget-cache.sql'));
assert.equal((await one('select icash_resume_prospecting_ticket() result')).result,null);
assert.deepEqual(await one('select count(*)::integer reads,count(distinct account_id)::integer accounts from budget_reads'),{reads:19,accounts:19},'One allowance computation per eligible account across 630 held tickets');
assert.equal((await one("select count(*)::integer n from icash_automation_tickets where state='held'")).n,630,'Insufficient budgets cannot issue work');
await db.exec("truncate budget_reads;update icash_accounts set allowance=300,waiting=true;");
assert.equal((await one('select icash_resume_prospecting_ticket() result')).result,null,'Pending outreach still blocks new contacts');
await db.exec("update icash_accounts set waiting=false;insert into icash_operation_spend select 'owners:'||account_id||':'||screening_id from icash_automation_tickets;");
assert.equal((await one('select icash_resume_prospecting_ticket() result')).result,null,'Existing uncertain operations are never retried');
await db.exec("delete from icash_operation_spend;truncate budget_reads;");
assert.match((await one('select icash_resume_prospecting_ticket() result')).result.token,/^[a-f0-9-]{72}$/);
assert.equal((await one("select count(*)::integer n from icash_automation_tickets where state='issued'")).n,1,'The existing bounded claim issues one ticket');
console.log('Inventory scheduler: one budget read per account, Pause, membership, outreach priority, insufficient credits and unknown-operation holds passed.');
}finally{await db.close();}
