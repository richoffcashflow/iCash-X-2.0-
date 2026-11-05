import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const sql=readFileSync(new URL('../supabase/migrations/20261105043323_ask_ai_deal_coaching.sql',import.meta.url),'utf8');
const before=readFileSync(new URL('./fixtures/ask-ai-settlement-before.sql',import.meta.url),'utf8');
const db=new PGlite();
await db.exec(`create role service_role; create role anon; create role authenticated;
create table public.icash_operating_budget(id int primary key);insert into public.icash_operating_budget values(1);
create table public.icash_accounts(id uuid primary key);insert into public.icash_accounts values('00000000-0000-4000-8000-000000000001');
create table public.icash_question_usage(question_id uuid primary key,account_id uuid,model text,multiplier numeric,state text default 'reserved',provider_id text,input_tokens bigint,cached_tokens bigint,output_tokens bigint,cost_micros bigint,price_micros bigint,charged_cents bigint,settled_at timestamptz);
create table public.icash_fractional_credit_carry(account_id uuid primary key,remaining_micros bigint default 0);
create table public.fixture_credits(account_id uuid,operation text,amount bigint);
create function public.icash_finish_credit(uuid,text,bigint,text) returns void language sql as 'insert into public.fixture_credits values($1,$2,$3)';
${before}
revoke all on function public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint) to service_role;`);
const original=(await db.query("select md5(pg_get_functiondef('public.icash_settle_question'::regproc)) hash")).rows[0].hash;
assert.equal(original,'7f8205d6d5ea0b113870d1de12df1844','Fixture matches the reviewed production function');
await db.exec('begin;'+sql+'commit;');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=id(1);
for(const [n,input,cached,output,multiplier] of [[2,32000,0,1200,1.4],[3,32000,0,1200,3],[4,1000,500,150,1.4]]){
 await db.query('insert into icash_question_usage(question_id,account_id,model,multiplier) values($1,$2,\'gpt-4.1-mini\',$3)',[id(n),account,multiplier]);
 const params=[account,id(n),'chatcmpl-fixture'+n,input,cached,output];
 const first=(await db.query('select public.icash_settle_question($1,$2,$3,$4,$5,$6) charged',params)).rows[0].charged;
 assert(first<=5);const count=(await db.query('select count(*) n from fixture_credits')).rows[0].n;
 assert.equal((await db.query('select public.icash_settle_question($1,$2,$3,$4,$5,$6) charged',params)).rows[0].charged,first);
 assert.equal((await db.query('select count(*) n from fixture_credits')).rows[0].n,count,'Same receipt settles only once');
 await assert.rejects(db.query('select public.icash_settle_question($1,$2,$3,$4,$5,$6)',[...params.slice(0,5),output-1]),/settlement changed/);
}
await db.query('insert into icash_question_usage(question_id,account_id,model,multiplier) values($1,$2,\'gpt-4.1-mini\',1.4)',[id(8),account]);
for(const [input,cached,output] of [[32001,0,1200],[10,11,100],[1000,0,1201],[1000,0,-1]])await assert.rejects(db.query('select public.icash_settle_question($1,$2,$3,$4,$5,$6)',[account,id(8),'chatcmpl-invalid',input,cached,output]),/Invalid provider token receipt/);
assert.equal((await db.query('select state from icash_question_usage where question_id=$1',[id(8)])).rows[0].state,'reserved');
const roles=(await db.query("select has_function_privilege('anon','public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint)','execute') anon,has_function_privilege('authenticated','public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint)','execute') authenticated,has_function_privilege('service_role','public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint)','execute') service")).rows[0];assert.deepEqual(roles,{anon:false,authenticated:false,service:true});
await assert.rejects(db.exec('begin;'+sql+'commit;'),/settlement changed/);await db.exec('rollback;');
await db.close();console.log('PASS coaching settlement: exact predecessor, 1,200 output tokens within unchanged five-cent cap, original rates/receipts, duplicate settlement and private ACLs.');
