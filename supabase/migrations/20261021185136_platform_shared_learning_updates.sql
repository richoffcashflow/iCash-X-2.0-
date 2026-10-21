-- Staged shared-learning rollout: private helpers before policy activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Cheap revisions wake readers; expensive aggregate work runs in bounded batches.
create function public.icash_learning_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb;account uuid;
begin
 if tg_op='UPDATE' and (to_jsonb(new)-array['updated_at','next_poll_at','poll_attempts','next_attempt_at','attempts','lease_until','lease_token'])
  is not distinct from (to_jsonb(old)-array['updated_at','next_poll_at','poll_attempts','next_attempt_at','attempts','lease_until','lease_token']) then return new;end if;
 item:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 account:=case when tg_table_name='icash_accounts' then (item->>'id')::uuid else (item->>'account_id')::uuid end;
 if account is null and item->>'deal_id' is not null then select account_id into account from public.icash_deal_files where id=(item->>'deal_id')::uuid;end if;
 if account is not null and exists(select 1 from public.icash_accounts where id=account) then
  insert into public.icash_workspace_revisions(account_id) values(account) on conflict(account_id) do update set revision=public.icash_workspace_revisions.revision+1,changed_at=now();
  insert into public.icash_learning_queue(account_id) values(account) on conflict(account_id) do update set due_at=least(public.icash_learning_queue.due_at,now()+interval '1 minute');
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text;begin
 foreach t in array array['icash_accounts','icash_wallets','icash_screening_jobs','icash_deal_files','icash_live_conversations','icash_text_messages','icash_text_threads','icash_operation_spend','icash_signing_envelopes','icash_closing_updates','icash_title_replies','icash_proceeds_receipts','icash_discovery_configs','icash_discovery_filter_pages','icash_seller_recovery_attempts','icash_buyer_search_receipts','icash_buyer_matches'] loop
  execute format('create trigger icash_learning_change after insert or update or delete on public.%I for each row execute function public.icash_learning_changed()',t);
 end loop;
end $$;
insert into public.icash_learning_queue(account_id) select id from public.icash_accounts;

create function public.icash_refresh_shared_learning(p_limit integer default 2) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record;refreshed integer:=0;failed integer:=0;
begin
 if p_limit not between 1 and 5 then raise exception 'Invalid learning batch';end if;
 if not exists(select 1 from public.icash_learning_conversion_cache where id=1 and updated_at>now()-interval '5 minutes') and pg_try_advisory_xact_lock(810211) then
  begin
   insert into public.icash_learning_conversion_cache(id,report) values(1,public.icash_usage_loop_report('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',false))
   on conflict(id) do update set report=excluded.report,updated_at=now();
  exception when others then failed:=failed+1;end;
 end if;
 for item in select account_id from public.icash_learning_queue where due_at<=now() order by due_at,account_id for update skip locked limit p_limit loop
  begin
   perform public.icash_refresh_learning_account(item.account_id);
   update public.icash_learning_queue set due_at=now()+interval '1 hour',last_refreshed_at=now(),last_error_at=null where account_id=item.account_id;
   refreshed:=refreshed+1;
  exception when others then
   update public.icash_learning_queue set due_at=now()+interval '5 minutes',last_error_at=now() where account_id=item.account_id;failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('refreshed',refreshed,'failed',failed,'due',(select count(*) from public.icash_learning_queue where due_at<=now()));
end $$;
create function public.icash_workspace_revision_batch(p_accounts uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(account_id::text,revision::text),'{}') from public.icash_workspace_revisions where cardinality(p_accounts)<=100 and account_id=any(p_accounts);
$$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['icash_learning_changed','icash_refresh_shared_learning','icash_workspace_revision_batch']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
commit;
