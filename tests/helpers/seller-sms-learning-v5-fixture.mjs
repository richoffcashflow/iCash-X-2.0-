import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setupSql as footerSetup,migration as footerMigration,seedSql as footerSeed,queueSql,expected as legacyBody} from './seller-opener-footer-free-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
// The actual queue/candidate/price/route/observation implementations are reused.
// Decision scoring is a separate explicit boundary here: this fixture supplies
// reviewed decision results so allocation, audit binding and native races can
// exercise every state without duplicating the evidence-policy implementation.
export const setupSql=footerSetup+footerMigration+`
alter table public.icash_accounts add owner_user_id uuid not null default gen_random_uuid();
alter table public.icash_screening_jobs add event_key text not null default 'discovery:fixture';
create table public.icash_funding_orders(account_id uuid,mode text,state text);
create schema icash_learning_policy_private;
create table icash_learning_policy_private.settings(id integer primary key,enabled boolean);
insert into icash_learning_policy_private.settings values(1,true);
create table icash_learning_policy_private.decisions(id bigint generated always as identity primary key,domain text,context text,market text,stats jsonb,choices text[],decision jsonb);
create table public.fixture_sms_policy(id int primary key,decision jsonb);
insert into public.fixture_sms_policy values(1,'{"policyVersion":"evidence-v2","status":"explore","winner":null,"objective":"positive","reason":"fixture","allowedChoices":["identity_as_is_v5","identity_cash_v5","identity_timing_v5"]}');
create function public.icash_shared_learning_stats(text,text,text) returns jsonb language sql stable set search_path='' as $$select '[]'::jsonb$$;
create function public.icash_learning_decision_v2(p_stats jsonb,p_choices text[],p_require_contracts boolean default false) returns jsonb language sql stable set search_path='' as $$
 select jsonb_set(decision,'{allowedChoices}',coalesce((select jsonb_agg(c order by c) from unnest(p_choices) c where decision->'allowedChoices' ? c),'[]')) from public.fixture_sms_policy where id=1
$$;
create function public.icash_record_learning_decision(p_domain text,p_context text,p_market text,p_stats jsonb,p_choices text[],p_require_contracts boolean default false) returns bigint language plpgsql set search_path='' as $$declare result bigint;begin
 insert into icash_learning_policy_private.decisions(domain,context,market,stats,choices,decision) values(p_domain,p_context,p_market,p_stats,p_choices,public.icash_learning_decision_v2(p_stats,p_choices,p_require_contracts)) returning id into result;return result;end$$;
grant usage on schema icash_learning_policy_private to service_role;
grant select on icash_learning_policy_private.settings to service_role;
grant select,insert on icash_learning_policy_private.decisions to service_role;
grant usage,select on all sequences in schema icash_learning_policy_private to service_role;
grant select on public.fixture_sms_policy,public.icash_funding_orders to service_role;
revoke all on function public.icash_shared_learning_stats(text,text,text),public.icash_learning_decision_v2(jsonb,text[],boolean),public.icash_record_learning_decision(text,text,text,jsonb,text[],boolean) from public,anon,authenticated;
grant execute on function public.icash_shared_learning_stats(text,text,text),public.icash_learning_decision_v2(jsonb,text[],boolean),public.icash_record_learning_decision(text,text,text,jsonb,text[],boolean) to service_role;
`;
export const migration=read('config/seller-sms-learning-v5.sql');
export const seedSql=footerSeed;
export const enableSql='select public.icash_set_seller_sms_learning_enabled(true);';
export const candidateSql='select public.icash_seller_opener_candidate_body(account_id,id) from public.icash_text_threads';
export {queueSql,legacyBody};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({setupSql,migration,seedSql,queueSql,candidateSql,enableSql,legacyBody}));
