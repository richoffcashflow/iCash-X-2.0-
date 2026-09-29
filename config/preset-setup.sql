-- Retire the guided-vs-quick enrollment; preserve historical assignments.
alter table public.icash_bot_setups alter column flow_variant set default 'quick';
alter table public.icash_bot_setups alter column flow_experiment drop default;

-- A direct save to the final stage still records the genuinely saved name.
create or replace function public.icash_save_bot_setup(p_setup uuid,p_revision integer,p_profile jsonb,p_stage integer) returns jsonb language plpgsql set search_path='' as $$
declare s public.icash_bot_setups;e text;
begin
 select * into s from public.icash_bot_setups where id=p_setup for update;
 if not found or s.revision<>p_revision then return null;end if;
 if p_stage not between 0 and 4 or length(trim(p_profile->>'displayName')) not between 1 and 64 then raise exception 'Invalid setup';end if;
 update public.icash_bot_setups set profile=p_profile,stage=p_stage,revision=revision+1,updated_at=now() where id=p_setup returning * into s;
 perform public.icash_record_setup_event(s.id,'name_saved');
 e:=case p_stage when 1 then 'name_saved' when 2 then 'style_saved' when 3 then 'voice_saved' when 4 then 'market_saved' else null end;
 if e is not null then perform public.icash_record_setup_event(s.id,e);end if;
 if p_stage=4 then perform public.icash_record_setup_event(s.id,'setup_completed');end if;
 return to_jsonb(s)-'guest_hash'-'account_id';
end $$;
