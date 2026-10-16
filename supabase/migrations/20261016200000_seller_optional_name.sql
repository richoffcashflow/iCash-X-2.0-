-- HomeOffer Network intake needs only the submitted address and phone.
-- Preserve existing names, consent evidence, deduplication and legal-name gates.
-- The existing length check still validates names when they are supplied.
set local lock_timeout='3s';
alter table public.icash_seller_intakes alter column name drop not null;
comment on column public.icash_seller_intakes.name is
 'Optional seller-supplied name. NULL until supplied; never substitute property-record ownership or a placeholder. Legal signing identity is confirmed separately.';
