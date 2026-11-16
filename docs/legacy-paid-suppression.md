# Scoped paid-receipt suppression

Both invoice insertion and membership payer/paid-through updates previously called
launch-wide legacy synchronization inside settlement. A native synthetic fixture
reproduces transaction cancellation when an unrelated contact in the same large
launch is locked. Production logs independently show SQLSTATE 57014 in this trigger
stack; exact customer-event correlation and the precise cancellation cause remain
unproven. This repair is separate from introductory checkout routing PR756.

The payment trigger now selects all exact email, phone and explicit checkout-bound
contacts of the affected live membership. Indexed UNION branches deduplicate IDs
without truncating matches. Each target retains earliest receipt attribution across
all of its matched live memberships, including historical cancelled/refunded ones.
Existing conversions, suppression reasons, stop/reply times and provider history
remain intact. Only queued messages for those targets are cancelled. Full-launch
maintenance and final send authorization remain unchanged.

Contacts and queued outbox rows are locked in ID order with NOWAIT. Dispatch owns
outbox rows first, and delivery can then update a contact: waiting in the opposite
order risks deadlock. A required busy row instead fails the complete settlement
visibly. It is never skipped, nor is suppression deferred or swallowed. A later
ordinary idempotent processing attempt remains necessary after any failed receipt.
An already authorized external send cannot be recalled by this transaction.

The forward migration pins the live predecessor function hash, validates exact
index definitions/readiness, retains invoker privileges, and adds an email-leading
contact index. Existing correctly named live-membership email/phone indexes are
reused; a fresh database gets those indexes. Review table sizes and a bounded index
installation window before applying: ordinary transactional index creation blocks
writes while building. The migration's local two-second lock timeout must not be
raised to force installation. No production DDL or activation is authorized here.

Release requires independent exact-tree review, all canonical checks including
native contention, separately authorized migration installation and receipt checks,
then the normal serialized web release. Preserve all existing release-owner and
health holds. Installation never backfills access, replays a webhook, sends a code
or restores this customer's account. Customer reconciliation requires a separate
review of the original invoice, identity, current holds and idempotent result.
