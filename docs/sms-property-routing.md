# Same-number, separate-property SMS routing

## What changed

A seller can have multiple immutable property threads on one business-number/recipient pair within one account. A second active property requires a separately assigned seller intake with current consent. The existing property's messages, consent reference, manual controls, and identifiers are never moved or renewed.

The migration adds:

- `icash_sms_routes`: permanent number-pair account owner, routing revision, review hold.
- `icash_sms_route_reviews`: unassigned inbound messages needing account-level review and owner-resolution audit.
- `icash_text_messages.route_revision`: enqueue/source/dispatch compare-and-swap boundary.
- Active uniqueness on `(account_id, deal_id, sender, recipient)` instead of the number pair alone.
- Immutable property/identity/consent-source bindings; retired threads cannot reopen.
- Conservative deterministic inbound selection: an exact normalized street-address portion identifies exactly one active seller thread. If multiple threads exist, short replies, prices, contract requests, attachment-only messages, unmatched addresses, and messages mentioning multiple properties stay unassigned.
- Account-level Needs you cards, safe attachment links, candidate-property navigation, and owner/revision-checked review action.

Existing STOP suppression remains recipient-global. Existing delivery receipt and acceptance reconciliation is retained. Cross-account pairs and mixed active buyer/seller roles fail closed. Voice, signing, outreach hours, consent rules, cost rates, and funding/budget policy definitions are not changed.

## Important behavior

Creating a second property or receiving a new message invalidates older queued routing decisions. Dispatch holds stale work for review before any original reservation/provider gate. An old AI result cannot acquire new authority by queueing after a newer incoming message. Practice reply preparation checks its exact incoming revision too.

Unassigned messages never receive a thread later and never re-enter AI/contract/property-signal processing. Owner review records who reviewed that exact message/revision. Only after all outstanding ambiguous messages are reviewed is the number's routing hold released. A subsequent explicit property reply can also establish fresh routing context. Review does not send a text, remove STOP, change manual controls, or infer agreed terms.

Address matching deliberately fails closed. For example, a saved `2149 Arden Rd, Dallas TX` matches `About 2149 Arden Rd`; just `Arden` remains a review item. No fuzzy address inference, latest-thread wins, or provider-delivery-based attribution is used.

## Rollout order and exact mutation scope

1. Review `supabase/migrations/20261007221403_sms_property_routing.sql` and the matching config file. They must be byte-identical.
2. Apply the migration as one transaction. It takes ACCESS EXCLUSIVE NOWAIT locks on thread/message tables before snapshots/backfill and a one-second lock timeout. If traffic conflicts or an exact existing-function prerequisite has changed, the entire migration aborts. Retry the same migration when idle only after confirming the previous transaction rolled back.
3. The data backfill creates number-pair owners and stamps existing messages. A ready message is stamped only if its thread is the sole active thread for the exact account/number pair. Retired/ambiguous queued messages receive no revision. No existing thread is retired/reassigned, no consent is renewed, and no new seller response is sent by this migration.
4. Deploy the app/API/UI change after the migration, so activity reads do not reference missing tables/RPCs.
5. Verify schema/function availability, account ownership, existing manual controls, and new review UI without sending a test text. Normal already-authorized orchestration may then prepare eligible seller threads. Do not manufacture a new provider test, cost reservation, or outreach authorization.

SQL functions patched: seller-contact prepare conflict target; authority-review conflict target and exact property selection; operational-contact projection conflict target; inbound event routing; normal and customer claim route gate; explicit SMS queue/prepare entry lock order; practice-reply source revision. The patch uses only named SMS functions, never catalog-wide definition discovery. All new objects/RPCs are service-only.

Do not revert to the old global phone-pair resolver or drop the new uniqueness/ownership boundary after multiple property threads exist. Prefer a forward correction; retain immutable history and routing holds while investigating.

## Verification performed

- Isolated PGlite SQL with the actual base messaging, seller-intake consent, AI enqueue, property-signal, and practice-reply definitions; narrow stubs for unrelated wrappers.
- Separate consent/account/property requirements; duplicate prepare/queue/provider retries; preserved manual Crozier-like thread; normalized explicit and ambiguous routes; no AI/signal trigger work for unbound messages; stale queue/source CAS; immutable history; cross-account/mixed-role rejection; global STOP; late delivery-before-acceptance receipt; single-property regression.
- Seeded pre-migration ready message remains eligible while sole-active and becomes stale when the second property is added; retired queue never grandfathered.
- Owner review account/actor authorization, stale revision, repeated action, preserved unbound quote, and STOP preservation.
- API origin/authentication/body/tenant/CAS tests, activity pagination, actual React server-render escaping and safe attachment allowlist.
- Existing messaging, sender routing, AI policy, property policy, manual recovery, voice/SMS context, workspace assistant/view/attention tests.
- TypeScript no-emit and production webpack build passed.

Limitations: PGlite serializes one database connection; concurrent Promise calls test idempotency but do not prove multi-transaction PostgreSQL lock behavior. No installed native PostgreSQL server was available. Full production function-chain integration and browser click-through were not run. The default Turbopack build failed on the local shared-node_modules symlink; the supported webpack build passed. No provider calls, real SMS, charges, live database application, push, or deployment were performed for this change.
