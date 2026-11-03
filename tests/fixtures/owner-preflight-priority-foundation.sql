-- Synthetic boundary dependencies; real source hashes, retry/current admission,
-- cohort, scheduler and candidate functions are loaded by both test runners.
alter table public.fixture_cleanup_policy add column quota boolean not null default true,
 add column check_quota boolean not null default true,
 add column export_capacity text not null default 'ready',add column people_available boolean not null default true;
create table public.fixture_priority_reads(account_id uuid);
create function public.icash_dealmachine_capacity_available(integer default 1) returns boolean language sql stable
 set search_path='' as $$select quota and ($1<3 or check_quota) from public.fixture_cleanup_policy$$;
create function public.icash_owner_active_export_capacity() returns text language sql stable
 set search_path='' as $$select export_capacity from public.fixture_cleanup_policy$$;
create function public.icash_owner_export_people_available(jsonb) returns boolean language sql stable
 set search_path='' as $$select people_available from public.fixture_cleanup_policy$$;
create function public.icash_settle_pending_dealmachine() returns void language sql as $$select null::void$$;
create function public.icash_daily_work_target(uuid) returns jsonb language sql stable as $$select '{"priorityRatio":1}'::jsonb$$;
create function public.icash_prepare_research_efficiency(uuid) returns void language sql as $$select null::void$$;
create function public.icash_refresh_opportunity_outcomes(uuid) returns void language sql
 set search_path='' as $$insert into public.fixture_priority_reads values($1)$$;
create function public.icash_research_admission_quote(uuid,text,bigint) returns bigint language sql stable as $$select $3$$;
create function public.icash_pending_opportunity_count(uuid) returns integer language sql stable as $$select 0$$;
create function public.icash_outbound_search_due(uuid) returns boolean language sql stable as $$select false$$;
create function public.icash_research_waiting_on_outreach(uuid) returns boolean language sql stable as $$select false$$;
create function public.icash_opportunity_score(uuid,jsonb,text) returns numeric language sql stable
 as $$select coalesce(($2->>'fixtureScore')::numeric,0)$$;

create function public.fixture_preflight_seed(n integer,p_waiting boolean default true,p_overdue interval default interval '2 minutes') returns jsonb
language plpgsql set search_path='' as $$
declare a uuid:=md5('priority-account-'||n)::uuid;r uuid:=md5('priority-rate-'||n)::uuid;
 s uuid:=md5('priority-screening-'||n)::uuid;fresh uuid:=md5('priority-fresh-'||n)::uuid;
 t uuid:=md5('priority-ticket-'||n)::uuid;p uuid:=md5('priority-preflight-'||n)::uuid;
 snapshot jsonb;items jsonb;request jsonb;raw jsonb;name text:='synthetic-list-'||n;
begin
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused)
  values(a,a,'Synthetic scheduler fixture',false);
 insert into public.icash_wallets(account_id,balance_cents) values(a,10000);
 insert into public.icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
  values(r,'owner_enrichment','synthetic-priority-'||n,105,'{"dealmachine":250000}','SYNTHETIC reviewed rate',now()-interval '1 day',now()+interval '1 day',true);
 insert into public.icash_discovery_configs(account_id,enabled,contacts_enabled,zip,rate_id,contact_rate_id,property_credit_micros,contact_credit_cap,data_rights_until,seller_cost_reserve_cents,next_run_at)
  values(a,true,true,'75217',r,r,10000,25,now()+interval '1 day',100000,now()-p_overdue);
 snapshot:=jsonb_build_object('propertyId','prop_'||n,'propertyType','house','fetchedAt',now()-interval '1 hour',
  'raw',jsonb_build_object('data',jsonb_build_object('dm_property_id','prop_'||n,'state','TX','zip','75217')));
 insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
  values(s,a,'synthetic-priority-'||n,snapshot,'complete','{"financialCheck":{"status":"eligible"},"fixtureScore":1}',now()-interval '1 hour'),
  (fresh,a,'synthetic-fresh-'||n,jsonb_set(jsonb_set(snapshot,'{propertyId}',to_jsonb('prop_'||(n+1000000))),'{raw,data,dm_property_id}',to_jsonb('prop_'||(n+1000000))),
   'complete','{"financialCheck":{"status":"eligible"},"fixtureScore":100}',now()-interval '30 minutes');
 if p_waiting then
  insert into public.icash_automation_tickets(id,token,account_id,kind,screening_id,state,outcome,created_at,completed_at,expires_at,
   owner_preview_deferrals,owner_preview_retry_after,owner_preview_retry_until,owner_preview_screening_hash)
   select t,'synthetic-original-token-'||n,a,'contacts',s,'held','owner_preview_rate_limited',now()-interval '8 minutes',now()-interval '7 minutes',now()-interval '7 minutes',
    2,now()-interval '6 minutes',now()+interval '20 hours',public.icash_owner_enrichment_screening_hash(j) from public.icash_screening_jobs j where j.id=s;
  items:=jsonb_build_array(jsonb_build_object('screeningId',s,'snapshot',snapshot,'ids',jsonb_build_array('per_'||n)));
  request:=jsonb_build_object('people_ids',jsonb_build_array('per_'||n),'mobile_only',false,'property_match','owner','anchor','person','require_phone',true,'scrub_dnc',true,'active_phones_only',true);
  raw:=jsonb_build_object('data',jsonb_build_object('list_id',name,'name',name,'source_type','people','status','completed','total_count',1));
  insert into icash_research_private.owner_export_preflights(id,account_id,fingerprint,items,request,state,list_name,list_id,receipts,created_at,started_at,next_check_at)
   values(p,a,md5(jsonb_build_array(items,request)::text),items,request,'waiting',name,to_jsonb(name),jsonb_build_object('create',jsonb_build_object('httpStatus',200,'raw',raw,'rawText',raw::text)),
    now()-interval '8 minutes',now()-interval '8 minutes',now()-interval '6 minutes');
  insert into icash_research_private.owner_export_preflight_items values(p,a,s,md5(snapshot::text));
 end if;
 return jsonb_build_object('account',a,'rate',r,'screening',s,'fresh',fresh,'ticket',t,'preflight',p);
end $$;
