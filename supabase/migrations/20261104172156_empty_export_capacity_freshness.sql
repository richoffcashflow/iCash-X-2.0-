-- Harden the existing disabled empty-idle-v1 policy with original provider
-- response freshness. Keep the exact rejection, claims, history and holds.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
do $check$
declare item record;
begin
 for item in select * from (values
  ('icash_research_private.capacity_source_policy(uuid,text)','8f433a6eb4aaf8ef0ccf1b883f1fe132'),
  ('icash_research_private.guard_capacity_precision_followup()','f6510216db7756ae14f9bf4d608479ed'),
  ('public.icash_claim_automatic_export_capacity(text)','2bdb89367de2251258a2b26323694182'),
  ('public.icash_claim_export_capacity_probe(uuid,text)','4f0b5d2c442218dfb259c7d91206c12f'),
  ('public.icash_finish_automatic_export_capacity(uuid)','488dbd38f57278660bcb3c2c7d1dc0ce')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(item.signature::regprocedure))<>item.checksum then
   raise exception 'Empty export freshness prerequisite changed: %',item.signature;
  end if;
 end loop;
 if not exists(select 1 from icash_research_private.export_capacity_automation where id=1 and not empty_enabled) then
  raise exception 'Empty export policy must remain disabled until release verification';
 end if;
end $check$;

do $patch$
declare d text;needle text:='   raw:=p.receipt->''raw'';';
begin
 d:=pg_get_functiondef('public.icash_finish_automatic_export_capacity(uuid)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Empty export response proof prerequisite changed';end if;
 d:=replace(d,needle,needle||$proof$
   -- Only the exact empty policy can use provider response freshness.
   -- Date/Age are captured from the original HTTPS response, never local time.
   if r.auto_policy='empty-idle-v1' then
    if jsonb_typeof(p.receipt#>'{headers,serverDate}') is distinct from 'string'
     or coalesce(p.receipt#>>'{headers,serverDate}','') !~ '^[A-Z][a-z]{2}, [0-9]{2} [A-Z][a-z]{2} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$'
     or coalesce(p.receipt#>'{headers,age}','null'::jsonb) not in ('null'::jsonb,'"0"'::jsonb)
    then valid:=false;exit;end if;
    stamp:=(p.receipt#>>'{headers,serverDate}')::timestamptz;
    if stamp not between date_trunc('second',p.started_at)-interval '5 seconds' and date_trunc('second',p.received_at)+interval '5 seconds'
    then valid:=false;exit;end if;
   end if;
$proof$);
 execute d;
 if pg_get_functiondef('public.icash_finish_automatic_export_capacity(uuid)'::regprocedure)<>d then raise exception 'Empty export freshness verification failed';end if;
end $patch$;
notify pgrst,'reload schema';
commit;
