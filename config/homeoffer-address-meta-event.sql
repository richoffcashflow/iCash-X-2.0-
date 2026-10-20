begin;
set local lock_timeout='3s';

alter table public.icash_seller_events drop constraint icash_seller_events_event_name_check;
alter table public.icash_seller_events add constraint icash_seller_events_event_name_check
 check(event_name in ('CompleteRegistration','PropertyAddressConfirmed','Lead','Contact','SubmitApplication'));

-- A saved address is its own milestone, before research or qualification.
-- Reuse the original registration receipt and timestamp; retries never create
-- another event or make an old submission look like a new conversion.
create function public.icash_record_seller_intake_measurement(p_lead uuid,p_guest text,p_measurement jsonb,p_opted_out boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare registration text;address_event uuid;
begin
 registration:=public.icash_record_seller_measurement(p_lead,p_guest,p_measurement,p_opted_out);
 if registration is null then return null;end if;
 insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref)
 select l.id,'PropertyAddressConfirmed',r.occurred_at,'seller-form-address:'||r.id
 from public.icash_seller_intakes l join public.icash_seller_events r on r.lead_id=l.id and r.event_name='CompleteRegistration'
 where l.id=p_lead and l.guest_hash=p_guest and length(trim(l.address)) between 8 and 300
 on conflict(lead_id,event_name) do nothing;
 select id into address_event from public.icash_seller_events where lead_id=p_lead and event_name='PropertyAddressConfirmed';
 return jsonb_build_object('registrationEventId',registration,'addressEventId',case when address_event is not null then 'keypath:'||address_event end);
end $$;
revoke all on function public.icash_record_seller_intake_measurement(uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.icash_record_seller_intake_measurement(uuid,text,jsonb,boolean) to service_role;

do $$declare definition text;needle text:='when e.event_name=''CompleteRegistration'' then ''website''';begin
 definition:=pg_get_functiondef('public.icash_claim_seller_event()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller event claim prerequisite changed';end if;
 execute replace(definition,needle,'when e.event_name in (''CompleteRegistration'',''PropertyAddressConfirmed'') then ''website''');
end $$;
commit;
