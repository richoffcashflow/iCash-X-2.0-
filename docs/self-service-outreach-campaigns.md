# Customer-owned outreach channels

Apply `config/self-service-outreach-campaigns.sql` after the deployed operational contact, operational SMS, saved DealMachine observation, and recording-v4 migrations. This migration creates no customer choices, acknowledgments, contact permissions, recipient consent, jobs, provider calls, or account activation.

## Customer behavior

In **Outreach channels**, the signed-in account owner chooses either:

- **Outbound AI calls + SMS:** permits the software to use those selected channels when the existing contact, provider, daytime, opt-out, and budget checks pass. This mode does not generate inbound-call invitations.
- **SMS + inbound-call invitations:** retains the existing bounded SMS owner/interest sequence and invitation workflow. Outbound AI calls remain off.

The customer explicitly confirms the operational responsibilities and saves. No operator release is required for this new configuration. Saving preserves account pause, wallet balances and reservations, daily/spending limits, and the separate Start action. It does not establish recipient consent or independently verify the customer's identity or legal suitability.

The server derives account/owner from the authenticated session and the sending principal from the stored customer profile. An immutable channel-selection receipt binds the owner, account, principal, mode, actual creation time, and current responsibilities receipt. Existing historical SMS-only receipts retain their original text and date. Selecting outbound never reinterprets an old receipt as outbound authorization. No customer is automatically converted; the existing owner can make the real visible choice after release.

Changing the stored principal or account owner invalidates the prior configuration. The current owner can review and save a choice for the updated principal. Repeated identical saves reuse the same receipt without claiming a new acceptance time. `reviewed_principal` is neither populated nor treated as independent verification by this flow.

## Atomic behavior

Voice queue candidates and the final voice claim require a current outbound choice. The final wrapper delegates to the released claim chain, retaining DNC/STOP, daytime, budgets, provider review, offer and buyer authority, and recording controls. It rechecks the channel choice after the inner claim; a concurrent change rolls back a stale claim. Customer choice writes use budget, account, then identity lock order, matching dispatch. The existing customer identity RPC serializes changes on the same account row.

SMS-capable predicates cover both choices. Invitation creation and invitation-message claims retain the SMS-inbound-only predicate, so switching to outbound holds previously queued invitations. Existing operator-reviewed SMS-only configurations remain supported; their historical review fields are not rewritten.

The migration does not inspect protected reserve/bootstrap definitions or incoming configuration. Its exact runtime definition reads are the explicitly listed existing SMS predicate/queue functions and the two existing voice queue functions. The new final-claim wrapper is source-defined. No provider, caller-identity, recording-consent, signing, property-marketing, or buyer-qualification rule is relaxed.

## Access

New functions are security invoker with an empty search path. PUBLIC, anon and authenticated cannot execute the new RPCs. Service role can read/insert the new immutable channel-selection table and execute the scoped RPCs; it receives no UPDATE/DELETE/TRUNCATE privilege on that table and no new evidence-table write grants. The table uses RLS, and its update/delete trigger preserves historical receipts. Browser users reach the new writer only through the existing same-origin, authenticated endpoint with a strict mode/version/accepted body.

## Validation

- The API and component-handler tests cover explicit choice/confirmation, version mismatch, origin and owner scope, repeated clicks, loading/errors, mode changes, persisted readback, and unmount.
- The SQL integration uses the actual released core, DNC adapter, and recording migration. It covers owner/principal binding, old receipt preservation, immutable records, pause/wallet preservation, no fabricated contact permission, SMS-only voice exclusion, real voice reserve/final claim and SMS final claim, and DNC/STOP holds.
- `bash scripts/run-operational-locks-postgres.sh campaign` additionally verifies a native PostgreSQL two-session race: a channel change holds the lock while the final voice claim waits; committing SMS-only causes the waiting claim to fail without dispatch.
- `node --experimental-strip-types scripts/test-self-service-campaigns-pglite.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js` runs the isolated SQL suite without any network or provider calls.

This does not represent a completed customer-funded production outreach run. An account with zero available credits remains unable to start new paid work, and an old DNC observation remains stale after selecting channels.
