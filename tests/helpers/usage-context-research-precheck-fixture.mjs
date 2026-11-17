import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const migration=read('config/usage-context-research-precheck.sql');
export const migrationPath='supabase/migrations/20261117042031_usage_context_research_precheck.sql';
export const sources=JSON.parse(read('tests/fixtures/usage-context-research-before.json'));
export const value=async(db,s,a=[])=>Object.values((await db.query(s,a)).rows[0]??{})[0];
export const uid=n=>`00000000-0000-4000-9000-${String(n).padStart(12,'0')}`;
export const signature='public.icash_usage_loop_context(uuid,uuid)';
export const definition=db=>value(db,'select pg_get_functiondef($1::regprocedure)',[signature]);
export const account=uid(830001),user=uid(830002),rate=uid(830003);
export const context=(db,name='icash_usage_loop_context')=>value(db,`select public.${name}($1,$2)`,[account,user]);
export const evidence=db=>value(db,`select jsonb_build_object(
 'accounts',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_accounts t),
 'configs',(select jsonb_agg(to_jsonb(t) order by account_id) from public.icash_discovery_configs t),
 'rates',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_operation_rates t),
 'operations',(select jsonb_agg(to_jsonb(t) order by operation_key) from public.icash_operation_spend t),
 'jobs',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_screening_jobs t),
 'tickets',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_automation_tickets t),
 'messages',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_text_messages t))`);
export async function installUsageResearchFixture(db){
 await db.exec(read('tests/fixtures/usage-context-research-foundation.sql'));
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create schema icash_work_private;create table icash_work_private.continuation_policy(id integer primary key,enabled boolean,issued bigint);
 insert into icash_work_private.continuation_policy values(1,true,0);
 create schema icash_ranker_private;
 create table icash_ranker_private.samples(account_id uuid,property_key text,cohort text,model_id uuid,prediction double precision);
 create table icash_ranker_private.settings(id integer primary key,enabled boolean,active_model uuid);
 create table icash_ranker_private.runs(id uuid primary key,status text,created_at timestamptz);
 create table public.icash_network_buyers(id uuid,user_id uuid,email text,paused boolean,expires_at timestamptz,zips text[],property_types text[],available_deals integer,max_price_cents bigint,max_repairs_cents bigint);
 create table public.icash_email_suppressions(email text);
 create table public.icash_opportunity_outcomes(account_id uuid,zip text,research_source boolean,discovered_at timestamptz,eligible boolean,responded boolean,opted_out boolean,attempted boolean,purchase_signed boolean,interested boolean);
 create table public.icash_automation_tickets(id uuid,screening_id uuid,account_id uuid,kind text,state text,outcome text,issue_attempts integer,
  owner_preview_deferrals integer,owner_preview_retry_after timestamptz,owner_preview_retry_until timestamptz,owner_preview_screening_hash text);
 create table public.icash_owner_contacts(account_id uuid,screening_id uuid,created_at timestamptz);
 alter table public.icash_operation_rates add column charge_cents bigint default 100;
 create function public.icash_shared_learning_stats(text,text,text) returns jsonb language sql stable as $$select '[]'::jsonb$$;
 create function public.icash_learning_lower(numeric,numeric) returns numeric language sql immutable as $$select 0::numeric$$;
 create function public.icash_research_state_allowed(text) returns boolean language sql stable as $$select $1='TX'$$;
 create function public.icash_owner_enrichment_screening_hash(public.icash_screening_jobs) returns text language sql stable as $$select md5(to_jsonb($1)::text)$$;
 create function public.icash_owner_enrichment_retry_current(uuid,uuid) returns boolean language sql stable as $$select false$$;
 create function public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid) returns boolean language sql stable as $$select false$$;
 create function public.icash_owner_preflight_empty(uuid,uuid,jsonb) returns boolean language sql stable as $$select false$$;
 create function public.icash_owner_preflight_due_at(uuid,uuid) returns timestamptz language sql stable as $$select null::timestamptz$$;
 create function icash_work_private.continued_owner_handoff_current(uuid,uuid) returns boolean language sql stable as $$select true$$;
 create function icash_work_private.live_owner_preflight_deadline(uuid,uuid) returns timestamptz language sql stable as $$select null::timestamptz$$;
 create function icash_work_private.continued_owner_preflight_deadline(uuid,uuid) returns timestamptz language sql stable as $$select null::timestamptz$$;
 create function public.icash_research_waiting_on_outreach(uuid) returns boolean language sql stable as $$select false$$;
 create function public.icash_prospecting_available(uuid) returns bigint language sql stable as $$select 100000::bigint$$;
 create function public.icash_research_admission_quote(uuid,text,bigint) returns bigint language sql stable as $$select $3$$;
 create function public.icash_dealmachine_capacity_available(integer,uuid) returns boolean language sql stable as $$select true$$;
 create function public.icash_owner_active_export_capacity(uuid) returns text language sql stable as $$select 'ready'::text$$;
 create function icash_work_private.owner_preflight_step_due(uuid) returns boolean language sql stable as $$select false$$;
 create function public.icash_owner_preflight_step_capacity(uuid,uuid) returns boolean language sql stable as $$select false$$;`);
 const order=['icash_opportunity_market_score_local','icash_opportunity_market_score_before_demand','icash_current_buyer_demand',
  'icash_opportunity_market_score','icash_opportunity_score_before_demand','icash_opportunity_score_before_ranker','icash_opportunity_score',
  'icash_enrichment_before_prospecting_budget','icash_enrichment_before_provider_quota','icash_enrichment_candidate','icash_usage_loop_context'];
 for(const name of order){
  const source=sources.find(s=>s.signature.startsWith(name+'('));assert(source,name);
  await db.exec(source.definition);
  await db.exec(`revoke all on function ${source.signature} from public,anon,authenticated,service_role;grant execute on function ${source.signature} to service_role;`);
  assert.equal(await value(db,'select md5(pg_get_functiondef($1::regprocedure))',[source.signature]),source.md5,name);
 }
 await db.exec((await definition(db)).replace('FUNCTION public.icash_usage_loop_context(p_account uuid, p_user uuid)',
  'FUNCTION public.fixture_usage_context_before(p_account uuid, p_user uuid)'));
 await db.exec('revoke all on function public.fixture_usage_context_before(uuid,uuid) from public,anon,authenticated;grant execute on function public.fixture_usage_context_before(uuid,uuid) to service_role;');
 await db.query('insert into public.icash_accounts(id,owner_user_id) values($1,$2)',[account,user]);
 await db.query('insert into public.fixture_gates(account_id) values($1)',[account]);
 await db.query("insert into public.icash_customer_identities values($1,'Synthetic business')",[account]);
 await db.query("insert into public.icash_operation_rates values($1,'owner_enrichment',true,now()-interval '1 day',now()+interval '1 day',100)",[rate]);
 await db.query("insert into public.icash_discovery_configs values($1,$2,true,true,true,now()+interval '1 day')",[account,rate]);
 await db.exec('grant usage on schema public,auth,icash_work_private,icash_ranker_private to service_role;grant select on all tables in schema public,auth,icash_work_private,icash_ranker_private to service_role;');
}
export async function seedResearch(db,count=30){
 await db.query(`insert into public.icash_screening_jobs(id,account_id,state,snapshot,completed_at,result)
 select ('00000000-0000-4000-9000-'||lpad((840000+n)::text,12,'0'))::uuid,$1,'complete',
  jsonb_build_object('propertyId','synthetic-'||n,'propertyType','house','raw',jsonb_build_object('data',jsonb_build_object('state','TX','zip','75001'))),
  now()-interval '1 hour',jsonb_build_object('property',jsonb_build_object('propertyId','synthetic-'||n),
   'financialCheck',jsonb_build_object('status','eligible'),'preliminarySellerCeilingCents',10000000)
 from generate_series(1,$2::integer) n`,[account,count]);
}
export async function instrumentScoring(db){
 const original=sources.find(s=>s.signature==='icash_opportunity_market_score(uuid,text)').definition;
 await db.exec(`create sequence public.fixture_market_score_calls;
 create function public.fixture_market_score_probe() returns numeric language plpgsql volatile as $$begin
  perform nextval('public.fixture_market_score_calls');perform pg_advisory_xact_lock(684203114);return 0;end$$;
 grant usage,select on public.fixture_market_score_calls to service_role;`);
 await db.exec(original.replace(' select 0.8*',' select public.fixture_market_score_probe()+0.8*'));
}
export const resetScoring=db=>db.exec("select setval('public.fixture_market_score_calls',1,false)");
export const scoringCalls=db=>value(db,'select case when is_called then last_value else 0 end::int from public.fixture_market_score_calls');
