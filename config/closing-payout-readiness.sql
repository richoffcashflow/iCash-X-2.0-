begin;
set local lock_timeout='3s';

-- A preference is not the secure delivery of payout details. Keep that owner
-- action visible, including when an already-ready setup is edited or resumed.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_save_closing_setup_before_profile(uuid,uuid,uuid,text,jsonb)'::regprocedure);
 needle:=$old$update public.icash_closing_setup x set state='ready' where x.id=s.id and x.review_reason='setup' and x.payout is not null
  and exists(select 1 from public.icash_title_contacts c where c.account_id=p_account and c.deal_id=p_deal and c.enabled and c.verified_until>now() and public.icash_title_contact_matches(p_account,p_deal,c.email));$old$;
 replacement:=$new$update public.icash_closing_setup x set state=case when x.payout->'detailsSharedWithTitle'='true'::jsonb
  and exists(select 1 from public.icash_title_contacts c where c.account_id=p_account and c.deal_id=p_deal and c.enabled and c.verified_until>now() and public.icash_title_contact_matches(p_account,p_deal,c.email))
  then 'ready' else 'needs_review' end where x.id=s.id and x.review_reason='setup';$new$;
 if position(needle in definition)=0 then raise exception 'Closing setup readiness changed; review before applying';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.icash_set_work_control_before_cancellation(uuid,uuid,text,uuid)'::regprocedure);
 needle:='case when payout is not null and exists(';
 replacement:='case when payout->''detailsSharedWithTitle''=''true''::jsonb and exists(';
 if position(needle in definition)=0 then raise exception 'Closing resume readiness changed; review before applying';end if;
 execute replace(definition,needle,replacement);
end $patch$;

-- Repair active setup-only reminders; preserve human reviews and closed history.
update public.icash_closing_setup s set state='needs_review',updated_at=now()
where s.state='ready' and s.review_reason='setup'
 and s.payout->'detailsSharedWithTitle' is distinct from 'true'::jsonb
 and exists(select 1 from public.icash_deal_files d join public.icash_screening_jobs j
  on j.id=d.screening_id and j.account_id=d.account_id and j.state<>'archived'
  where d.id=s.deal_id and d.account_id=s.account_id
  and d.stage in ('under_contract','buyer_selected','title_open','closing'));

commit;
