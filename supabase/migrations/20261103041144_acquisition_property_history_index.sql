-- Resolve an exact property's historical contacts and unknown operations
-- without rescanning every screening in the account for each candidate.
-- Property first also supports the existing contact-history join, whose tenant
-- authority remains the owner-contact account predicate. No query/rule changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index icash_screening_property_account
 on public.icash_screening_jobs((snapshot->>'propertyId'),account_id) include(id);
commit;
