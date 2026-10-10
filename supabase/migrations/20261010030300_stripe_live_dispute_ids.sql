-- Accept the live du_ identifier shown by Stripe's Dispute API, while retaining dp_.
alter table public.icash_dispute_events
 drop constraint icash_dispute_events_dispute_id_check,
 add constraint icash_dispute_events_dispute_id_check
 check (dispute_id ~ '^d[pu]_[A-Za-z0-9]{1,240}$');
