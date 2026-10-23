begin;
set local lock_timeout='5s';
create table public.icash_deal_recovery_authorizations(
 id uuid primary key,account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),
 actor_id uuid not null references auth.users(id),minimum_fee_cents bigint not null check(minimum_fee_cents between 500000 and 1000000 and minimum_fee_cents%100000=0),
 previous_terms jsonb not null,next_terms jsonb not null,created_at timestamptz not null default now()
);
create index icash_deal_recovery_authorizations_deal on public.icash_deal_recovery_authorizations(deal_id,created_at desc,id);
create index icash_deal_recovery_authorizations_account on public.icash_deal_recovery_authorizations(account_id);
create index icash_deal_recovery_authorizations_actor on public.icash_deal_recovery_authorizations(actor_id);
alter table public.icash_deal_recovery_authorizations enable row level security;
revoke all on public.icash_deal_recovery_authorizations from public,anon,authenticated;
grant select,insert on public.icash_deal_recovery_authorizations to service_role;
create function public.icash_buyer_assignment_pricing(p_price bigint,p_snapshot jsonb,p_fee bigint,p_minimum bigint) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare data jsonb;arv numeric;repairs numeric;budget bigint;target bigint;fee bigint;room bigint;
begin
 if p_minimum is null or p_minimum not between 500000 and 1000000 or p_minimum%100000<>0 then return jsonb_build_object('ready',false,'reason','fee_authorization_required');end if;
 if p_price is null or p_price not between 1 and 99999000000 then return jsonb_build_object('ready',false,'reason','purchase_price_required');end if;
 if p_price%100000<>0 then return jsonb_build_object('ready',false,'reason','rounded_purchase_required');end if;
 data:=p_snapshot->'raw'->'data';
 if p_snapshot->>'propertyType' is distinct from 'house' or jsonb_typeof(data->'estimated_value') is distinct from 'number'
 or jsonb_typeof(data->'estimated_repair_cost') is distinct from 'number' then return jsonb_build_object('ready',false,'reason','research_required');end if;
 arv:=(data->>'estimated_value')::numeric*100;repairs:=(data->>'estimated_repair_cost')::numeric*100;
 if arv<=0 or repairs<0 or arv>9007199254740991 or repairs>9007199254740991 or arv<>trunc(arv) or repairs<>trunc(repairs) then return jsonb_build_object('ready',false,'reason','research_required');end if;
 budget:=floor(greatest(arv-repairs,0)*7000/10000)::bigint;target:=case when arv>=30000000 then 2000000 else 1000000 end;
 room:=floor((budget-p_price)::numeric/100000)::bigint*100000;
 if room<p_minimum then return jsonb_build_object('ready',false,'reason','insufficient_margin','minimumFeeCents',p_minimum);end if;
 fee:=coalesce(p_fee,least(target,room));
 if fee not between p_minimum and 100000000000 or fee%100000<>0 then return jsonb_build_object('ready',false,'reason','rounded_fee_required','minimumFeeCents',p_minimum);end if;
 if fee>room or p_price+fee>100000000000 then return jsonb_build_object('ready',false,'reason','fee_exceeds_buyer_budget');end if;
 return jsonb_build_object('ready',true,'assignmentFeeCents',fee,'assignmentDepositCents',least(fee/5,500000),
 'askingPriceCents',p_price+fee,'buyerCeilingCents',budget,'targetFeeCents',target,'minimumFeeCents',p_minimum);
end $$;
create function public.icash_deal_minimum_fee(p_account uuid,p_deal uuid) returns bigint
language sql stable security invoker set search_path='' as $$
 select coalesce((select minimum_fee_cents from public.icash_deal_recovery_authorizations where account_id=p_account and deal_id=p_deal order by created_at desc,id desc limit 1),1000000)
$$;
create function public.icash_deal_recovery_editable(p_account uuid,p_deal uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_deal_files d where d.id=p_deal and d.account_id=p_account and d.stage='under_contract'
 and coalesce(d.terms->>'practice','false')<>'true')
 and not exists(select 1 from public.icash_disposition_authorities where deal_id=p_deal)
 and not exists(select 1 from public.icash_buyer_package_links where deal_id=p_deal)
 and not exists(select 1 from public.icash_signing_envelopes where deal_id=p_deal and kind='assignment' and not test_mode)
$$;
create function public.icash_deal_recovery(p_account uuid,p_deal uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('editable',public.icash_deal_recovery_editable(p_account,p_deal),'termsHash',md5(d.terms::text),
 'minimumFeeCents',public.icash_deal_minimum_fee(p_account,p_deal),
 'proposal',public.icash_buyer_assignment_pricing((d.terms->>'priceCents')::bigint,s.snapshot,null,500000),
 'feedback',coalesce((select jsonb_agg(row order by created_at desc) from (
  select f.created_at,jsonb_build_object('id',f.id,'reason',f.reason,'counterofferCents',f.counteroffer_cents,
  'buyerPriceCents',a.asking_price_cents,'gapCents',case when f.counteroffer_cents is not null then greatest(0,a.asking_price_cents-f.counteroffer_cents) end,
  'createdAt',f.created_at) row from public.icash_buyer_deal_feedback f join public.icash_network_matches m on m.id=f.match_id
  left join public.icash_disposition_authorities a on a.deal_id=m.deal_id and a.account_id=m.account_id
  where m.account_id=p_account and m.deal_id=p_deal order by f.created_at desc limit 10) feedback),'[]'))
 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing')
$$;
create function public.icash_authorize_deal_recovery(p_account uuid,p_actor uuid,p_deal uuid,p_key uuid,p_terms_hash text,p_minimum bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;s public.icash_screening_jobs;plan jsonb;next_terms jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Account owner required';end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found then raise exception 'Deal unavailable';end if;
 if exists(select 1 from public.icash_deal_recovery_authorizations where id=p_key and account_id=p_account and actor_id=p_actor and deal_id=p_deal and minimum_fee_cents=p_minimum) then return public.icash_deal_recovery(p_account,p_deal);end if;
 if md5(d.terms::text) is distinct from p_terms_hash or not public.icash_deal_recovery_editable(p_account,p_deal) then raise exception 'Terms changed or already released';end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete';
 if not found then raise exception 'Current research required';end if;
 plan:=public.icash_buyer_assignment_pricing((d.terms->>'priceCents')::bigint,s.snapshot,null,p_minimum);
 if plan->'ready' is distinct from 'true'::jsonb then raise exception 'Deal does not fit this fee floor';end if;
 next_terms:=d.terms||jsonb_build_object('assignmentFeeCents',plan->'assignmentFeeCents','assignmentDepositCents',plan->'assignmentDepositCents');
 insert into public.icash_deal_recovery_authorizations values(p_key,p_account,p_deal,p_actor,p_minimum,d.terms,next_terms,now());
 update public.icash_deal_files set terms=next_terms where id=d.id;
 update public.icash_fulfillment_jobs set state='ready',updated_at=now() where account_id=p_account and deal_id=p_deal and state='complete';
 return public.icash_deal_recovery(p_account,p_deal);
end $$;
do $patch$
declare d text;signature text;needle text;
begin
 foreach signature in array array['public.icash_prepare_disposition_before_deposit(uuid,uuid)','public.icash_unreleased_buyer_pricing(uuid,uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  needle:=case when signature like '%before_deposit%' then 'public.icash_buyer_assignment_pricing(price,s.snapshot,(d.terms->>''assignmentFeeCents'')::bigint)' else 'public.icash_buyer_assignment_pricing((d.terms->>''priceCents'')::bigint,s.snapshot,(d.terms->>''assignmentFeeCents'')::bigint)' end;
  if position(needle in d)=0 then raise exception 'Recovery pricing prerequisite changed';end if;
  execute replace(d,needle,left(needle,length(needle)-1)||',public.icash_deal_minimum_fee(p_account,p_deal))');
 end loop;
end $patch$;
revoke all on function public.icash_buyer_assignment_pricing(bigint,jsonb,bigint,bigint),public.icash_deal_minimum_fee(uuid,uuid),public.icash_deal_recovery_editable(uuid,uuid),public.icash_deal_recovery(uuid,uuid),public.icash_authorize_deal_recovery(uuid,uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.icash_buyer_assignment_pricing(bigint,jsonb,bigint,bigint),public.icash_deal_minimum_fee(uuid,uuid),public.icash_deal_recovery_editable(uuid,uuid),public.icash_deal_recovery(uuid,uuid),public.icash_authorize_deal_recovery(uuid,uuid,uuid,uuid,text,bigint) to service_role;

-- Activate only the seven reviewed, bounded continuations. All current source,
-- opt-out, manual takeover, hours, pause, credit and repetition gates still run.
update public.icash_seller_recovery_variants set enabled=true where key in
 ('unanswered-v1','unanswered-v2','repeat-v1','no-response-v1','no-response-v2','viewing-v1','viewing-v2');
commit;
