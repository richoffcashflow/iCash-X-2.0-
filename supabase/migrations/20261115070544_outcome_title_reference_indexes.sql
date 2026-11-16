-- Cover each title-attribution foreign key without changing recorded origins,
-- reuse evidence, access policy, or the disabled outcome-learning gate.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create index title_qualification_origins_deal
 on icash_learning_private.title_qualification_origins(deal_id);
create index title_qualification_origins_screening
 on icash_learning_private.title_qualification_origins(screening_id);
create index title_qualification_reuses_deal
 on icash_learning_private.title_qualification_reuses(deal_id);
create index title_qualification_reuses_screening
 on icash_learning_private.title_qualification_reuses(screening_id);
commit;
