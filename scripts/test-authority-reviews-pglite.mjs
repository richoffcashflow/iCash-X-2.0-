// Isolated PostgreSQL engine. No network, credentials, live records or provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const modulePath=process.argv[2];if(!modulePath||!isAbsolute(modulePath))throw Error('Supply an existing official PGlite module path');
const {PGlite}=await import(pathToFileURL(modulePath).href),pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const table=(file,name)=>{const sql=read(file),start=sql.search(new RegExp(`create table public\\.${name}\\s*\\(`,'i'));assert(start>=0,name);return sql.slice(start,sql.indexOf(';',start)+1);};
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);grant usage on schema public to service_role,anon,authenticated;`);
 for(const [file,names] of [
 ['supabase/migrations/20260928015041_icash_accounts_deals_credit_foundation.sql',['icash_accounts']],
 ['supabase/migrations/20260928220238_screening_job_queue.sql',['icash_screening_jobs']],
 ['supabase/migrations/20260928223811_deal_documents_and_showings.sql',['icash_deal_files']],
 ['config/fulfillment-completion.sql',['icash_buyer_profiles']],
 ['config/live-dispatch.sql',['icash_contact_permissions','icash_offer_authorities']],
 ])for(const name of names)await pg.exec(table(file,name));
 // Real signing and disposition table definitions; the unrelated rate FK is ID-only.
 await pg.exec('create table public.icash_operation_rates(id uuid primary key);');
 for(const name of ['icash_signing_templates','icash_signing_envelopes'])await pg.exec(table('supabase/migrations/20260929001207_ordered_contract_signing.sql',name));
 await pg.exec(table('config/fulfillment-completion.sql','icash_disposition_authorities'));
 await pg.exec(`alter table public.icash_contact_permissions add column buyer_id uuid references public.icash_buyer_profiles(id);
 create table public.icash_contact_suppressions(account_id uuid,contact_key text);create table public.icash_text_suppressions(phone text primary key);
 grant select,insert,update,delete on all tables in schema public to service_role;`);
 await pg.exec(`create table public.icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid);create function public.icash_claim_voice_job(uuid) returns boolean language sql as 'select true';create function public.icash_buyer_voice_context(uuid) returns jsonb language sql as 'select null::jsonb';grant select on public.icash_voice_jobs to service_role;`);
 await pg.exec(read('config/reviewed-action-authority.sql'));
 const result=await pg.exec(read('tests/authority-reviews-database.sql'));
 console.log(result.flatMap(r=>r.rows??[]).map(r=>r.result).filter(Boolean).join('\n'));
 assert.equal((await pg.query('select count(*)::int n from public.icash_trusted_operators')).rows[0].n,0);
 assert.equal((await pg.query('select count(*)::int n from public.icash_authority_review_requests')).rows[0].n,0);
 console.log('Rollback verified. Limits: embedded single-connection PostgreSQL, minimal unrelated FK/auth fixtures; no production advisors, multi-session contention or provider end-to-end proof.');
}catch(e){console.error('ISOLATED_SQL_FAILED',e.message,e.detail??'',e.where??'');process.exitCode=1;}finally{await pg.close();}
