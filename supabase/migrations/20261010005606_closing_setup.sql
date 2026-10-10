begin;
set local lock_timeout='3s';

-- Owner-only coordination metadata. Bank accounts, routing numbers and tax IDs
-- are deliberately absent; the verified closing office collects those securely.
create table public.icash_closing_setup (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null unique references public.icash_deal_files(id),
 screening_id uuid not null references public.icash_screening_jobs(id),
 payout jsonb,title_proposal jsonb,
 state text not null default 'needs_review' check(state in ('needs_review','acknowledged','ready')),
 review_reason text not null default 'setup' check(review_reason in ('setup','human_requested','title_declined','payment_change','title_issue')),
 reply_id uuid references public.icash_title_replies(id),
 buyer_request_id uuid references public.icash_buyer_viewing_requests(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index icash_closing_setup_attention on public.icash_closing_setup(account_id,state,created_at,id);
create index icash_closing_setup_screening on public.icash_closing_setup(screening_id,account_id);
create index icash_closing_setup_reply on public.icash_closing_setup(reply_id);
create index icash_closing_setup_buyer_request on public.icash_closing_setup(buyer_request_id);
alter table public.icash_closing_setup enable row level security;
revoke all on public.icash_closing_setup from public,anon,authenticated;
grant select,insert,update on public.icash_closing_setup to service_role;

create function public.icash_title_contact_matches(p_account uuid,p_deal uuid,p_email text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_deal_files d where d.id=p_deal and d.account_id=p_account
  and (lower(nullif(btrim(d.terms->>'titleEmail'),''))=lower(p_email)
   or (nullif(btrim(d.terms->>'titleEmail'),'') is null and exists(
    select 1 from public.icash_title_contacts c where c.account_id=p_account and c.deal_id=p_deal
     and lower(c.email)=lower(p_email) and c.enabled and c.verified_until>now()
     and c.evidence_ref like 'owner-closing-verification:%'))));
$$;

create function public.icash_seed_closing_setup() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.stage in ('under_contract','buyer_selected','title_open','closing') and exists(
  select 1 from public.icash_signing_envelopes where account_id=new.account_id and deal_id=new.id and kind='purchase' and state='completed' and not test_mode
 ) then
  insert into public.icash_closing_setup(account_id,deal_id,screening_id) values(new.account_id,new.id,new.screening_id) on conflict(deal_id) do nothing;
 end if;
 if new.stage in ('closed','canceled') then
  update public.icash_closing_setup set state='acknowledged',updated_at=now() where deal_id=new.id and account_id=new.account_id and state='needs_review' and review_reason='setup';
 end if;
 return new;
end $$;
create trigger icash_seed_closing_setup after insert or update of stage on public.icash_deal_files for each row execute function public.icash_seed_closing_setup();
insert into public.icash_closing_setup(account_id,deal_id,screening_id)
select d.account_id,d.id,d.screening_id from public.icash_deal_files d where d.stage in ('under_contract','buyer_selected','title_open','closing')
 and exists(select 1 from public.icash_signing_envelopes e where e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and e.state='completed' and not e.test_mode)
on conflict(deal_id) do nothing;

create function public.icash_save_closing_setup(p_account uuid,p_actor uuid,p_deal uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;s public.icash_closing_setup;rate uuid;mail text;prop text;label text;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Owner required';end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found or d.stage not in ('under_contract','buyer_selected','title_open','closing','closed') or not exists(
  select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and state='completed' and not test_mode
 ) then raise exception 'Signed live purchase required';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>4096 then raise exception 'Invalid details';end if;
 insert into public.icash_closing_setup(account_id,deal_id,screening_id) values(p_account,p_deal,d.screening_id) on conflict(deal_id) do nothing;
 select * into strict s from public.icash_closing_setup where deal_id=p_deal and account_id=p_account for update;
 if p_action='payout' then
  if exists(select 1 from public.icash_closing_updates where account_id=p_account and deal_id=p_deal and kind='funds_disbursed') then raise exception 'Payment already reported; contact closer';end if;
  if p_data-array['payeeName','payeeType','method','mailingAddress','detailsSharedWithTitle']<>'{}'::jsonb
   or not (p_data ?& array['payeeName','payeeType','method','mailingAddress','detailsSharedWithTitle'])
   or jsonb_typeof(p_data->'payeeName')<>'string' or length(btrim(p_data->>'payeeName')) not between 2 and 200
   or p_data->>'payeeName' ~ E'[\r\n]' or p_data->>'payeeType' not in ('individual','company')
   or p_data->>'method' not in ('check_pickup','check_mail','wire')
   or jsonb_typeof(p_data->'mailingAddress')<>'string' or length(p_data->>'mailingAddress')>500
   or jsonb_typeof(p_data->'detailsSharedWithTitle')<>'boolean'
   or (p_data->>'method'='check_mail' and length(btrim(p_data->>'mailingAddress'))<10)
   or (p_data->>'method'<>'check_mail' and p_data->>'mailingAddress'<>'')
   or concat_ws(' ',p_data->>'payeeName',p_data->>'mailingAddress') ~* '(\m(routing|account|ssn|social security|tax id)\s*(number|#|:)|\m[0-9]{9,}\M)'
  then raise exception 'Payee and delivery preference only; no banking or tax details';end if;
  update public.icash_closing_setup set payout=p_data,updated_at=now() where id=s.id;
 elsif p_action='title_preference' then
  if p_data-array['company','closer','email','phone']<>'{}'::jsonb or not(p_data ?& array['company','closer','email','phone'])
   or jsonb_typeof(p_data->'company')<>'string' or length(btrim(p_data->>'company')) not between 2 and 200
   or jsonb_typeof(p_data->'closer')<>'string' or length(p_data->>'closer')>200
   or jsonb_typeof(p_data->'email')<>'string' or length(p_data->>'email')>254
   or (p_data->>'email'<>'' and p_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
   or jsonb_typeof(p_data->'phone')<>'string' or (p_data->>'phone'<>'' and p_data->>'phone' !~ '^\+[1-9][0-9]{7,14}$')
   or concat_ws('',p_data->>'company',p_data->>'closer') ~ E'[\r\n]'
  then raise exception 'Invalid title preference';end if;
  if p_data is distinct from s.title_proposal then
   if exists(select 1 from public.icash_title_requests where account_id=p_account and deal_id=p_deal and state<>'ready') then raise exception 'Sent title file cannot be switched here';end if;
   update public.icash_title_contacts set enabled=false where account_id=p_account and deal_id=p_deal;
   update public.icash_closing_setup set title_proposal=p_data,payout=case when payout is null then null else payout||jsonb_build_object('detailsSharedWithTitle',false) end,state='needs_review',updated_at=now() where id=s.id;
  end if;
 elsif p_action='confirm_title' then
  if p_data-array['revision','independentContact','assignmentsAndCoverage','agreedByParties']<>'{}'::jsonb
   or p_data->'independentContact' is distinct from 'true'::jsonb or p_data->'assignmentsAndCoverage' is distinct from 'true'::jsonb
   or p_data->'agreedByParties' is distinct from 'true'::jsonb or (p_data->>'revision')::timestamptz is distinct from s.updated_at
   or s.title_proposal is null or length(s.title_proposal->>'closer')<2 or length(s.title_proposal->>'phone')<9
   or coalesce(s.title_proposal->>'email','')='' or d.stage='closed'
  then raise exception 'Complete contact details and current verification required';end if;
  mail:=lower(s.title_proposal->>'email');
  if nullif(btrim(d.terms->>'titleEmail'),'') is not null and lower(d.terms->>'titleEmail')<>mail then raise exception 'Changing the agreed closer needs human review';end if;
  if exists(select 1 from public.icash_title_requests where deal_id=p_deal and account_id=p_account and lower(recipient)<>mail) then raise exception 'Existing request has a different closer';end if;
  select id into rate from public.icash_operation_rates where operation='title_email' and enabled and expires_at>now() order by verified_at desc limit 1;
  if rate is null then raise exception 'Current title delivery rate required';end if;
  insert into public.icash_title_contacts(deal_id,account_id,email,verified_until,evidence_ref,rate_id,enabled)
  values(p_deal,p_account,mail,now()+interval '30 days','owner-closing-verification:'||p_actor||':'||(s.title_proposal->>'phone'),rate,true)
  on conflict(deal_id) do update set email=excluded.email,verified_until=excluded.verified_until,evidence_ref=excluded.evidence_ref,rate_id=excluded.rate_id,enabled=true
  where icash_title_contacts.account_id=p_account;
  update public.icash_closing_setup set updated_at=now() where id=s.id;
 elsif p_action='takeover' then
  if p_data-array['reason']<>'{}'::jsonb or coalesce(p_data->>'reason','') not in ('human_requested','title_declined','payment_change','title_issue') then raise exception 'Choose a review reason';end if;
  perform public.icash_set_work_control(p_actor,p_account,'takeover',d.screening_id);
  update public.icash_closing_setup set state='acknowledged',review_reason=p_data->>'reason',updated_at=now() where id=s.id;
 else raise exception 'Unknown closing action';end if;
 -- Prepared preferences are not acceptance, funding or completed closing.
 update public.icash_closing_setup x set state='ready' where x.id=s.id and x.review_reason='setup' and x.payout is not null
  and exists(select 1 from public.icash_title_contacts c where c.account_id=p_account and c.deal_id=p_deal and c.enabled and c.verified_until>now() and public.icash_title_contact_matches(p_account,p_deal,c.email));
 select * into s from public.icash_closing_setup where id=s.id;
 return jsonb_build_object('state',s.state,'action',p_action,'sent',false);
end $$;

-- Verified-sender exceptions are review signals, never wire instructions or
-- decisions about liens, contract changes, refunds or who receives proceeds.
create function public.icash_closing_reply_review() returns trigger
language plpgsql security invoker set search_path='' as $$
declare reason text;body text;screen uuid;prop text;
begin
 if not new.sender_verified or new.account_id is null or new.deal_id is null then return new;end if;
 body:=split_part(replace(new.body_text,E'\r',''),E'\n>',1);
 body:=split_part(body,E'\nFrom:',1);body:=split_part(body,E'\nOn ',1);
 if body ~* '(new|changed|updated|replace|different).{0,70}(wire|bank|routing|account|payee)|(wire|bank|routing|account|payee).{0,70}(changed|updated|change|replace)' then reason:='payment_change';
 elsif body ~* '(cannot|can''t|do not|don''t|unable|decline).{0,80}(assignment|handle|accept|close|file)' then reason:='title_declined';
 elsif body ~* '\m(dispute|lien|probate|lawsuit|legal review|attorney review|human|real person)\M' then reason:='title_issue';
 else return new;end if;
 select d.screening_id,j.snapshot->>'propertyId' into screen,prop from public.icash_deal_files d join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=d.account_id where d.id=new.deal_id and d.account_id=new.account_id;
 if screen is null then return new;end if;
 insert into public.icash_closing_setup(account_id,deal_id,screening_id,state,review_reason,reply_id)
 values(new.account_id,new.deal_id,screen,'needs_review',reason,new.id)
 on conflict(deal_id) do update set state='needs_review',review_reason=excluded.review_reason,reply_id=excluded.reply_id,updated_at=now()
 where icash_closing_setup.account_id=excluded.account_id;
 if prop is not null then
  insert into public.icash_property_controls(account_id,property_id,manual) values(new.account_id,prop,true)
  on conflict(account_id,property_id) do update set manual=true,updated_at=now();
 end if;
 return new;
end $$;
create trigger icash_closing_reply_review after insert on public.icash_title_replies for each row execute function public.icash_closing_reply_review();

create function public.icash_closing_buyer_handoff() returns trigger
language plpgsql security invoker set search_path='' as $$
declare request text;prop text;
begin
 if new.state<>'needs_confirmation' then return new;end if;
 request:=coalesce(new.coordination_quote,new.quote,'');
 if request !~* '\m(human|real person|manager)\M' or request ~* '\m(don''t|do not|no need|not need)\M.{0,25}\m(human|real person|manager)\M' then return new;end if;
 select j.snapshot->>'propertyId' into prop from public.icash_deal_files d join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=d.account_id
 where d.id=new.deal_id and d.account_id=new.account_id and d.screening_id=new.screening_id;
 if prop is null then return new;end if;
 insert into public.icash_closing_setup(account_id,deal_id,screening_id,state,review_reason,buyer_request_id)
 values(new.account_id,new.deal_id,new.screening_id,'needs_review','human_requested',new.id)
 on conflict(deal_id) do update set state='needs_review',review_reason='human_requested',buyer_request_id=excluded.buyer_request_id,updated_at=now()
 where icash_closing_setup.account_id=excluded.account_id;
 insert into public.icash_property_controls(account_id,property_id,manual) values(new.account_id,prop,true)
 on conflict(account_id,property_id) do update set manual=true,updated_at=now();
 return new;
end $$;
create trigger icash_closing_buyer_handoff after insert or update of coordination_quote on public.icash_buyer_viewing_requests for each row execute function public.icash_closing_buyer_handoff();

-- Only the owner's existing explicit Return to bot action clears a takeover.
alter function public.icash_set_work_control(uuid,uuid,text,uuid) rename to icash_set_work_control_before_closing_setup;
create function public.icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform public.icash_set_work_control_before_closing_setup(p_user,p_account,p_action,p_screening);
 if p_action='return_to_bot' then
  update public.icash_closing_setup s set review_reason='setup',state=case when payout is not null and exists(
   select 1 from public.icash_title_contacts c where c.account_id=p_account and c.deal_id=s.deal_id and c.enabled and c.verified_until>now()
   and public.icash_title_contact_matches(p_account,s.deal_id,c.email)
  ) then 'ready' else 'needs_review' end,updated_at=now() where s.account_id=p_account and s.screening_id=p_screening;
 end if;
end $$;

-- Permit an owner-verified operational closer when the signed deal leaves title
-- undecided. Never edit executed terms or override a different named contact.
do $patch$
declare definition text;needle text;replacement text;signature text;
begin
 for signature,needle,replacement in values
 ('public.icash_prepare_title_request(uuid,uuid)','lower(c.email) is distinct from lower(d.terms->>''titleEmail'')','not public.icash_title_contact_matches(p_account,p_deal,c.email)'),
 ('public.icash_claim_title_request(uuid)','lower(d.terms->>''titleEmail'') is distinct from lower(j.recipient)','not public.icash_title_contact_matches(j.account_id,j.deal_id,j.recipient)')
 loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position(needle in definition)=0 then raise exception 'Title matching guard changed; review first';end if;
  execute replace(definition,needle,replacement);
 end loop;
end $patch$;
alter function public.icash_buyer_package_data(uuid,uuid) rename to icash_buyer_package_before_closing_setup;
create function public.icash_buyer_package_data(p_account uuid,p_deal uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare package jsonb;
begin
 package:=public.icash_buyer_package_before_closing_setup(p_account,p_deal);if package is null then return null;end if;
 if exists(select 1 from public.icash_title_contacts c where c.account_id=p_account and c.deal_id=p_deal and c.enabled and c.verified_until>now() and public.icash_title_contact_matches(p_account,p_deal,c.email)) then
  return package||jsonb_build_object('titleSelectionStatus','selected');
 end if;
 return package;
end $$;
revoke all on function public.icash_title_contact_matches(uuid,uuid,text),public.icash_seed_closing_setup(),public.icash_save_closing_setup(uuid,uuid,uuid,text,jsonb),public.icash_closing_reply_review(),public.icash_closing_buyer_handoff(),public.icash_set_work_control(uuid,uuid,text,uuid),public.icash_set_work_control_before_closing_setup(uuid,uuid,text,uuid),public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_package_before_closing_setup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_title_contact_matches(uuid,uuid,text),public.icash_save_closing_setup(uuid,uuid,uuid,text,jsonb),public.icash_set_work_control(uuid,uuid,text,uuid),public.icash_set_work_control_before_closing_setup(uuid,uuid,text,uuid),public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_package_before_closing_setup(uuid,uuid) to service_role;
commit;
