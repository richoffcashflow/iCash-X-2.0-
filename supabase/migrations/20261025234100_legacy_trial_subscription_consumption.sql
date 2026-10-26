begin;
-- A missed initial zero-dollar webhook can leave started_at NULL even after a
-- later paid renewal binds a subscription. That binding permanently consumes
-- the one-time offer, including after cancellation; never reset it as abandoned.
do $$
declare definition text;anchor text:='(state<>''cancelled'' or legacy_trial_started_at is not null)';
begin
 select pg_get_functiondef('public.icash_begin_legacy_trial(text,uuid,text,text,text,text)'::regprocedure) into definition;
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 then raise exception 'Trial begin definition changed; review consumption guard';end if;
 execute replace(definition,anchor,'(state<>''cancelled'' or legacy_trial_started_at is not null or stripe_subscription_id is not null)');
 select pg_get_functiondef('public.icash_legacy_trial_recovery(uuid,text,text)'::regprocedure) into definition;
 anchor:='(state=''pending'' or legacy_trial_started_at is not null)';
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor)
 then raise exception 'Trial recovery definition changed; review consumption guard';end if;
 execute replace(definition,anchor,'(state=''pending'' or legacy_trial_started_at is not null or stripe_subscription_id is not null)');
 if not exists(select 1 from pg_catalog.pg_indexes where schemaname='public' and indexname='icash_legacy_trial_email_once'
  and indexdef like '%legacy_trial_started_at%' and indexdef not like '%stripe_subscription_id%')
 then raise exception 'Trial once-index changed; review consumption guard';end if;
end $$;
drop index public.icash_legacy_trial_email_once;
create unique index icash_legacy_trial_email_once on public.icash_memberships(lower(checkout_email),mode)
 where legacy_trial_offer is not null
 and (state<>'cancelled' or legacy_trial_started_at is not null or stripe_subscription_id is not null);
commit;
