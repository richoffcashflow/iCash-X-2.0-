begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create index research_account_base_rate on icash_research_private.account_rates(base_rate);
create index research_owner_batch_members on icash_research_private.owner_batch_items(batch_id);
create index research_claim_account on icash_research_private.query_claims(account_id);
create index research_batch_rate on icash_research_private.rate_versions(batch_rate);
commit;
