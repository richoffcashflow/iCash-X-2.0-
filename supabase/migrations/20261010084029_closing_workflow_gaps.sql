begin;
set local lock_timeout='3s';

-- Reading a request is not the same as resolving it.
alter table public.icash_buyer_viewing_requests add column acknowledged_at timestamptz;
alter table public.icash_buyer_viewing_requests add column resolution_note text;
update public.icash_buyer_viewing_requests r set acknowledged_at=r.reviewed_at,state='needs_confirmation',reviewed_at=null
where r.state='reviewed' and exists(select 1 from public.icash_deal_files d where d.id=r.deal_id and d.account_id=r.account_id and d.stage in ('under_contract','buyer_selected','title_open','closing'));
create function public.icash_update_buyer_request(p_account uuid,p_actor uuid,p_request uuid,p_action text,p_note text default '') returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 if p_action not in ('acknowledge','resolve') or (p_action='resolve' and length(btrim(coalesce(p_note,''))) not between 3 and 1000) then raise exception 'Resolution note required';end if;
 update public.icash_buyer_viewing_requests r set acknowledged_at=coalesce(acknowledged_at,now()),
 state=case when p_action='resolve' then 'reviewed' else state end,
 reviewed_at=case when p_action='resolve' then now() else reviewed_at end,
 resolution_note=case when p_action='resolve' then btrim(p_note) else resolution_note end
 where r.id=p_request and r.account_id=p_account and r.state='needs_confirmation'
 and exists(select 1 from public.icash_deal_files d where d.id=r.deal_id and d.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing'));
 return found;
end $$;

-- These tasks also exist before an opening request has been sent to title.
alter table public.icash_title_tasks alter column request_id drop not null;
alter table public.icash_title_tasks drop constraint icash_title_tasks_kind_check;
alter table public.icash_title_tasks add constraint icash_title_tasks_kind_check check(kind in ('follow_up','reply_review','deadline','document_update'));
alter table public.icash_title_tasks add column payload jsonb not null default '{}';
alter table public.icash_title_requests add column delivered_assignment_ids uuid[] not null default '{}';
alter table public.icash_title_requests add column delivered_payout jsonb;
create index icash_title_tasks_updates_due on public.icash_title_tasks(email_retry_at,created_at) where kind='document_update' and state='scheduled';

create function public.icash_sync_title_updates(p_account uuid,p_deal uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare j public.icash_title_requests;e public.icash_signing_envelopes;s public.icash_closing_setup;last_payout jsonb;
begin
 select * into j from public.icash_title_requests where account_id=p_account and deal_id=p_deal and state='sent';
 if not found or not exists(select 1 from public.icash_deal_files where id=p_deal and account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing')) then return;end if;
 update public.icash_title_tasks t set state='cancelled',updated_at=now() where t.account_id=p_account and t.deal_id=p_deal and t.kind='document_update' and t.payload->>'type'='assignment' and t.state='scheduled' and t.email_state in ('waiting','issued')
 and not exists(select 1 from public.icash_signing_envelopes a where a.id=(t.payload->>'envelopeId')::uuid and a.account_id=p_account and a.deal_id=p_deal and a.state='completed' and not a.test_mode);
 for e in select * from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='assignment' and state='completed' and not test_mode loop
  if not e.id=any(j.delivered_assignment_ids) then
   insert into public.icash_title_tasks(account_id,deal_id,request_id,source_key,kind,label,due_date,state,payload)
   values(p_account,p_deal,j.id,'title-assignment:'||j.id||':'||e.id,'document_update','Send signed buyer assignment to title',current_date,'scheduled',jsonb_build_object('type','assignment','envelopeId',e.id)) on conflict(source_key) do nothing;
  end if;
 end loop;
 select * into s from public.icash_closing_setup where account_id=p_account and deal_id=p_deal;
 if s.payout is not null then
  select payload->'payout' into last_payout from public.icash_title_tasks where request_id=j.id and kind='document_update' and payload->>'type'='payout' and email_state='sent' order by updated_at desc,id limit 1;
  last_payout:=coalesce(last_payout,j.delivered_payout);
  update public.icash_title_tasks set state='cancelled',updated_at=now() where request_id=j.id and kind='document_update' and payload->>'type'='payout' and state='scheduled' and email_state in ('waiting','issued') and payload->'payout' is distinct from s.payout-'detailsSharedWithTitle';
  if (last_payout is distinct from s.payout-'detailsSharedWithTitle' or exists(select 1 from public.icash_title_tasks where request_id=j.id and kind='document_update' and payload->>'type'='payout' and email_state in ('dispatching','needs_review') and payload->'payout' is distinct from s.payout-'detailsSharedWithTitle'))
  and not exists(select 1 from public.icash_title_tasks where request_id=j.id and kind='document_update' and payload->>'type'='payout' and state in ('scheduled','needs_review') and payload->'payout'=s.payout-'detailsSharedWithTitle') then
   insert into public.icash_title_tasks(account_id,deal_id,request_id,source_key,kind,label,due_date,state,payload)
   values(p_account,p_deal,j.id,'title-payout:'||j.id||':'||s.updated_at::text,'document_update','Send updated payment preference to title',current_date,'scheduled',jsonb_build_object('type','payout','payout',s.payout-'detailsSharedWithTitle')) on conflict(source_key) do nothing;
  end if;
 end if;
end $$;
create function public.icash_title_updates_trigger() returns trigger language plpgsql security invoker set search_path='' as $$
begin perform public.icash_sync_title_updates(new.account_id,new.deal_id);return new;end $$;
create trigger icash_title_updates_initial after update of state on public.icash_title_requests for each row when(new.state='sent') execute function public.icash_title_updates_trigger();
create trigger icash_title_updates_assignment after insert or update of state on public.icash_signing_envelopes for each row when(new.kind='assignment') execute function public.icash_title_updates_trigger();
create trigger icash_title_updates_payout after insert or update of payout on public.icash_closing_setup for each row execute function public.icash_title_updates_trigger();

-- A prepared attachment/preference must still be current at the final claim.
create function public.icash_claim_title_update(p_account uuid,p_task uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.icash_title_tasks;j public.icash_title_requests;d public.icash_deal_files;c public.icash_title_contacts;prop text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into t from public.icash_title_tasks where id=p_task and account_id=p_account for update;
 if not found or t.kind<>'document_update' or t.state<>'scheduled' or t.email_state<>'issued' or t.payload is distinct from p_payload then return null;end if;
 if not exists(select 1 from public.icash_title_followup_settings where id=1 and enabled) then return null;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return null;end if;
 select * into j from public.icash_title_requests where id=t.request_id and account_id=p_account and deal_id=t.deal_id for share;
 if not found or j.state<>'sent' then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account for share;
 if not found or d.stage not in ('under_contract','buyer_selected','title_open','closing') or not public.icash_title_contact_matches(p_account,d.id,j.recipient) then return null;end if;
 select * into c from public.icash_title_contacts where account_id=p_account and deal_id=d.id and email=j.recipient and enabled and verified_until>now() for share;
 if not found then return null;end if;
 if not exists(select 1 from public.icash_signing_envelopes where id=j.purchase_envelope_id and account_id=p_account and deal_id=d.id and kind='purchase' and state='completed' and not test_mode)
 or not public.icash_signing_action_allowed(p_account,j.purchase_envelope_id) then return null;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=d.screening_id and account_id=p_account;
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=prop and manual) then return null;end if;
 if t.payload->>'type'='assignment' then
  if (select count(*) from public.icash_signing_envelopes where account_id=p_account and deal_id=d.id and kind='assignment' and state='completed' and not test_mode)<>1
  or not exists(select 1 from public.icash_signing_envelopes where id=(t.payload->>'envelopeId')::uuid and account_id=p_account and deal_id=d.id and kind='assignment' and state='completed' and not test_mode)
  or not public.icash_signing_action_allowed(p_account,(t.payload->>'envelopeId')::uuid) then return null;end if;
 elsif t.payload->>'type'='payout' then
  if not exists(select 1 from public.icash_closing_setup where account_id=p_account and deal_id=d.id and payout-'detailsSharedWithTitle'=t.payload->'payout') then return null;end if;
 else return null;end if;
 if not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation='title_email' and enabled and expires_at>now()) then return null;end if;
 perform public.icash_reserve_operation(p_account,'title-followup:'||t.id,c.rate_id,c.verified_until);
 if not public.icash_claim_operation('title-followup:'||t.id) then raise exception 'Update operation already claimed';end if;
 update public.icash_title_tasks set email_state='dispatching',updated_at=now() where id=t.id;
 return jsonb_build_object('requestId',j.id,'recipient',j.recipient,'address',j.property_address);
end $$;

-- Preserve all existing automation branches and their admission controls.
alter function public.icash_next_automation() rename to icash_next_before_closing_gaps;
create function public.icash_next_automation() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.icash_title_tasks;t public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 if exists(select 1 from public.icash_title_followup_settings where id=1 and enabled)
 and not exists(select 1 from public.icash_automation_tickets where kind='title_followup' and created_at>now()-interval '1 minute') then
  select f.* into j from public.icash_title_tasks f join public.icash_accounts a on a.id=f.account_id and not a.bot_paused
  join public.icash_deal_files d on d.id=f.deal_id and d.account_id=f.account_id and d.stage in ('under_contract','buyer_selected','title_open','closing')
  where f.kind='document_update' and f.state='scheduled' and f.email_retry_at<=now()
  and (f.email_state='waiting' or (f.email_state='issued' and f.updated_at<now()-interval '15 minutes'))
  order by f.email_retry_at,f.created_at for update of f skip locked limit 1;
  if found then
   update public.icash_title_tasks set email_state='issued',updated_at=now() where id=j.id;
   insert into public.icash_automation_tickets(account_id,kind,title_task_id) values(j.account_id,'title_followup',j.id) returning * into t;
   return jsonb_build_object('token',t.token);
  end if;
 end if;
 return public.icash_next_before_closing_gaps();
end $$;

-- Signed snapshots are evidence; default draft values are not legal deadlines.
create function public.icash_seed_contract_deadlines(p_envelope uuid) returns void language plpgsql security invoker set search_path='' as $$
declare e public.icash_signing_envelopes;due date;
begin
 select * into e from public.icash_signing_envelopes where id=p_envelope and kind='purchase' and state='completed' and not test_mode;
 if not found or not exists(select 1 from public.icash_deal_files where id=e.deal_id and account_id=e.account_id and stage in ('under_contract','buyer_selected','title_open','closing')) then return;end if;
 begin due:=nullif(e.terms->>'closingDate','')::date;exception when others then due:=null;end;
 insert into public.icash_title_tasks(account_id,deal_id,source_key,kind,label,due_date,state,evidence,payload)
 values(e.account_id,e.deal_id,'contract-closing:'||e.id,'deadline','Confirm the signed contract closing deadline',due,'needs_review','Check the executed purchase agreement and any amendments. A blank date is not a confirmed 30-day deadline.',jsonb_build_object('envelopeId',e.id,'deadline','closing')) on conflict(source_key) do nothing;
 insert into public.icash_title_tasks(account_id,deal_id,source_key,kind,label,state,evidence,payload)
 values(e.account_id,e.deal_id,'contract-inspection:'||e.id,'deadline','Confirm inspection deadline or mark not applicable','needs_review','Check the executed agreement for the effective date, inspection period and how days are counted. Draft inspection-day settings may not be part of the signed form. Dismiss if the agreement has no inspection deadline.',jsonb_build_object('envelopeId',e.id,'deadline','inspection')) on conflict(source_key) do nothing;
end $$;
create function public.icash_contract_deadlines_trigger() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='icash_signing_envelopes' then perform public.icash_seed_contract_deadlines(new.id);
 else perform public.icash_seed_contract_deadlines(e.id) from public.icash_signing_envelopes e where e.account_id=new.account_id and e.deal_id=new.id and e.kind='purchase' and e.state='completed' and not e.test_mode;end if;
 return new;
end $$;
create trigger icash_contract_deadlines_signed after insert or update of state on public.icash_signing_envelopes for each row when(new.kind='purchase' and new.state='completed' and not new.test_mode) execute function public.icash_contract_deadlines_trigger();
create trigger icash_contract_deadlines_stage after update of stage on public.icash_deal_files for each row when(new.stage in ('under_contract','buyer_selected','title_open','closing')) execute function public.icash_contract_deadlines_trigger();

-- Showings require separate, evidenced confirmations from both parties.
alter table public.icash_showing_requests add column version integer not null default 1;
alter table public.icash_showing_requests add column buyer_request_id uuid references public.icash_buyer_viewing_requests(id);
alter table public.icash_showing_requests add column seller_note text;
alter table public.icash_showing_requests add column buyer_note text;
alter table public.icash_showing_requests add column change_note text;
alter table public.icash_showing_requests add column updated_at timestamptz not null default now();
alter table public.icash_showing_requests add column history jsonb not null default '[]';
create index icash_showing_requests_buyer_request on public.icash_showing_requests(buyer_request_id);
create function public.icash_manage_showing(p_account uuid,p_actor uuid,p_deal uuid,p_action text,p_id uuid default null,p_version integer default null,p_data jsonb default '{}') returns uuid
language plpgsql security invoker set search_path='' as $$
declare s public.icash_showing_requests;start_at timestamptz;end_at timestamptz;zone text;note text;r public.icash_buyer_viewing_requests;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 if p_action='propose' and (p_id is not null or p_version is not null) then raise exception 'New visit cannot replace an existing visit';end if;
 perform 1 from public.icash_deal_files where id=p_deal and account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing') for update;
 if not found or not exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and state='completed' and not test_mode and public.icash_signing_action_allowed(p_account,id)) then raise exception 'Active signed contract required';end if;
 if p_action<>'propose' then
  select * into s from public.icash_showing_requests where id=p_id and deal_id=p_deal for update;
  if not found or s.version is distinct from p_version or s.state not in ('proposed','confirmed') then raise exception 'Showing changed; refresh';end if;
  update public.icash_showing_requests set history=history||jsonb_build_array(jsonb_build_object('at',now(),'actor',p_actor,'action',p_action,'previous',to_jsonb(s)-'history')) where id=s.id;
 end if;
 note:=btrim(coalesce(p_data->>'note',''));
 if p_action in ('propose','reschedule') then
  zone:=p_data->>'timezone';
  if not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'Valid timezone required';end if;
  if coalesce(p_data->>'start','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' or coalesce(p_data->>'end','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' then raise exception 'Exact local times required';end if;
  start_at:=(p_data->>'start')::timestamp at time zone zone;end_at:=(p_data->>'end')::timestamp at time zone zone;
  if start_at<=now() or end_at<=start_at or end_at>start_at+interval '4 hours' or to_char(start_at at time zone zone,'YYYY-MM-DD"T"HH24:MI')<>p_data->>'start' or to_char(end_at at time zone zone,'YYYY-MM-DD"T"HH24:MI')<>p_data->>'end' then raise exception 'Invalid time range';end if;
  if to_char((start_at-interval '1 hour') at time zone zone,'YYYY-MM-DD"T"HH24:MI')=p_data->>'start' or to_char((end_at-interval '1 hour') at time zone zone,'YYYY-MM-DD"T"HH24:MI')=p_data->>'end' then raise exception 'Choose a time outside the repeated daylight-saving hour';end if;
  if exists(select 1 from public.icash_showing_requests where deal_id=p_deal and state in ('proposed','confirmed') and id is distinct from p_id and starts_at<end_at and ends_at>start_at) then raise exception 'Showing overlaps another visit';end if;
  if p_action='propose' then
   select * into r from public.icash_buyer_viewing_requests where id=(p_data->>'requestId')::uuid and account_id=p_account and deal_id=p_deal and state='needs_confirmation' and (kind='viewing' or viewing_quote is not null);
   if not found or length(btrim(coalesce(p_data->>'buyer',''))) not between 1 and 200 then raise exception 'Current buyer viewing request required';end if;
   insert into public.icash_showing_requests(deal_id,buyer_name,starts_at,ends_at,timezone,buyer_request_id) values(p_deal,btrim(p_data->>'buyer'),start_at,end_at,zone,r.id) returning * into s;
  else
   if length(note) not between 3 and 1000 then raise exception 'Reason required';end if;
   update public.icash_showing_requests set starts_at=start_at,ends_at=end_at,timezone=zone,state='proposed',seller_confirmed_at=null,buyer_confirmed_at=null,seller_note=null,buyer_note=null,change_note=note,version=version+1,updated_at=now() where id=s.id returning * into s;
  end if;
 elsif p_action in ('confirm_seller','confirm_buyer') then
  if s.starts_at<=now() or length(note) not between 3 and 1000 then raise exception 'Future time and confirmation evidence required';end if;
  update public.icash_showing_requests set seller_confirmed_at=case when p_action='confirm_seller' then now() else seller_confirmed_at end,buyer_confirmed_at=case when p_action='confirm_buyer' then now() else buyer_confirmed_at end,
   seller_note=case when p_action='confirm_seller' then note else seller_note end,buyer_note=case when p_action='confirm_buyer' then note else buyer_note end,version=version+1,updated_at=now() where id=s.id returning * into s;
  if s.seller_confirmed_at is not null and s.buyer_confirmed_at is not null then update public.icash_showing_requests set state='confirmed' where id=s.id returning * into s;end if;
 elsif p_action in ('cancel','complete') then
  if length(note) not between 3 and 1000 or (p_action='complete' and (s.state<>'confirmed' or s.starts_at>now())) then raise exception 'Completion or cancellation evidence required';end if;
  update public.icash_showing_requests set state=case when p_action='cancel' then 'cancelled' else 'completed' end,change_note=note,version=version+1,updated_at=now() where id=s.id returning * into s;
 else raise exception 'Unknown action';end if;
 update public.icash_title_tasks set state='cancelled',updated_at=now() where account_id=p_account and deal_id=p_deal and payload->>'showingId'=s.id::text and state in ('scheduled','needs_review');
 if s.state in ('proposed','confirmed') then
  insert into public.icash_title_tasks(account_id,deal_id,source_key,kind,label,due_date,state,evidence,payload)
  values(p_account,p_deal,'showing:'||s.id||':'||s.version,'deadline',case when s.state='confirmed' then 'Upcoming confirmed viewing' else 'Confirm viewing with seller and buyer' end,(s.starts_at at time zone s.timezone)::date,'scheduled',s.buyer_name||' · '||to_char(s.starts_at at time zone s.timezone,'Mon DD, YYYY HH12:MI AM')||' – '||to_char(s.ends_at at time zone s.timezone,'HH12:MI AM')||' '||s.timezone||'. Confirm access and send any reminders to the parties. No invitation or reminder is sent by recording this showing.',jsonb_build_object('showingId',s.id,'version',s.version));
 end if;
 -- The original request stays open until the visit happens or the owner explicitly resolves it.
 return s.id;
end $$;
-- Old proposal endpoint is no longer used; avoid bypassing the confirmation workflow.
revoke all on function public.icash_propose_showing(uuid,uuid,text,timestamptz,timestamptz,text) from service_role;

-- Follow-ups must also accept an independently verified closer selected after signing.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.icash_claim_title_followup(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'lower(d.terms->>''titleEmail'') is distinct from lower(j.recipient)','not public.icash_title_contact_matches(p_account,d.id,j.recipient)');
 execute definition;
end $$;
select public.icash_seed_contract_deadlines(e.id) from public.icash_signing_envelopes e where e.kind='purchase' and e.state='completed' and not e.test_mode;
select public.icash_sync_title_updates(j.account_id,j.deal_id) from public.icash_title_requests j where j.state='sent';

create function public.icash_closing_task_attention(p_account uuid,p_offset integer default 0,p_limit integer default 7)
returns table(id uuid,deal_id uuid,screening_id uuid,kind text,label text,due_date date,state text,evidence text,email_state text,updated_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select t.id,t.deal_id,d.screening_id,t.kind,t.label,t.due_date,t.state,t.evidence,t.email_state,t.updated_at
 from public.icash_title_tasks t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 where t.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing')
 and (t.state='needs_review' or (t.kind='deadline' and t.state='scheduled' and t.due_date<=(now() at time zone 'America/Chicago')::date+2))
 order by t.due_date nulls first,t.created_at,t.id limit least(greatest(p_limit,1),50) offset least(greatest(p_offset,0),60000);
$$;
revoke all on function public.icash_closing_task_attention(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.icash_closing_task_attention(uuid,integer,integer) to service_role;

revoke all on function public.icash_update_buyer_request(uuid,uuid,uuid,text,text),public.icash_sync_title_updates(uuid,uuid),public.icash_title_updates_trigger(),public.icash_claim_title_update(uuid,uuid,jsonb),public.icash_next_automation(),public.icash_next_before_closing_gaps(),public.icash_seed_contract_deadlines(uuid),public.icash_contract_deadlines_trigger(),public.icash_manage_showing(uuid,uuid,uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.icash_seed_contract_deadlines(uuid),public.icash_update_buyer_request(uuid,uuid,uuid,text,text),public.icash_sync_title_updates(uuid,uuid),public.icash_claim_title_update(uuid,uuid,jsonb),public.icash_next_automation(),public.icash_next_before_closing_gaps(),public.icash_manage_showing(uuid,uuid,uuid,text,uuid,integer,jsonb) to service_role;
commit;
