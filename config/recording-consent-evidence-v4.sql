-- Shared immutable validators for signed final Gather evidence. No data/configuration/history writes.
begin;
create schema if not exists icash_voice_consent_private;
revoke all on schema icash_voice_consent_private from public,anon,authenticated,service_role;
create or replace function icash_voice_consent_private.natural_affirmative_v3(p_text text) returns boolean language plpgsql immutable set search_path='' as $grammar$
declare s text;
begin
 if p_text is null or length(p_text)=0 or length(p_text)>120 or strpos(p_text,'..')>0 then return false;end if;
 s:=translate(p_text,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(160),'      ');
 if s !~ '^[A-Za-z ,.!?''’‘]+$' then return false;end if;
 if strpos(s,'?')>0 then return trim(lower(s)) ~ '^(yes|yeah|yep|sure|okay|ok|absolutely|certainly)[,.!? ]*$';end if;
 s:=lower(translate(s,'’‘',''''''));
 s:=replace(replace(replace(s,'that''s','that is'),'it''s','it is'),'i''m','i am');
 s:=trim(regexp_replace(translate(s,',.!','   '),' +',' ','g'));
 return s ~ '^((yes|yeah|yep|sure|okay|ok|absolutely|certainly)( please)?|(that is|it is) (okay|ok|fine)( with me)?|(it is |that is )?(okay|ok|fine) to record( (this|the) call)?|(you (can|may) record|please record)( (this|the) call)?|record (this|the) call|(you (can|may) )?go ahead( (and )?record( (this|the) call)?)?|i (agree|consent)( to (recording|you recording)( (this|the) call)?)?|i am (okay|ok|fine) with (that|you recording( (this|the) call)?))( (and )?((yes|yeah|yep|sure|okay|ok|absolutely|certainly)( please)?|(that is|it is) (okay|ok|fine)( with me)?|(it is |that is )?(okay|ok|fine) to record( (this|the) call)?|(you (can|may) record|please record)( (this|the) call)?|record (this|the) call|(you (can|may) )?go ahead( (and )?record( (this|the) call)?)?|i (agree|consent)( to (recording|you recording)( (this|the) call)?)?|i am (okay|ok|fine) with (that|you recording( (this|the) call)?))){0,5}$';
end $grammar$;

create function icash_voice_consent_private.contact_opt_out_v3(p_text text) returns boolean language plpgsql immutable set search_path='' as $$
declare s text;remaining text;parts text[];prefix text;request text;
begin
 if p_text is null or length(p_text) not between 1 and 16384 then return false;end if;
 s:=translate(p_text,'’‘','''''');s:=translate(s,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279),repeat(' ',25));s:=regexp_replace(translate(s,',.!','   '),' +',' ','g');
 remaining:=s;
 loop
  parts:=regexp_match(remaining collate "C",'^(.*?)(^|[^A-Za-z0-9_])((do not|don''t|never) (ever )?(call|text|contact)|(stop|quit) (calling|texting|contacting)|(stop|no more) (these |the )?(calls|texts|messages)|(do not|don''t) want (you|your (company|business)) to (ever )?(call|text|contact)|(do not|don''t) want (any (more )?|anymore |more )?(calls|texts|contact)|remove (me|my number)|take (me|my number) off)([^A-Za-z0-9_]|$)','i');
  if parts is null then return false;end if;
  prefix:=parts[1]||parts[2];request:=parts[3];
  if request collate "C" !~* '^(stop|quit|remove|take)([^A-Za-z0-9_]|$)'
   or prefix collate "C" !~* '(^|[^A-Za-z0-9_])((do not|don''t|never|not)( ever)?|(do not|don''t) want (you|your (company|business)) to( ever)?) $' then return true;end if;
  remaining:=substring(remaining from length(prefix)+length(request)+1);
 end loop;
end $$;
create function icash_voice_consent_private.valid_final_evidence_v4(p jsonb,p_expected_version text default 'recorded-final-natural-affirmative-advisory-v4') returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or p_expected_version is null or p_expected_version not in ('recorded-final-natural-affirmative-advisory-v4','owner-final-natural-affirmative-advisory-v4') or p->>'evidenceVersion' is distinct from p_expected_version or p->>'confidencePolicy' is distinct from 'advisory'
  or p->>'resultKind' is distinct from 'gather_action_final' or jsonb_typeof(p->'utterance') is distinct from 'string'
  or not icash_voice_consent_private.natural_affirmative_v3(p->>'utterance')
  or not (p ? 'confidence') or not (p ? 'confidenceReported') then return false;end if;
 if jsonb_typeof(p->'confidence')='null' then
  return p->>'confidenceBasis' is not distinct from 'not_provided' and jsonb_typeof(p->'confidenceReported') is not distinct from 'null';
 elsif jsonb_typeof(p->'confidence')='number' then
  if (p->>'confidence')::numeric not between 0 and 1 or p->>'confidenceBasis' is distinct from 'provider_reported'
   or jsonb_typeof(p->'confidenceReported') is distinct from 'string' or (p->>'confidenceReported') !~ '^(0|1|0?\.[0-9]{1,30}|1\.[0-9]{1,30})$' then return false;end if;
  return (p->>'confidenceReported')::numeric between 0 and 1 and (p->>'confidenceReported')::double precision is not distinct from (p->>'confidence')::double precision;
 end if;return false;
end $$;
create function icash_voice_consent_private.keys(p jsonb,required text[]) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p) is distinct from 'object' then false else p ?& required and not exists(select 1 from jsonb_object_keys(p) k where not k=any(required)) end;
$$;
revoke all on all functions in schema icash_voice_consent_private from public,anon,authenticated,service_role;
-- Preserve the owner API/provenance while sharing its byte-equivalent grammar when installed.
do $wrapper$ begin
 if to_regprocedure('icash_owner_recording_private.natural_affirmative_v3(text)') is not null then
  execute $definition$create or replace function icash_owner_recording_private.natural_affirmative_v3(p_text text) returns boolean language sql immutable set search_path='' as $body$select icash_voice_consent_private.natural_affirmative_v3(p_text)$body$$definition$;
  revoke all on function icash_owner_recording_private.natural_affirmative_v3(text) from public,anon,authenticated,service_role;
 end if;
end $wrapper$;
commit;
