# Fresh SMS sender capacity preference

The first SMS allocation previously selected an eligible business number using only a deterministic account/screen/recipient hash. A full sender could therefore be selected while another eligible sender had room. This change prefers current cold-SMS room for a wholly new route, with the original hash and phone order as the tie-breaker. If every eligible sender is full, it retains the original selection: final admission can still recognize a permitted warm or requested contact.

Capacity is a read-only ordering hint, not a reservation or permission to send. The existing sender `take`/final admission remains authoritative and rechecks volume, recipient, funding and other controls. Hourly/daily limits, pacing, contact windows, suppression, health, account and role isolation, dual-channel capability and all receipt handling stay intact.

The preference is disabled for voice, any existing exact active thread or prior AI/customer call identity, any saved SMS route for the recipient, and any exact historical thread (including a retired thread). Existing empty or paused threads are therefore never moved to another sender. An orphan saved route or retired exact thread retains the prior deterministic ordering. This migration performs no backfill, reservation, provider call, historical replay or route repair.

## Deployment

Apply `supabase/migrations/20261117145243_fresh_sender_capacity_preference.sql` once using a migration runner that atomically records its history in the same transaction. The config mirror is `config/fresh-sender-capacity-preference.sql`; neither file contains an outer transaction because the runner owns it. The migration was generated with the Supabase CLI.

The only replaced function is `public.icash_business_conversation_sender(uuid,uuid,text,boolean)`. The migration checks its exact source, STABLE/invoker status, empty search path, ACL and the existing `icash_sender_private.room(text,boolean,uuid,text)` prerequisite. It preserves owner and privileges and verifies the resulting definition. A changed prerequisite must be reviewed; do not bypass the guard.

- Required source MD5: `6d502484d3cd54f65d165e4a15f0497b`.
- Result source MD5: `87daa991e681ead18f0575b79116e60c`.
- Preserved ACL: `{postgres=X/postgres,service_role=X/postgres}`.

This is compatible with the existing selector signature and is used immediately by current callers after migration. It needs no frontend or worker runtime change. The separately deployed deferred-SMS batch and voice-capacity changes have their own prerequisites. Reverting this preference requires another reviewed forward migration; it must not rewrite established identities.

## Validation

Run `node tests/fresh-sender-capacity-preference.test.mjs`. The test loads the exact prior function, rejects source and ACL drift, applies the actual migration in a runner-owned transaction and verifies the resulting source/metadata. It exercises fresh capacity preference, all-full fallback, voice continuity, empty/paused/retired threads, orphan routes, both prior-call histories including unknown outcomes, health rejection, disabled senders, dual-channel capability, roles, account ownership, all suppression types and read-only selection. Dependencies are fixture-backed; no paid provider work occurs.

Read-only native Postgres projections on November 17, 2026 used the unchanged eligible-sender predicates, all ten currently eligible senders and 1,003 sender-use records in the trailing 24 hours. A synthetic recipient/account/screen avoided customer payloads and any route mutation. `EXPLAIN (ANALYZE, BUFFERS)` measured the old and proposed order on current production indexes; the proposed function was not installed for this measurement.

| Projection | Original execution | Capacity ordering execution |
| --- | ---: | ---: |
| One selection, first sample | 4.63 ms | 11.06 ms |
| One selection, repeat | 7.11 ms | 7.45 ms |
| Forced ten selections with successive sender exclusions and existing health calls | 73.17 ms | 160.73 ms |

The forced-rejection projection exercises all ten bounded iterations regardless of current health. Its planning time was 22.07/66.38 ms; cached runtime function plans are not measured by that standalone projection. These are point-in-time measurements, not an end-to-end scheduler throughput claim. Warm projections incurred zero shared-block reads. The current volume aggregate used `sender_volume_window (sender, admitted_at) INCLUDE (cold)` via an index-only scan; a sample completed in 0.73 ms. Capacity ranking adds bounded read work and does not change the final locked admission. Existing `service_role` schema usage and room-execute privileges were verified.
