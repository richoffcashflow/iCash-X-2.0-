create table public.icash_daytime_pacing_settings(id integer primary key check(id=1),enabled boolean not null default true,min_samples_per_hour integer not null default 30 check(min_samples_per_hour>=30),active_deal_reserve_bps integer not null default 2000 check(active_deal_reserve_bps between 0 and 5000));
insert into public.icash_daytime_pacing_settings(id) values(1);
alter table public.icash_daytime_pacing_settings enable row level security;
revoke all on public.icash_daytime_pacing_settings from public,anon,authenticated;
grant all on public.icash_daytime_pacing_settings to service_role;
create index icash_live_seller_pacing_history on public.icash_live_conversations(account_id,created_at) where party='seller' and state='complete';
create function public.icash_voice_daytime_allowance(p_account uuid,p_permission uuid,p_clock timestamptz default now()) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.icash_contact_permissions;c public.icash_daytime_pacing_settings;local_time timestamp;start_h integer;end_h integer;current_h numeric;daily bigint;spent numeric;total_weight numeric:=0;available_weight numeric:=0;weight numeric;h integer;n integer;positive integer;protected boolean;cap bigint;
begin
 select * into p from public.icash_contact_permissions where id=p_permission and account_id=p_account;
 select * into c from public.icash_daytime_pacing_settings where id=1;
 if p.id is null or not exists(select 1 from pg_timezone_names where name=p.timezone) then return jsonb_build_object('allowedCents',0,'reason','timezone_required');end if;
 select daily_limit_cents into daily from public.icash_accounts where id=p_account;
 start_h:=greatest(9,p.local_start_hour);end_h:=least(20,p.local_end_hour);
 local_time:=p_clock at time zone p.timezone;current_h:=extract(hour from local_time)+extract(minute from local_time)/60.0;
 if current_h<start_h or current_h>=end_h or end_h<=start_h then return jsonb_build_object('allowedCents',0,'reason','outside_contact_hours');end if;
 for h in start_h..end_h-1 loop
 select count(*),count(*) filter(where coalesce((v.result->>'interested')::boolean,false)) into n,positive
 from public.icash_live_conversations v join public.icash_voice_jobs j on j.operation_key=v.operation_key and j.account_id=v.account_id join public.icash_contact_permissions cp on cp.id=j.permission_id and cp.account_id=v.account_id
 where v.account_id=p_account and v.party='seller' and v.state='complete' and j.callback_id is null and cp.timezone=p.timezone and v.created_at>=p_clock-interval '90 days' and v.created_at<p_clock
 and extract(hour from v.created_at at time zone cp.timezone)=h
 and (extract(isodow from v.created_at at time zone cp.timezone)<=5)=(extract(isodow from local_time)<=5);
 -- Start evenly. Tilt only after enough account-specific observed outcomes, with bounded smoothing.
 weight:=case when n>=c.min_samples_per_hour then greatest(0.5,least(1.5,((positive+3.0)/(n+10.0))/0.3)) else 1 end;
 total_weight:=total_weight+weight;
 available_weight:=available_weight+weight*greatest(0,least(1,current_h-h+1));
 end loop;
 protected:=exists(select 1 from public.icash_voice_jobs where account_id=p_account and callback_id is not null and state in ('ready','issued','dispatching')) or exists(select 1 from public.icash_deal_files where account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing'));
 cap:=floor(daily*case when protected then (10000-c.active_deal_reserve_bps)/10000.0 else 1 end*available_weight/nullif(total_weight,0));
 select coalesce(sum(case when o.state='settled' then o.charged_cents else o.charge_cap_cents end),0) into spent from public.icash_operation_spend o
 where o.account_id=p_account and ((o.state='settled' and o.settled_at>=date_trunc('day',local_time) at time zone p.timezone) or o.state in ('reserved','dispatched'));
 return jsonb_build_object('allowedCents',greatest(0,cap-spent),'releasedCents',cap,'committedCents',spent,'timezone',p.timezone,'reason','daytime_pacing','protectedForActiveDeals',protected);
end $$;
create function public.icash_reserve_paced_voice(p_account uuid,p_job uuid,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns boolean language plpgsql set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_contact_permissions;r public.icash_operation_rates;a jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' then return false;end if;
 select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=p_account;
 select * into r from public.icash_operation_rates where id=p_rate;
 if p.id is null or r.id is null then return false;end if;
 if p.party='seller' and j.callback_id is null and exists(select 1 from public.icash_daytime_pacing_settings where id=1 and enabled)
 and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id and account_id=p_account) then
 a:=public.icash_voice_daytime_allowance(p_account,p.id);
 if coalesce((a->>'allowedCents')::bigint,0)<r.charge_cents then
 update public.icash_voice_jobs set state='ready',due_at=now()+interval '30 minutes',outcome='Waiting for daytime budget allocation',updated_at=now() where id=j.id;
 return false;
 end if;end if;
 perform public.icash_reserve_operation(p_account,'voice:'||j.id,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
 return true;
end $$;
revoke all on function public.icash_voice_daytime_allowance(uuid,uuid,timestamptz),public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.icash_voice_daytime_allowance(uuid,uuid,timestamptz),public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean) to service_role;
