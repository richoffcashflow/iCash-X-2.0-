-- The presenting owner's workspace accepts only explicitly submitted private leads.
-- Ordinary customer allocation and all contact, payment and provider checks stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
select 1 from public.icash_operating_budget where id=1 for update;

do $patch$
declare d text;needle text;replacement text;source text;
begin
 d:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 foreach source in array array['icash_seller_intakes','l'] loop
  needle:='('||source||'.contact_consent_scope is distinct from ''icash_x_demo'' or '||source||'.attribution->>''demoAccountId''=ac.id::text)';
  replacement:=needle||' and (ac.id<>''48dfb798-8c1a-404f-88c0-c396cc067062''::uuid or ('||source||'.contact_consent_scope=''icash_x_demo'' and '||source||'.attribution->>''demoAccountId''=ac.id::text))';
  if strpos(d,replacement)=0 then
   if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Seller allocation boundary changed: %',source;end if;
   d:=replace(d,needle,replacement);
  end if;
 end loop;
 execute d;

 d:=pg_get_functiondef('public.icash_meta_assign_contact(uuid)'::regprocedure);
 needle:='where public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused';
 replacement:='where ac.id<>''48dfb798-8c1a-404f-88c0-c396cc067062''::uuid and public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused';
 if strpos(d,replacement)=0 then
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Meta pool allocation boundary changed';end if;
  execute replace(d,needle,replacement);
 end if;
end $patch$;

-- Funding refreshes preserve existing configurations. Run does not enable discovery.
-- A manually entered property keeps its ordinary address lookup and conversation flow.
update public.icash_discovery_configs set enabled=false,auto_enabled=false,next_run_at='infinity'
where account_id='48dfb798-8c1a-404f-88c0-c396cc067062'
 and exists(select 1 from public.icash_accounts a where a.id=account_id and a.owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7');
commit;
