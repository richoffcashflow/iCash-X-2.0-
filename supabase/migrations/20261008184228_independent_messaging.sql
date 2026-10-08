-- Global messaging owns its settings; Webinar Studio is an enrollment source.
begin;
create table public.icash_messaging_settings (
 id integer primary key check(id=1),config jsonb not null check(jsonb_typeof(config)='object'),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default now()
);
insert into public.icash_messaging_settings(id,config)
select 1,jsonb_build_object('enabled',coalesce(config->'enabled','false'::jsonb),'smsEnabled',coalesce(config->'smsEnabled','false'::jsonb),
 'smartFollowups',coalesce(config->'smartFollowups','true'::jsonb),'fromEmail',config->'fromEmail','postalAddress',config->'postalAddress',
 'subjects',config->'subjects','messages',config->'messages') from public.icash_webinar_settings where id=1;
alter table public.icash_messaging_settings enable row level security;
revoke all on public.icash_messaging_settings from public,anon,authenticated;
grant select,update on public.icash_messaging_settings to service_role;

-- Old open studio tabs cannot overwrite independent messaging settings.
-- Keep a compatibility copy for older deployed workers during the rollout.
create function public.icash_messaging_preserve_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.config:=new.config||coalesce((select config from public.icash_messaging_settings where id=1),'{}'::jsonb);
 return new;
end $$;
create trigger icash_messaging_preserve_settings before update of config on public.icash_webinar_settings
 for each row execute function public.icash_messaging_preserve_settings();

create function public.icash_messaging_save(p_config jsonb,p_customer_enabled boolean,p_revision integer) returns integer
language plpgsql security invoker set search_path='' as $$
declare current_revision integer;
begin
 if p_config is null or jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>12000 or p_customer_enabled is null
  or not(p_config ?& array['enabled','smsEnabled','smartFollowups','fromEmail','postalAddress','subjects','messages'])
  or (p_config-array['enabled','smsEnabled','smartFollowups','fromEmail','postalAddress','subjects','messages'])<>'{}'::jsonb
  or jsonb_typeof(p_config->'enabled')<>'boolean' or jsonb_typeof(p_config->'smsEnabled')<>'boolean'
  or jsonb_typeof(p_config->'smartFollowups')<>'boolean' or jsonb_typeof(p_config->'fromEmail')<>'string'
  or jsonb_typeof(p_config->'postalAddress')<>'string' or jsonb_typeof(p_config->'subjects')<>'array'
  or jsonb_typeof(p_config->'messages')<>'array' then raise exception 'Invalid messaging settings';end if;
 select revision into current_revision from public.icash_messaging_settings where id=1 for update;
 if current_revision is null or current_revision is distinct from p_revision then return null;end if;
 update public.icash_messaging_settings set config=p_config,revision=revision+1,updated_at=now() where id=1 returning revision into current_revision;
 update public.icash_customer_update_settings set enabled=p_customer_enabled where id=1;
 update public.icash_webinar_settings set config=config||p_config,updated_at=now() where id=1;
 return current_revision;
end $$;

-- The final send check reads the authoritative settings directly.
do $$ declare body text;needle text;begin
 select pg_get_functiondef('public.icash_webinar_authorize_followup(uuid,jsonb)'::regprocedure) into strict body;
 needle:='select s.config into config from public.icash_webinar_settings s where id=1;';
 if position(needle in body)=0 then raise exception 'Messaging authorization prerequisite changed';end if;
 execute replace(body,needle,'select s.config into config from public.icash_messaging_settings s where id=1;');
end $$;

-- Independent scan: opted-in customers need no webinar or active bot work.
-- Short durable reservations also coordinate with the existing automation scanner.
create function public.icash_messaging_due_customers(p_limit integer default 50) returns setof uuid
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_customer_update_settings where id=1 and enabled for share;
 if not found then return;end if;
 return query with due as (
  select account_id from public.icash_customer_update_preferences
  where (email_enabled or sms_enabled) and consented_at is not null and next_scan_at<=now()
  order by next_scan_at,account_id limit greatest(1,least(coalesce(p_limit,50),50)) for update skip locked
 ) update public.icash_customer_update_preferences p set next_scan_at=now()+interval '15 minutes'
 from due where p.account_id=due.account_id returning p.account_id;
end $$;
create function public.icash_messaging_customer_stats() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'subscribers',(select count(*) from public.icash_customer_update_preferences where email_enabled or sms_enabled),
  'emails',(select count(*) from public.icash_customer_update_deliveries where channel='email' and state in ('accepted','delivered') and created_at>now()-interval '24 hours'),
  'texts',(select count(*) from public.icash_customer_update_deliveries where channel='sms' and state in ('accepted','delivered') and created_at>now()-interval '24 hours'),
  'needsReview',(select count(*) from public.icash_customer_update_deliveries where state='needs_review')
 );
$$;
revoke all on function public.icash_messaging_preserve_settings(),public.icash_messaging_save(jsonb,boolean,integer),public.icash_messaging_due_customers(integer),public.icash_messaging_customer_stats() from public,anon,authenticated;
grant execute on function public.icash_messaging_preserve_settings(),public.icash_messaging_save(jsonb,boolean,integer),public.icash_messaging_due_customers(integer),public.icash_messaging_customer_stats() to service_role;
commit;
