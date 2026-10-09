# Buyer deposits and seller viewing availability

Status: the core release is live at `2b606b9bfbf6f5246c29abe805f45678a220bf78` through PR #127. All four version 3 provider simulations passed, and the production package, photo and voice authentication checks passed. The earlier version 2 failure remains in the audit history. Final handset acceptance and real seller viewing windows remain outstanding; real-buyer outreach is held.

The October 9 seller-follow-up refinement tells buyers without available viewing slots: “We'll check with the seller and get back to you with available viewing times.” Buyers can wait for seller options without choosing a preferred time. Call and SMS requests still create dashboard attention, including the bare question “What times are available?” The dashboard directs the team to contact the seller and return with options. This is a team coordination request; no seller contact, returned message or booked visit is fabricated. The database refinement applied as `20261009202931_buyer_viewing_seller_followup`; the application build adds one bounded provider simulation for this path and retains the unchanged successful four-simulation fixture.

The buyer-confidence/title refinement follows the owner's 3:22 PM Central call (`d6913388-da56-4d46-862d-659ba980e2cd`). The stored transcript contains a soft-timeout “One moment,” followed by the caller's “Hello?” before the terms. The exact delay still requires provider timing and handset verification. Read-only get_offer now uses the existing capability-bound context RPC directly when the call is already bound; an unbound or denied call still passes canonical provider binding and a fresh authority check. This cuts three serial database requests to one for an already bound buyer. The mandatory opening is shorter but retains identity, exact price, separate buyer closing costs, date and deposit credit. Follow-up answers are one or two direct sentences. Provider settings, price guardrails and seller mutation verification remain unchanged.

The title company is currently unselected. Buyers are asked about prior wholesale assignment experience and may suggest the local company they used. Exact company/contact statements appear in dashboard attention alongside any viewing or payment request. The proposal does not select/verify a closer, send outreach, open title or change signed terms. Current selected/needs-confirmation states prevent an incorrect “unselected” claim. Migration `20261009204722_buyer_title_company_preferences` applied and the production service-role reply and private privileges passed. The new seven-case provider gate replaces the two older buyer gates in build:verified; it checks their preserved successful markers before running once with the revised fixture. All 13 focused local checks, real migration integration and TypeScript passed. Live handset pacing remains an acceptance check; no zero-pause guarantee is implied.

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

## Release history and remaining acceptance

1. Completed: inspect production deal and issued assignment state before changing the schema.
2. Completed: apply both migrations in order, run security advisors and check table/function privileges. Local migration filenames match the production-assigned versions: `20261009192829_buyer_purchase_terms_and_reservations.sql`, then `20261009192835_seller_viewing_availability_and_buyer_intent.sql`.
3. Keep the real-buyer testing hold and existing delivery history. Do not resend delivered signature/package notifications. The active owner test has its existing October 9 expiration; a seller-availability backfill on that same number must not collide with buyer test routing.
4. PR #126 preview passed. All four version 2 simulations completed and failed because the AI omitted its role introduction; the no-viewing scenario also omitted the closing date. The payment-claim transcript additionally claimed agreement delivery without evidence. The failed run remains intact under `buyer_terms_provider_test_20261009_v2` (fixture `03d8766fd5f6033a7e8b2478c93549229946ff027112498864f0fbf7eb10e180`). The correction gives one complete exact spoken opening, explicit unsent agreement status and a buyer team-preparation response that cannot invoke seller signing. Version 3 uses action-specific mock responses and adds delivery-claim checks; it requires the exact terminal version 2 evidence before one new bounded run. No failed/ambiguous marker is reset. If the October 10 UTC run window has elapsed, review timing before any new run.
5. Completed core deployment: `dpl_8fdsSv2fYrMUPDN96P83gvacSic4` became READY on www.geticashx.com. Version 3 passed all four simulations with fixture `0b29538870801362088fef06e629bac7249ff8be3aa5ce804899340dfe1248b5`. A final handset test of seller availability → buyer package/call → dashboard request is still required. Confirm payment only from real cleared-funds evidence and a signed buyer assignment. No fake deposit or production receipt should be inserted for testing.

The local SQL test needs a PGlite module path:

```sh
node --experimental-strip-types scripts/test-buyer-purchase-pglite.mjs /path/to/@electric-sql/pglite/dist/index.js
```
