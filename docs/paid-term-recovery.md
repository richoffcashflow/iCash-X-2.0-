# Finite recovery of an already-paid software and VIP term

The November 8 owner decision authorizes restoring one disputed-cancellation customer's original paid software and VIP term, without another payment or restarting outreach. This is service recovery, not a finding about who initiated the original cancellation.

## Boundaries

`icash_restore_paid_term` requires the exact live canceled membership, existing account, account-bound support case, original $50 software invoice, applied $50 VIP upgrade, unchanged original paid/VIP end, a currently paused account, no conflicting active entitlement, no unresolved review of either original payment, and an explicit operator authorization reference. The end must still be in the original remaining term and within 32 days. Installing this migration grants no account access.

The operation writes an immutable audit and a separate membership identified by `consent_version=paid-term-recovery-v1`. It does not change the original canceled membership, subscription, payment, acceptance, wallet, customer identity or Pause. The new row has no Stripe customer, subscription, checkout or invoice linkage. Its existing price field describes the restored VIP tier; it is not a new charge. Its consent text explicitly records an owner decision, not a fabricated customer acceptance. No payment/access email is queued by the billing status route.

The active row uses existing software and VIP admission predicates. Both expire exactly at the recorded end, regardless of cleanup scheduling. The first account-bound membership lookup after expiration marks only that recovery canceled so a later explicitly requested checkout is not blocked by an expired grant. Cancellation remains available without invoking Stripe. The audit, account, original dates, and nonrenewing shape cannot be rewritten, and replay never reactivates a canceled or reviewed grant.

Membership Settings displays the finite end in the viewer's local time with AM/PM, no automatic renewal and no new subscription charge. It does not offer recurring retention, VIP plan changes or a payment-management portal for the recovery. An explicit new checkout after the recovered term is a separate customer decision.

A later unresolved review of either original payment suspends the recovery and pauses the account, using the account lock shared by creation. Resolution of that review does not automatically reactivate the recovery.

## Release and operation

1. Run focused schema, service, settings and billing-route tests, the complete regression aggregate, type checks, and native PostgreSQL concurrency checks. No paid provider tests.
2. Independently review the exact diff. Keep normal release checks intact.
3. Apply the reviewed migration through the established Supabase path. Verify private ACLs and migration receipt. Installation has no grants to customers.
4. Release and verify the matching production application before using the operator function. Do not activate while the old UI still presents recurring billing controls.
5. Re-read the exact account, case, original subscription/charges, invoice, upgrade, dates, Pause and existing recoveries. Stop on any change inconsistent with the approved remedy.
6. Call the function once with the exact identifiers and authorization reference. On uncertainty, inspect the immutable source-bound recovery before retrying. A known duplicate returns the same entitlement without extending or reactivating it.
7. Verify original membership/subscription remain canceled, both original charges are unchanged, software and VIP admission are true through the exact approved end, no financial/ownership/Pause changes, and the customer-facing recovered-access presentation. Only then send the authorized apology in the original case.

No restoration, message delivery, successful login or production release should be claimed from an offline test alone.
