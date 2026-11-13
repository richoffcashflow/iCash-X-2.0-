begin;
set local lock_timeout='5s';
create schema if not exists icash_owner_reset_private;
revoke all on schema icash_owner_reset_private from public,anon,authenticated;
grant usage on schema icash_owner_reset_private to service_role;
create table if not exists icash_owner_reset_private.requests(
 request_id uuid primary key,account_id uuid not null references public.icash_accounts(id),actor_user_id uuid not null,
 completed_at timestamptz not null default now(),receipt jsonb not null,before_rows jsonb not null
);
create table if not exists icash_owner_reset_private.intakes(
 lead_id uuid primary key references public.icash_seller_intakes(id),request_id uuid not null references icash_owner_reset_private.requests(request_id),
 account_id uuid not null references public.icash_accounts(id)
);
alter table icash_owner_reset_private.requests enable row level security;
alter table icash_owner_reset_private.intakes enable row level security;
revoke all on all tables in schema icash_owner_reset_private from public,anon,authenticated;
grant select,insert on all tables in schema icash_owner_reset_private to service_role;

-- Both address/phone and provider-property deduplication already use this helper.
-- Also exclude reset requests that never reached assignment; retain original IDs.
create or replace function public.icash_demo_intake_current(p_lead uuid,p_account uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_seller_intakes l
 where l.id=p_lead and l.contact_consent_scope='icash_x_demo' and l.attribution->>'demoAccountId'=p_account::text
 and not exists(select 1 from icash_owner_reset_private.intakes a where a.lead_id=l.id and a.account_id=p_account)
 and (not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id)
 or exists(select 1 from public.icash_seller_matches m join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
 where m.lead_id=l.id and m.account_id=p_account and s.state<>'archived')));
$$;
revoke all on function public.icash_demo_intake_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_demo_intake_current(uuid,uuid) to service_role;

create or replace function public.icash_reset_owner_account(p_actor uuid,p_account uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='3s' set statement_timeout='15s' as $reset$
declare ids uuid[];leads uuid[];snapshot jsonb;receipt jsonb;retired integer;questions integer;texts integer;calls integer;
 cutoff timestamptz:=statement_timestamp();
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
 or p_account is distinct from '48dfb798-8c1a-404f-88c0-c396cc067062'::uuid or p_request is null then
  raise exception 'Owner account required' using errcode='42501';end if;
 -- Same order as final paid admission; the account lock also serializes intake submission.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Owner account required' using errcode='42501';end if;
 select r.receipt into receipt from icash_owner_reset_private.requests r
 where r.request_id=p_request and r.account_id=p_account and r.actor_user_id=p_actor;
 if found then return receipt;end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into ids from public.icash_screening_jobs
 where account_id=p_account and created_at<=cutoff and state<>'archived';
 perform 1 from public.icash_screening_jobs where id=any(ids) and account_id=p_account for update;
 select coalesce(array_agg(id),'{}'::uuid[]) into leads from public.icash_seller_intakes l
 where l.contact_consent_scope='icash_x_demo' and l.attribution->>'demoAccountId'=p_account::text and l.created_at<=cutoff
 and not exists(select 1 from icash_owner_reset_private.intakes a where a.lead_id=l.id)
 and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id<>p_account);
 perform 1 from public.icash_seller_intakes where id=any(leads) for update;
 -- Wait for actual in-flight work; never terminate a call or declare unknown spending settled.
 if exists(select 1 from public.icash_call_recordings where account_id=p_account and call_ended_at is null
  and (call_sid is not null or dial_claimed_at is not null) and state in ('consent_pending','starting','recording','stopping'))
 or exists(select 1 from icash_recorded_reception_private.sessions where account_id=p_account and call_ended_at is null)
 then return jsonb_build_object('status','waiting','reason','active_call');end if;
 if exists(select 1 from public.icash_screening_jobs where account_id=p_account and id=any(ids) and state='running')
 or exists(select 1 from public.icash_seller_intakes where id=any(leads) and state='checking')
 or exists(select 1 from public.icash_voice_jobs where account_id=p_account and state in ('issued','dispatching'))
 or exists(select 1 from public.icash_text_messages where account_id=p_account and state='dispatching')
 or exists(select 1 from public.icash_workspace_questions where account_id=p_account and archived_at is null and state='pending')
 or exists(select 1 from public.icash_text_ai_jobs where account_id=p_account and state in ('issued','analyzing'))
 then return jsonb_build_object('status','waiting','reason','active_work');end if;
 select jsonb_build_object(
 'screenings',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from public.icash_screening_jobs s where s.account_id=p_account and s.id=any(ids)),
 'intakes',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from public.icash_seller_intakes l where l.id=any(leads)),
 'threads',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.icash_text_threads t where t.account_id=p_account and t.retired_at is null),
 'controls',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.icash_property_controls c where c.account_id=p_account),
 'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'archived_at',q.archived_at)),'[]'::jsonb) from public.icash_workspace_questions q where q.account_id=p_account and q.archived_at is null)
 ) into snapshot;
 update public.icash_contact_permissions set revoked_at=coalesce(revoked_at,cutoff)
 where account_id=p_account and screening_id=any(ids);
 update public.icash_operational_contacts set revoked_at=coalesce(revoked_at,cutoff)
 where account_id=p_account and screening_id=any(ids);
 -- Include retired historic properties to repair stale orphaned demo conversation UI.
 update public.icash_text_threads t set paused=true,ai_mode='off',retired_at=coalesce(retired_at,cutoff)
 where t.account_id=p_account and (exists(select 1 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where d.id=t.deal_id and d.account_id=t.account_id and (s.id=any(ids) or s.state='archived')) or t.seller_intake_id=any(leads));
 get diagnostics retired=row_count;
 update public.icash_text_messages m set state='cancelled' where m.account_id=p_account and m.direction='outgoing' and m.state='ready' and m.provider_id is null
 and exists(select 1 from public.icash_text_threads t where t.id=m.thread_id and t.account_id=m.account_id and t.retired_at is not null)
 and not exists(select 1 from public.icash_operation_spend o where o.account_id=m.account_id and o.operation_key='text:'||m.id);
 get diagnostics texts=row_count;
 update public.icash_live_callbacks set state='canceled' where account_id=p_account and screening_id=any(ids) and state in ('pending_dispatch_review','held_for_human');
 update public.icash_voice_jobs j set state='canceled',outcome='Owner reset; a new demo request is required',updated_at=cutoff
 where j.account_id=p_account and j.state in ('ready','held') and j.operation_key is null and j.provider_call_sid is null and j.conversation_id is null
 and not exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='voice:'||j.id)
 and (exists(select 1 from public.icash_contact_permissions p where p.id=j.permission_id and p.account_id=j.account_id and p.screening_id=any(ids))
 or exists(select 1 from public.icash_operational_contacts c where c.id=j.operational_contact_id and c.account_id=j.account_id and c.screening_id=any(ids)));
 get diagnostics calls=row_count;
 update public.icash_seller_responses set state='stopped',updated_at=cutoff where account_id=p_account and screening_id=any(ids) and state<>'stopped';
 update public.icash_text_ai_jobs j set state='superseded',updated_at=cutoff where j.account_id=p_account and j.state in ('pending','drafted','queued')
 and exists(select 1 from public.icash_text_threads t where t.id=j.thread_id and t.account_id=j.account_id and t.retired_at is not null)
 and not exists(select 1 from public.icash_operation_spend o where o.account_id=j.account_id and o.operation_key='text-ai:'||j.id);
 update public.icash_seller_gaps set state='suppressed',updated_at=cutoff where account_id=p_account and screening_id=any(ids) and state in ('open','queued','waiting','needs_review');
 update public.icash_seller_intakes set state='review',next_assignment_at='infinity',hold_reason='Owner reset; a new demo request is required' where id=any(leads) and state<>'duplicate';
 update public.icash_screening_jobs set state='archived' where account_id=p_account and id=any(ids);
 -- Old per-property manual controls must not stop a fresh request for the same property.
 update public.icash_property_controls c set manual=false,updated_at=cutoff where c.account_id=p_account
 and exists(select 1 from public.icash_screening_jobs s where s.account_id=p_account and s.state='archived' and s.snapshot->>'propertyId'=c.property_id)
 and not exists(select 1 from public.icash_screening_jobs s where s.account_id=p_account and s.state<>'archived' and s.snapshot->>'propertyId'=c.property_id);
 update public.icash_workspace_questions set archived_at=cutoff where account_id=p_account and archived_at is null and created_at<=cutoff;
 get diagnostics questions=row_count;
 if exists(select 1 from public.icash_screening_jobs where account_id=p_account and created_at<=cutoff and state<>'archived')
 or exists(select 1 from public.icash_seller_responses where account_id=p_account and screening_id=any(ids) and state<>'stopped')
 or exists(select 1 from public.icash_contact_permissions where account_id=p_account and screening_id=any(ids) and revoked_at is null)
 then raise exception 'Owner reset verification failed';end if;
 receipt:=jsonb_build_object('status','reset','requestId',p_request,'completedAt',cutoff,'propertiesCleared',cardinality(ids),'requestsCleared',cardinality(leads),'threadsRetired',retired,'questionsCleared',questions,'queuedTextsCanceled',texts,'queuedCallsCanceled',calls,'providerWrites',false,'historyPreserved',true);
 insert into icash_owner_reset_private.requests(request_id,account_id,actor_user_id,receipt,before_rows) values(p_request,p_account,p_actor,receipt,snapshot);
 insert into icash_owner_reset_private.intakes(lead_id,request_id,account_id) select unnest(leads),p_request,p_account;
 return receipt;
end $reset$;
revoke all on function public.icash_reset_owner_account(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_reset_owner_account(uuid,uuid,uuid) to service_role;
commit;
