begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Only the reviewed pure classifier changes. Existing fresh-source, package,
-- contact, Pause, price, reservation, final-send and one-use claims still apply.
-- No jobs, messages, timestamps, controls or provider operations are rewritten.
do $$ begin
 if (select md5(prosrc) from pg_proc where oid='public.icash_buyer_request_action(text)'::regprocedure)
  is distinct from '51695e804fbde133d5979e542f5a1dfd' then
  raise exception 'Buyer request classifier predecessor changed';
 end if;
end $$;
create or replace function public.icash_buyer_request_action(p_body text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare b text:=lower(btrim(replace(p_body,'’','''')));
 item text:='(the |some |more |available )?(deal |property |buyer )?(details|info|information|photos|pictures|package|price|address)';
begin
 if b is null or length(b)>250 then return null;end if;
 b:=regexp_replace(b,'[?!.]+[[:space:]]*$','','g');
 if b ~ '^(please )?(send( me)?|text( me)?|can you send( me)?|could you send( me)?) (the |some |more )?(deal |property |buyer )?(details|info|information|photos|pictures|package)( please)?$'
  or b ~ '^(details|photos|pictures|more info|more information)( please)?$' then return 'package';
 elsif b ~ '^(how (do|can) i |i (want|would like) to )?(join (the |your )?buyer network|(set|update|change) my (buy box|buying preferences|buying criteria))$'
  or b ~ '^i (buy|can buy|am buying) [0-9]{1,2} (houses|properties)( a| per)? month in [0-9]{5}(, ?[0-9]{5}){0,19}$' then return 'preferences';
 elsif b ~ '^(what(''s| is) (the |my )?next step|how (do|can) i move forward|(please )?(send|text)( me)? (the |my )?(next steps|buyer details link|signing link))$' then return 'next_step';
 end if;
 -- Multiple nouns are safe only when the ENTIRE request is package information.
 -- No substring extraction: conditions, changed terms, opt-outs, wiring, access,
 -- refunds, agreements and additional actions keep their original workflow.
 b:=regexp_replace(b,'[[:space:]]+',' ','g');
 if b ~ ('^(please )?((send( me)?|text( me)?|can you send( me)?|could you send( me)?|can i see) )?'
  ||item||'((, *(and )?| and | & )'||item||'){1,4}( please)?$') then return 'package';end if;
 return null;
end $$;
revoke all on function public.icash_buyer_request_action(text) from public,anon,authenticated;
grant execute on function public.icash_buyer_request_action(text) to service_role;
commit;
