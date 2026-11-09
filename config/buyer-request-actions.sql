begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Installed inactive. Activate prospectively after the matching web/worker
-- release; old messages and uncertain deliveries keep their original receipts.
alter table public.icash_seller_progress_settings
 add column buyer_actions_enabled boolean not null default false,
 add column buyer_actions_enabled_at timestamptz;

create function public.icash_buyer_request_action(p_body text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare b text:=lower(btrim(replace(p_body,'’','''')));
begin
 if b is null or length(b)>250 then return null;end if;
 b:=regexp_replace(b,'[?!.]+[[:space:]]*$','','g');
 if b ~ '^(please )?(send( me)?|text( me)?|can you send( me)?|could you send( me)?) (the |some |more )?(deal |property |buyer )?(details|info|information|photos|pictures|package)( please)?$'
  or b ~ '^(details|photos|pictures|more info|more information)( please)?$' then return 'package';
 elsif b ~ '^(how (do|can) i |i (want|would like) to )?(join (the |your )?buyer network|(set|update|change) my (buy box|buying preferences|buying criteria))$'
  or b ~ '^i (buy|can buy|am buying) [0-9]{1,2} (houses|properties)( a| per)? month in [0-9]{5}(, ?[0-9]{5}){0,19}$' then return 'preferences';
 elsif b ~ '^(what(''s| is) (the |my )?next step|how (do|can) i move forward|(please )?(send|text)( me)? (the |my )?(next steps|buyer details link|signing link))$' then return 'next_step';
 end if;
 return null;
end $$;

alter function public.icash_buyer_factual_text(uuid,uuid,text) rename to icash_buyer_factual_before_actions;
create function public.icash_buyer_factual_text(p_account uuid,p_thread uuid,p_incoming text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare action text;t public.icash_text_threads;p jsonb;token text;
begin
 action:=public.icash_buyer_request_action(p_incoming);
 if action is null or not exists(
  select 1 from public.icash_seller_progress_settings cfg
  join public.icash_text_messages src on src.account_id=p_account and src.thread_id=p_thread
   and src.direction='incoming' and src.state='received' and src.body=p_incoming
  where cfg.buyer_reply_enabled and cfg.buyer_actions_enabled
   and public.icash_sms_reply_time(src.id)>=extract(epoch from cfg.buyer_actions_enabled_at)
   and public.icash_sms_reply_time(src.id) between extract(epoch from now()-interval '24 hours') and extract(epoch from now())
 ) then return public.icash_buyer_factual_before_actions(p_account,p_thread,p_incoming);end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='buyer';
 if not found then return null;end if;
 p:=public.icash_buyer_package_data(p_account,t.deal_id);
 if p is null then return null;end if;
 if action='next_step' then
  -- Return the same buyer's existing capability. Creating/advancing a journey
  -- still belongs to its source-bound request and worker, never this read.
  select j.buyer_token into token from public.icash_deal_journeys j
   where j.account_id=p_account and j.deal_id=t.deal_id and j.thread_id=t.id
    and j.state in ('collecting','ready','sending','signing','deposit_due','reserved')
    and j.expires_at>now() and public.icash_journey_current(j.id)
   order by j.created_at desc,j.id desc limit 1;
  if token ~ '^[a-f0-9]{32}$' then
   return 'Your current buyer step: https://homeoffernetwork.com/next/'||token||'. This does not sign or reserve the property.';
  end if;
  return null;
 end if;
 if p->'reserved'='true'::jsonb then return public.icash_buyer_factual_before_actions(p_account,p_thread,p_incoming);end if;
 if action='preferences' then
  return 'Set your ZIP codes, budget and current buying capacity: https://homeoffernetwork.com/buyers. Free to join; verify your email and choose contact preferences.';
 end if;
 select l.token into token from public.icash_buyer_package_links l
 join public.icash_disposition_authorities a on a.deal_id=l.deal_id and a.account_id=l.account_id and a.purchase_envelope_id=l.purchase_envelope_id
 where l.account_id=p_account and l.deal_id=t.deal_id and l.revoked_at is null and a.expires_at>now()
  and to_jsonb(l.asking_price_cents)=p->'askingPriceCents'
 order by l.id limit 1;
 if token ~ '^[a-f0-9]{32}$' then
  return 'Current property details and available photos: https://propertymsgs.com/d/'||token;
 end if;
 return null;
end $$;
revoke all on function public.icash_buyer_request_action(text),public.icash_buyer_factual_text(uuid,uuid,text),public.icash_buyer_factual_before_actions(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_buyer_request_action(text),public.icash_buyer_factual_text(uuid,uuid,text),public.icash_buyer_factual_before_actions(uuid,uuid,text) to service_role;
commit;
