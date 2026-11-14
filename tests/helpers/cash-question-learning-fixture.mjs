import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const before=JSON.parse(read('tests/fixtures/cash-learning-before.json'));
export const extract=(source,name)=>source.match(new RegExp('create (?:or replace )?function (?:public\\.|icash_learning_private\\.)'+name+'\\([\\s\\S]*?(?:\\$\\$|\\$function\\$);','i'))?.[0];
const fn=(p,n)=>extract(read(p),n);
export const setupSql=`create role anon;create role authenticated;create role service_role;`+read('tests/fixtures/shared-learning-schema.sql')+`
create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
alter table icash_seller_opener_assignments add learning_context text,add learning_decision_id bigint,add learning_policy_version text,add learning_selection_mode text,
 add constraint seller_opener_v5_decision_check check((learning_context='identity-v5' and learning_decision_id is not null and learning_policy_version='evidence-v2' and learning_selection_mode is not null)
 or (learning_context<>'identity-v5' and learning_decision_id is null and learning_policy_version is null and learning_selection_mode is null));
alter table icash_seller_opener_assignments alter created_at set default now();
create table icash_sms_seller_openings(thread_id uuid primary key,account_id uuid,owner_question_id uuid,owner_reply_id uuid,interest_message_id uuid);
create table icash_text_suppressions(phone text primary key,reason text,created_at timestamptz default now());
create table icash_contact_suppressions(account_id uuid,contact_key text,source_conversation uuid,created_at timestamptz default now());
create table icash_text_events(id text primary key,type text,payload jsonb,received_at timestamptz default now());
create table icash_text_ai_jobs(id uuid primary key,account_id uuid,thread_id uuid,message_id uuid,outgoing_id uuid,state text,provider_id text,usage jsonb,analysis jsonb,created_at timestamptz);
create table icash_learning_rollups(account_id uuid,domain text,context text,market text,variant text,attempts bigint,pending bigint,positive bigint,opted_out bigint,contract_trials bigint,contracts bigint,closing_trials bigint,closings bigint,cost_cents bigint,costs_complete boolean,updated_at timestamptz default now(),primary key(account_id,domain,context,market,variant));
create table icash_customer_identities(account_id uuid primary key,principal text,company_name text);
create schema icash_learning_policy_private;
create table icash_learning_policy_private.settings(id int primary key,enabled boolean,policy_version text,release_sha text,activated_at timestamptz,evidence_after timestamptz);
insert into icash_learning_policy_private.settings values(1,true,'evidence-v2',repeat('a',40),now()-interval '1 hour',now()-interval '2 hours');
create table icash_learning_policy_private.sms_settings(id int primary key,enabled boolean);insert into icash_learning_policy_private.sms_settings values(1,true);
create table icash_learning_policy_private.cash_question_settings(id int primary key,enabled_at timestamptz);insert into icash_learning_policy_private.cash_question_settings values(1,now()-interval '7 days');
create table icash_learning_policy_private.decisions(id bigint generated always as identity primary key,domain text,context text,market text,policy_version text,decision jsonb,stats jsonb,choices text[],require_contracts boolean,evidence_hash text,created_at timestamptz default now(),unique(domain,context,market,policy_version,evidence_hash));
create schema icash_learning_private;
create table icash_learning_private.policy_releases(release_sha text primary key,completed_at timestamptz,registered_at timestamptz);
insert into icash_learning_private.policy_releases values(repeat('a',40),now()-interval '2 hours',now()-interval '1 hour');
create table icash_learning_private.policy_applications(id bigint generated always as identity primary key,decision_id bigint,source text,source_key text,release_sha text,domain text,context text,market text,policy_version text,variant text,mode text,created_at timestamptz default now(),unique(source,source_key));
create table icash_learning_private.policy_cohorts(domain text,context text,market text,policy_version text,latest_decision_id bigint,latest_application_id bigint,primary key(domain,context,market,policy_version));
create function public.icash_conversation_street(text) returns text language sql immutable as $$select $1$$;
create function public.icash_assign_seller_opener_v5(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function public.icash_seller_sms_learning_plan(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function public.icash_refresh_seller_interest_v5(uuid) returns void language plpgsql as $$begin return;end$$;
create table icash_learning_assignments(account_id uuid,domain text,subject text,context text,market text,variant text,policy_version text,mode text,created_at timestamptz);
create function icash_refresh_learning_before_ranker(uuid) returns void language sql as 'select';
create function icash_refresh_ranker_samples(uuid) returns void language sql as 'select';
create function icash_refresh_learning_account(p_account uuid) returns void language plpgsql as $$begin
 perform public.icash_refresh_learning_before_ranker(p_account);
 perform public.icash_refresh_ranker_samples(p_account);
end $$;

`+
['icash_learning_signature_verified','icash_learning_deal_outcomes'].map(n=>fn('config/platform-shared-learning.sql',n)).join('\n')+
['icash_learning_bounds_v2','icash_learning_decision_v2','icash_shared_learning_stats'].map(n=>fn('config/evidence-weighted-learning-policy.sql',n)).join('\n')+
read('config/seller-response-policy.sql')+read('config/seller-optout-base-verbs.sql')+
fn('supabase/migrations/20261023175907_seller_call_contact_evidence.sql','icash_call_has_seller_response')+
['icash_seller_interest_quote','icash_call_selling_interest'].map(n=>fn('config/seller-interest-evidence.sql',n)).join('\n')+
read('config/seller-interest-reviewed-question.sql')+
fn('config/seller-sms-learning-v5.sql','icash_seller_sms_learning_eligible')+
['icash_seller_cash_questions_enabled','icash_seller_cash_question','icash_seller_cash_identity_reply'].map(n=>fn('config/seller-cash-questions.sql',n)).join('\n')+
[...before].sort((a,b)=>(a.proname==='icash_seller_sms_interest_at'?-1:a.proname==='icash_refresh_seller_interest'?1:0)-(b.proname==='icash_seller_sms_interest_at'?-1:b.proname==='icash_refresh_seller_interest'?1:0)).map(f=>f.definition+';').join('\n')+
fn('config/seller-sms-learning-v5.sql','icash_guard_seller_sms_learning_assignment').replace("(old.learning_context='identity-v5' or new.learning_context='identity-v5')","(old.learning_context in ('identity-v5','cash-question-v6') or new.learning_context in ('identity-v5','cash-question-v6'))")+`
create trigger seller_sms_learning_assignment_immutable before update on icash_seller_opener_assignments for each row execute function icash_guard_seller_sms_learning_assignment();
create trigger seller_sms_learning_application after insert or update on icash_seller_opener_assignments for each row execute function icash_learning_private.record_policy_application();
insert into icash_seller_opener_variants(key,body,enabled) select v,replace(icash_seller_cash_question(v,'ADDRESS'),'ADDRESS','{address}'),true from unnest(array['cash_sale_v6','all_cash_v6','cash_offer_v6'])v;
`;
export const migration=read('config/cash-question-learning.sql');
// Rehearse the complete prior cost migration, including actual shared stats and
// objective cost-scope guards, followed by the exact source-guarded parser patch.
export const costsSetup=read('tests/fixtures/seller-contact-cost-sources.sql')+
 `create table icash_seller_agreement_private.call_history(session_id uuid primary key,account_id uuid,screening_id uuid,contact_key text,conversation_id text,completed_at timestamptz,transcript jsonb);`+
 read('config/seller-call-contact-cost-learning.sql')+
 'create schema icash_reliability_private;'+read('tests/fixtures/seller-interest-cash-offer-before.sql')+';'+`
 create or replace function public.icash_seller_interest_quote(p_result jsonb) returns text
 language plpgsql immutable security invoker set search_path='' as $fn$
 begin
 if jsonb_typeof(p_result->'transcript') is distinct from 'array'
  or p_result->>'contactEvidence' in ('automated_answer','no_response')
  or public.icash_seller_call_disposition(p_result) is not null then return null;end if;
 return icash_reliability_private.seller_interest_quote_from_clear_transcript(p_result);
 end $fn$;`+read('config/seller-interest-cash-offer-statements.sql');
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({setupSql,costsSetup,migration}));
