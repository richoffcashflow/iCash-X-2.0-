-- Restore the owner's 50% rolling daily policy, retaining 30% VIP savings.
-- Forward-only: no budget snapshots, charges, holds or controls are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;

-- BEGIN icash_prospecting_available
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_prospecting_available'::regproc);
 if md5(d)<>'fbb5a1af7b4b10a5706a5f3fabbe52a9' then raise exception 'Concurrent change to icash_prospecting_available';end if;
 if (length(d)-length(replace(d,$old$b.baseline_cents/4-usage.recent_amount$old$,'')))/length($old$b.baseline_cents/4-usage.recent_amount$old$)<>1 then raise exception 'Unexpected icash_prospecting_available policy boundary';end if;
 d:=replace(d,$old$b.baseline_cents/4-usage.recent_amount$old$,$new$b.limit_cents-usage.recent_amount$new$);
 if (length(d)-length(replace(d,$old$least(b.baseline_cents/4,greatest(500,ceil(b.limit_cents/10.0)))$old$,'')))/length($old$least(b.baseline_cents/4,greatest(500,ceil(b.limit_cents/10.0)))$old$)<>1 then raise exception 'Unexpected icash_prospecting_available policy boundary';end if;
 d:=replace(d,$old$least(b.baseline_cents/4,greatest(500,ceil(b.limit_cents/10.0)))$old$,$new$least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))$new$);
 execute d;
end $patch$;
-- END icash_prospecting_available

-- BEGIN icash_prospecting_released
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_prospecting_released'::regproc);
 if md5(d)<>'aacf03aec0a99ef71f50f9ada629a7e0' then raise exception 'Concurrent change to icash_prospecting_released';end if;
 if (length(d)-length(replace(d,$old$least(p_balance/4,greatest(500,ceil(total/10.0)))$old$,'')))/length($old$least(p_balance/4,greatest(500,ceil(total/10.0)))$old$)<>1 then raise exception 'Unexpected icash_prospecting_released policy boundary';end if;
 d:=replace(d,$old$least(p_balance/4,greatest(500,ceil(total/10.0)))$old$,$new$least(total,greatest(500,ceil(total/10.0)))$new$);
 if (length(d)-length(replace(d,$old$(24*3600)$old$,'')))/length($old$(24*3600)$old$)<>1 then raise exception 'Unexpected icash_prospecting_released policy boundary';end if;
 d:=replace(d,$old$(24*3600)$old$,$new$(12*3600)$new$);
 execute d;
end $patch$;
-- END icash_prospecting_released

-- BEGIN icash_prospecting_progress
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_prospecting_progress'::regproc);
 if md5(d)<>'410c4162beb064816f5eb9e2ddb966aa' then raise exception 'Concurrent change to icash_prospecting_progress';end if;
 if (length(d)-length(replace(d,$old$'pacingHours',24,'dailyPercent',25,'dailyLimitCents',b.baseline_cents/4$old$,'')))/length($old$'pacingHours',24,'dailyPercent',25,'dailyLimitCents',b.baseline_cents/4$old$)<>1 then raise exception 'Unexpected icash_prospecting_progress policy boundary';end if;
 d:=replace(d,$old$'pacingHours',24,'dailyPercent',25,'dailyLimitCents',b.baseline_cents/4$old$,$new$'pacingHours',12,'dailyPercent',50,'dailyLimitCents',b.limit_cents$new$);
 if (length(d)-length(replace(d,$old$least(b.baseline_cents/4,greatest(500,ceil(b.limit_cents/10.0)))$old$,'')))/length($old$least(b.baseline_cents/4,greatest(500,ceil(b.limit_cents/10.0)))$old$)<>1 then raise exception 'Unexpected icash_prospecting_progress policy boundary';end if;
 d:=replace(d,$old$least(b.baseline_cents/4,greatest(500,ceil(b.limit_cents/10.0)))$old$,$new$least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))$new$);
 execute d;
end $patch$;
-- END icash_prospecting_progress

-- BEGIN icash_apply_prepaid_purchase
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_apply_prepaid_purchase'::regproc);
 if md5(d)<>'2285fecdf9afd57208c8773d5f36d745' then raise exception 'Concurrent change to icash_apply_prepaid_purchase';end if;
 if (length(d)-length(replace(d,$old$'work-credits-2026-10-20.1')$old$,'')))/length($old$'work-credits-2026-10-20.1')$old$)<>1 then raise exception 'Unexpected icash_apply_prepaid_purchase policy boundary';end if;
 d:=replace(d,$old$'work-credits-2026-10-20.1')$old$,$new$'work-credits-2026-10-20.1','work-credits-2026-10-20.2','work-credits-2026-10-20.2:recharge-2026-10-10.1')$new$);
 execute d;
end $patch$;
-- END icash_apply_prepaid_purchase

-- BEGIN icash_activate_auto_recharge
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_activate_auto_recharge'::regproc);
 if md5(d)<>'aa98498c874d7640725470ad4251ecc2' then raise exception 'Concurrent change to icash_activate_auto_recharge';end if;
 if (length(d)-length(replace(d,$old$'work-credits-2026-10-20.1:recharge-2026-10-10.1')$old$,'')))/length($old$'work-credits-2026-10-20.1:recharge-2026-10-10.1')$old$)<>1 then raise exception 'Unexpected icash_activate_auto_recharge policy boundary';end if;
 d:=replace(d,$old$'work-credits-2026-10-20.1:recharge-2026-10-10.1')$old$,$new$'work-credits-2026-10-20.1:recharge-2026-10-10.1','work-credits-2026-10-20.2:recharge-2026-10-10.1')$new$);
 execute d;
end $patch$;
-- END icash_activate_auto_recharge

commit;
