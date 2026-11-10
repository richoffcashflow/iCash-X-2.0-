// Real intake schema, original submit and limiter, plus the new accounting RPC.
// No provider, call-now grant, lookup, or network work is possible in this fixture.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',account='48dfb798-8c1a-404f-88c0-c396cc067062';
export function botDemoRetryFixture(){
 const schema=read('supabase/migrations/20261004170451_seller_intake_and_budgeted_lead_assignment.sql');
 const start=schema.indexOf('create table public.icash_seller_intakes (');
 const limits=read('supabase/migrations/20260928031246_icash_verified_funding_and_accounts.sql');
 const submit=read('config/bot-demo-intake.sql');
 // Preserve the real existing submit exactly here. The separate integration
 // suite verifies the distinct-run/lifecycle replacement against this wrapper.
 const definition=submit.slice(submit.indexOf('create function public.icash_submit_bot_demo_intake'),submit.indexOf('-- Preserve the current assignment'));
 assert(definition.includes('Submission retry mismatch'));
 return `
 do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;
 alter role service_role bypassrls;
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
 create table icash_screening_jobs(id uuid primary key);
 create table icash_operation_spend(operation_key text primary key);
 create table icash_timezone_names(name text);insert into icash_timezone_names values('America/Chicago'),('America/New_York');
 insert into icash_accounts values('${account}','${owner}');
 ${schema.slice(start,schema.indexOf(';',start)+1)}
 alter table icash_seller_intakes add column email_consented boolean,add column contact_consent_scope text;
 ${limits.slice(limits.indexOf('create table public.icash_request_limits'),limits.indexOf('create function public.icash_settle_funding'))}
 ${definition}
 ${read('config/bot-demo-retry-accounting.sql')}
 grant usage on schema public to service_role;grant all on all tables in schema public to service_role;
 revoke all on function icash_take_request(text,integer,integer) from public,anon,authenticated;
 grant execute on function icash_take_request(text,integer,integer) to service_role;
 `;
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(botDemoRetryFixture());
