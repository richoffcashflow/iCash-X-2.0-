# Buyer deposits and seller viewing availability

Status: production migrations applied; application deployment and provider gate pending. Base production commit: `9e7044631d22b542757839f32e285486ef39f237`. Branch: `feat/buyer-deposit-viewing-slots-20261009`.

Production access recovered after the owner authorized shipping. Both migrations applied successfully on October 9 at 2:28 PM Central. The live deal has one completed purchase and no issued buyer assignment. The service-role package returns a $2,000 deposit, optional viewing, no seller windows yet and no reservation. The real-buyer test hold remains active. No delivered messages were resent.

Production access checks confirm anonymous users cannot read either new table or call deposit confirmation, and the service role cannot insert receipts directly. The security advisor reports the intentional private-table RLS/no-policy informational finding and an existing leaked-password-protection warning. See the [RLS advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Behavior

- After verified purchase signatures, the existing seller confirmation asks for viewing dates, AM/PM times and timezone. A returning signed seller goes to viewing coordination instead of a new purchase negotiation.
- Seller SMS and completed, identity-bound calls save availability. Only unambiguous future dates and times reach the public package and buyer AI. Ambiguous dates, DST transitions, changes and cancellations require clarification or review; raw seller messages stay private.
- The existing seller SMS lane can acknowledge exact windows or ask for clarification while preserving consent, routing, pause, STOP and human-request checks.
- Buyer visits are optional. The AI can proceed toward the buyer assignment and payment instructions without requiring a showing. Selecting a window is still a request for a specific visit, not a booked appointment.
- Buyer price includes the assignment fee. Buyer closing costs remain additional under the signed agreements.
- New buyer agreements use `min(round(assignmentFeeCents / 5), 500000)`. A $10,000 fee requires a $2,000 deposit. Buyer copy gives the dollar amount without the formula or cap. The original assignment form credits this deposit toward the assignment fee. Existing issued or executed agreements are not rewritten.
- Payment choices are check, wire, Cash App and Zelle. Receiving details must be supplied by the verified deal contact. This release records verified receipt; it does not initiate transfers or invent payment accounts.
- Buyer requests for an agreement, or claims that payment was sent, appear in dashboard attention. A report does not reserve the property.
- In **Viewing times & buyer deposit**, the account owner can save seller-provided windows and confirm the exact cleared deposit against the current signed assignment. Receipt is immutable and idempotent; only one buyer reservation can exist per deal.
- Verified receipt stops new package SMS/email dispatches and buyer search claims and marks the public package reserved. Existing signed-buyer and title communication keeps its existing permissions. Previously dispatched provider operations may finish.
- The AI identifies itself as the contract holder's assistant. It does not claim to own the property or invent a financial partnership.

## Local verification

- 87 focused tests passed, including buyer price/closing-cost wording, deposit math and cap, optional visits, API owner scope/CSRF, payment claims, call identity, buyer package photos and existing SMS trust checks.
- `scripts/test-buyer-purchase-pglite.mjs` passed against both real new SQL files. Covers seller capture/withdrawal, date/DST validation, signed seller SMS controls, private quote isolation, immutable call evidence, buyer intent, exact signed deposit, all four methods, duplicate receipt rejection, marketing/search holds and SQL privileges.
- `tsc --noEmit --pretty false` and `git diff --check` passed.
- Next.js webpack compile mode passed with application network fetches disabled. The default local Turbopack attempt failed because this workspace's `node_modules` symlink points outside its filesystem root. No production build or visual browser/handset result is claimed.

## Remaining release work

1. Completed: inspect production deal and issued assignment state before changing the schema.
2. Completed: apply both migrations in order, run security advisors and check table/function privileges. Local migration filenames match the production-assigned versions: `20261009192829_buyer_purchase_terms_and_reservations.sql`, then `20261009192835_seller_viewing_availability_and_buyer_intent.sql`.
3. Keep the real-buyer testing hold and existing delivery history. Do not resend delivered signature/package notifications. The active owner test has its existing October 9 expiration; a seller-availability backfill on that same number must not collide with buyer test routing.
4. Publish the branch for review and run the revised bounded provider gate. Version 2 requires the existing successful version 1 evidence, the new live package fields and the exact reviewed voice-agent version. Four mocked-tool simulations cover terms, all-in-price challenge, no viewing and an unverified payment claim. Version 2 has **not run**. Inspect any started/failed marker before further attempts. If the October 10 UTC run window has elapsed, review the fixture and timing before updating that window; do not silently replay an ambiguous attempt.
5. Deploy, verify the production alias/commit, and test the actual seller availability → buyer package/call → dashboard request flow. Confirm payment only from real cleared-funds evidence and a signed buyer assignment. No fake deposit or production receipt should be inserted for testing.

The local SQL test needs a PGlite module path:

```sh
node --experimental-strip-types scripts/test-buyer-purchase-pglite.mjs /path/to/@electric-sql/pglite/dist/index.js
```
