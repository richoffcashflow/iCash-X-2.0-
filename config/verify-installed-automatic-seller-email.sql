-- Verification-only recovery for automatic_seller_email.
-- Source commit: bbf5bf420e6968f2cad1a6c5a65114f12d8c8ec6
-- Source: supabase/migrations/20261019170227_automatic_seller_email.sql
-- Git blob: e4373d8d6c4056caae1ac37e271517ac40e97fed (14,372 UTF-8 bytes).
-- The exact source transaction committed on 2026-10-19, then the migration
-- service could not insert its history row because generated version
-- 20261019174038 already belonged to propertymsgs_buyer_package_links.
-- This script does NOT replay DDL, enqueue work, send email, change credit
-- balances, or insert/alter history itself. apply_migration records this
-- successful verification under a fresh service-generated version.
-- Function body hashes were independently derived from the committed source;
-- preserved delegate hashes were compared with their earlier committed bodies.
do $verify_automatic_seller_email$
declare expected record;proc oid;actual jsonb;
begin
 if exists(select 1 from supabase_migrations.schema_migrations where name='automatic_seller_email') then
  raise exception 'automatic_seller_email already recorded; do not duplicate recovery';
 end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261019174038' and name='propertymsgs_buyer_package_links') then
  raise exception 'Expected migration-history collision evidence is absent';
 end if;
 if to_regclass('public.icash_seller_email_openers') is null then raise exception 'Seller email table is absent';end if;
 select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
 into actual from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attrelid='public.icash_seller_email_openers'::regclass and a.attnum>0 and not a.attisdropped;
 if actual is distinct from '[{"name":"account_id","type":"uuid","notnull":true,"default":null},{"name":"deal_id","type":"uuid","notnull":true,"default":null},{"name":"lead_id","type":"uuid","notnull":true,"default":null},{"name":"email_id","type":"uuid","notnull":true,"default":null},{"name":"recipient","type":"text","notnull":true,"default":null},{"name":"created_at","type":"timestamp with time zone","notnull":true,"default":"now()"}]'::jsonb then
  raise exception 'Seller email columns differ from committed migration';
 end if;
 if (select count(*) from pg_constraint where conrelid='public.icash_seller_email_openers'::regclass)<>6 then raise exception 'Seller email constraint count changed';end if;
 for expected in select * from (values
  ('icash_seller_email_openers_account_id_fkey','FOREIGN KEY (account_id) REFERENCES icash_accounts(id)','public.icash_accounts'),
  ('icash_seller_email_openers_deal_id_fkey','FOREIGN KEY (deal_id) REFERENCES icash_deal_files(id)','public.icash_deal_files'),
  ('icash_seller_email_openers_lead_id_fkey','FOREIGN KEY (lead_id) REFERENCES icash_seller_intakes(id)','public.icash_seller_intakes'),
  ('icash_seller_email_openers_email_id_fkey','FOREIGN KEY (email_id) REFERENCES icash_deal_emails(id)','public.icash_deal_emails'),
  ('icash_seller_email_openers_email_id_key','UNIQUE (email_id)',null),
  ('icash_seller_email_openers_pkey','PRIMARY KEY (account_id, deal_id)',null)
 ) checks(name,definition,target) loop
  if not exists(select 1 from pg_constraint c where c.conrelid='public.icash_seller_email_openers'::regclass and c.conname=expected.name and c.convalidated
   and replace(pg_get_constraintdef(c.oid),'public.','')=expected.definition
   and (expected.target is null or c.confrelid=to_regclass(expected.target))) then
   raise exception 'Seller email constraint mismatch: %',expected.name;
  end if;
 end loop;
 if not exists(select 1 from pg_class where oid='public.icash_seller_email_openers'::regclass and relkind='r' and relrowsecurity)
  or exists(select 1 from pg_policies where schemaname='public' and tablename='icash_seller_email_openers')
  or exists(select 1 from pg_trigger where tgrelid='public.icash_seller_email_openers'::regclass and not tgisinternal)
  or (select count(*) from pg_index where indrelid='public.icash_seller_email_openers'::regclass)<>2
  or exists(select 1 from pg_index where indrelid='public.icash_seller_email_openers'::regclass and (not indisvalid or not indisready)) then
  raise exception 'Seller email RLS, index or trigger state differs';
 end if;
 if has_table_privilege('anon','public.icash_seller_email_openers','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or has_table_privilege('authenticated','public.icash_seller_email_openers','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.icash_seller_email_openers'::regclass and a.grantee=0)
  or not has_table_privilege('service_role','public.icash_seller_email_openers','SELECT')
  or not has_table_privilege('service_role','public.icash_seller_email_openers','INSERT') then
  raise exception 'Seller email table permissions differ';
 end if;
 for expected in select * from (values
  ('public.icash_seller_email_opening(uuid,uuid)','6016b01ba711f526a119ae28c40c5922','4eaef568e04b29395471efc2a9230da9'),
  ('public.icash_queue_seller_emails(integer)','5d4010aa5731f0a55e28ba150a93329d','3b9143b091c25afc77f4a919c0de1620'),
  ('public.icash_claim_deal_email(uuid,uuid)','0e55f868bb5a5ccd6c47300e76a659c5','4032169e689e732e83e9b546ee419b23'),
  ('public.icash_record_deal_email_reply(uuid,uuid,text,text,text,boolean)','c89cc1733024bd84643de4b03876c495','2f09db65f6e8fc23dd8c6c19fcd6b413'),
  ('public.icash_claim_email_before_seller_opening(uuid,uuid)','838bb061dfc737bc39b27db1f9b04d1e','d70277adc79f3799754ab1825274b545'),
  ('public.icash_record_email_reply_before_seller_opening(uuid,uuid,text,text,text,boolean)','53ef7245486031eb55e0fc7486e5ec33','c7dba0ac107efacc79d7558c11d25d38'),
  ('public.icash_refresh_opportunity_outcomes(uuid)','fbb5b8c468aa5eab3faf39dabf39da13','c28d963ab276576d7ca41aef36af7672')
 ) checks(signature,source_hash,definition_hash) loop
  proc:=to_regprocedure(expected.signature);
  if proc is null or not exists(select 1 from pg_proc p where p.oid=proc and md5(p.prosrc)=expected.source_hash and md5(pg_get_functiondef(p.oid))=expected.definition_hash) then
   raise exception 'Seller email function differs from verified committed installation: %',expected.signature;
  end if;
  if has_function_privilege('anon',proc,'EXECUTE') or has_function_privilege('authenticated',proc,'EXECUTE')
   or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=proc and a.grantee=0)
   or not has_function_privilege('service_role',proc,'EXECUTE') then
   raise exception 'Seller email function permissions differ: %',expected.signature;
  end if;
 end loop;
end $verify_automatic_seller_email$;
