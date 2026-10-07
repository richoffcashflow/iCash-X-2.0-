import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const one=async(s,p=[])=>(await pg.query(s,p)).rows[0];
const a=randomUUID(),t=randomUUID(),old=randomUUID();
try{
await pg.exec(`create role anon;create role authenticated;create role service_role;
create table icash_accounts(id uuid primary key);
create table icash_operating_budget(id integer primary key);insert into icash_operating_budget values(1);
create table icash_operation_rates(id uuid primary key default gen_random_uuid(),operation text,version text unique,charge_cents bigint,costs_micros jsonb,buffer_bps integer,evidence_ref text,verified_at timestamptz,expires_at timestamptz,enabled boolean,flat_customer_price_cents bigint);
create table icash_text_ai_settings(id integer primary key,model text,rate_id uuid);
insert into icash_text_ai_settings values(1,'gpt-4.1-mini',null);
create table icash_text_threads(id uuid primary key,account_id uuid,sms_rate_id uuid,paused boolean default false,manual_only boolean default false,ai_mode text default 'auto',retired_at timestamptz,seller_intake_id uuid,seller_sms_rate_hash text,seller_sms_price_micros bigint,operational_contact_id uuid,operational_sms_rate_hash text,operational_sms_price_micros bigint);
create table icash_communication_prices(operation text primary key,customer_micros bigint);insert into icash_communication_prices values('sms_segment',90000);
create table icash_text_messages(id uuid primary key default gen_random_uuid(),account_id uuid,thread_id uuid,direction text,state text,provider_id text,last_delivery_at timestamptz,customer_price_micros bigint);
create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,state text,reserved_micros bigint,charge_cap_cents bigint,standard_cost_multiplier numeric,customer_price_micros bigint,charged_cents bigint,actual_micros bigint,cost_basis text);
create table icash_text_ai_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,provider_id text,usage jsonb);
create table icash_fractional_credit_carry(account_id uuid primary key,remaining_micros bigint default 0);
create table icash_fractional_usage(operation_key text primary key,account_id uuid,price_micros bigint,charged_cents bigint);
create function icash_sms_thread_review_current(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
create function icash_claim_text_ai_before_campaign(p_account uuid,p_job uuid) returns jsonb language plpgsql as $$declare c public.icash_text_ai_settings;begin
 if not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation='sms_ai' and enabled and expires_at>now()) then return null;end if;
 return null;end$$;
create function icash_save_text_ai(uuid,uuid,jsonb,text,text,jsonb) returns void language plpgsql as $$begin null;end$$;
create function icash_settle_estimated_operation(text) returns boolean language sql as $$select false$$;
-- Ledger delegate is a spy; use the real fractional wrapper around it.
create function icash_settle_costs_before_fractional(p_operation text,p_charge bigint,p_components jsonb,p_evidence text) returns void language plpgsql set search_path='' as $$begin
 update public.icash_operation_spend set state='settled',charged_cents=p_charge,actual_micros=(p_components->'llm'->>'amountMicros')::bigint where operation_key=p_operation;
end$$;`);
const fractional=read('config/communication-fractional-billing.sql');
await pg.exec(fractional.slice(fractional.indexOf('create function public.icash_settle_complete_costs'),fractional.indexOf('revoke all on function public.icash_snapshot_sms_price')));
await pg.query('insert into icash_accounts values($1)',[a]);
await pg.query("insert into icash_operation_rates values($1,'sms_send','original',9,'{\"llm\":20000,\"messaging\":10000,\"other\":0}',0,'Existing reviewed transport estimate',now(),now()+interval '7 days',true,null)",[old]);
await pg.query('insert into icash_text_threads(id,account_id,sms_rate_id,seller_intake_id,seller_sms_price_micros) values($1,$2,$3,$4,90000)',[t,a,old,randomUUID()]);
const delivered=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,provider_id,customer_price_micros) values($1,$2,'outgoing','delivered','sent',90000) returning id",[a,t])).id;
const ready=(await one("insert into icash_text_messages(account_id,thread_id,direction,state,customer_price_micros) values($1,$2,'outgoing','ready',90000) returning id",[a,t])).id;
await pg.exec(read('config/sms-ai-token-billing.sql'));
assert.equal((await one('select customer_micros from icash_communication_prices')).customer_micros,30000);
assert.equal((await one('select customer_price_micros from icash_text_messages where id=$1',[delivered])).customer_price_micros,90000,'delivered pricing remains immutable');
assert.equal((await one('select customer_price_micros from icash_text_messages where id=$1',[ready])).customer_price_micros,30000);
const ai=(await one('select rate_id from icash_text_ai_settings')).rate_id;
assert.equal((await one('select charge_cents from icash_operation_rates where id=$1',[ai])).charge_cents,6);
async function settle(multiplier,input=1000,cached=500,output=100){
 const j=randomUUID(),provider='chatcmpl-'+j;
 await pg.query('insert into icash_text_ai_jobs values($1,$2,$3,$4)',[j,a,provider,{prompt_tokens:input,prompt_tokens_details:{cached_tokens:cached},completion_tokens:output}]);
 await pg.query("insert into icash_operation_spend(operation_key,account_id,rate_id,state,reserved_micros,charge_cap_cents,standard_cost_multiplier) values($1,$2,$3,'dispatched',20000,6,$4)",['sms-ai:'+j,a,ai,multiplier]);
 const result=(await one('select icash_settle_sms_ai_tokens($1,$2) ok',[a,j])).ok;
 return {j,result,row:await one('select * from icash_operation_spend where operation_key=$1',['sms-ai:'+j])};
}
let x=await settle(3);assert.equal(x.result,true);assert.equal(x.row.actual_micros,410);assert.equal(x.row.customer_price_micros,1230);assert.equal(x.row.charged_cents,0);
const carry=(await one('select remaining_micros from icash_fractional_credit_carry')).remaining_micros;
assert.equal((await one('select icash_settle_sms_ai_tokens($1,$2) ok',[a,x.j])).ok,true);assert.equal((await one('select remaining_micros from icash_fractional_credit_carry')).remaining_micros,carry,'retry cannot debit twice');
x=await settle(2.4);assert.equal(x.row.customer_price_micros,984,'VIP is twenty percent less');
x=await settle(3,46000,0,800);assert.equal(x.result,true);assert.equal(x.row.actual_micros,19680);assert.equal(x.row.customer_price_micros,59040);assert.ok(x.row.charged_cents<=6);
for(const args of [[3,46001,0,100],[3,1000,1001,100],[3,1000,0,801]]){x=await settle(...args);assert.equal(x.result,false);assert.equal(x.row.state,'dispatched');assert.equal((await one('select icash_settle_estimated_operation($1) ok',['sms-ai:'+x.j])).ok,false,'invalid token receipts never bill the maximum estimate');}
assert.equal((await one("select count(*)::int n from information_schema.routine_privileges where routine_name='icash_settle_sms_ai_tokens' and grantee in ('PUBLIC','anon','authenticated')")).n,0);
console.log('PASS token billing SQL: rate split, preserved delivered prices, actual input/cache/output cost, 3x/2.4x, fractional carry, idempotency, reservation cap, invalid receipt holds and no maximum-estimate fallback. Ledger delegate simulated.');
}catch(e){console.error(e.stack,e.where??'');process.exitCode=1;}finally{await pg.close();}
