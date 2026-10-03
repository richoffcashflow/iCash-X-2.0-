begin;
-- Standard forms are owner-selected generic documents, not state/counsel certifications.
-- Keep state_code as historical metadata; never copy an approval across state records.
-- Existing expiry, rate, signer, field, provider and account checks remain in force.
alter table public.icash_signing_templates add column if not exists template_scope text not null default 'state' check(template_scope in ('state','standard'));
create unique index if not exists icash_standard_template_kind_signers_mode
 on public.icash_signing_templates(kind,signer_count,test_mode) where template_scope='standard';
create unique index if not exists icash_state_template_state_kind_signers_mode
 on public.icash_signing_templates(state_code,kind,signer_count,test_mode) where template_scope='state';
-- Retire only the original four-column uniqueness constraint. The two scoped
-- indexes preserve uniqueness while allowing a TX form beside a standard form
-- whose historical state_code is TX.
do $uniqueness$
declare old_constraint text;
begin
 select c.conname into old_constraint from pg_catalog.pg_constraint c
 where c.conrelid='public.icash_signing_templates'::regclass and c.contype='u'
 and (select array_agg(a.attname::text order by k.ordinality)
      from unnest(c.conkey) with ordinality k(attnum,ordinality)
      join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)
     =array['state_code','kind','signer_count','test_mode'];
 if old_constraint is not null then execute format('alter table public.icash_signing_templates drop constraint %I',old_constraint);end if;
end $uniqueness$;


create or replace function public.icash_market_contract_ready(p_zip text,p_signers integer default 1)
returns boolean language sql stable set search_path='' as $$
 select p_signers between 1 and 8 and exists(
  select 1 from public.icash_market_shortlist m
  where m.zip=p_zip and not exists(
   select 1 from unnest(array['purchase','assignment']) required(kind)
   where not exists(select 1 from public.icash_signing_templates t join public.icash_operation_rates r on r.id=t.rate_id
    where (t.template_scope='standard' or t.state_code=m.state) and t.kind=required.kind and t.signer_count=p_signers and t.enabled and not t.test_mode
    and t.provider='docuseal' and t.reviewed_until>now() and r.enabled and r.operation='contract_signing' and r.expires_at>now())
  )
 );
$$;
revoke all on function public.icash_market_contract_ready(text,integer) from public,anon,authenticated;
grant execute on function public.icash_market_contract_ready(text,integer) to service_role;

do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure);
 needle:='and state_code=d.terms->>''state''';
 replacement:='and (template_scope=''standard'' or state_code=d.terms->>''state'')';
 if position(replacement in definition)=0 then
  if position(needle in definition)=0 then raise exception 'Unexpected signing template selector; inspect before patching';end if;
  execute replace(definition,needle,replacement);
 end if;
end $patch$;
commit;
