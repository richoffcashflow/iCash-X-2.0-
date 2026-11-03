# Support reply audit — November 2, 2026

The owner requested a review of actual support replies. A read-only review covered 248 automated replies across 34 conversations over three days. Common failures included unrelated lead-upload answers, lost follow-up context, seller/buyer agreement confusion, incorrect product limitations, and advice to pay again despite a recently recorded software payment.

## Changes

- Answer product questions from current implementation: business identity, work credits, seller calls, buyer assignment documents, offer calculations, buyer packages and title email coordination. Keep feature explanations separate from evidence that an account action happened.
- Resolve short requests against the active issue or the exact bot-status check just offered. Preserve actual blockers and explicit topic changes.
- Distinguish work-credit top-ups from subscription/VIP payments, legacy VIP from a claimed 2.0 VIP purchase, and a requested receipt from a submitted receipt.
- For a recorded recent software payment with unconfirmed access, require matching the payment and access period before recommending another checkout. This does not grant access or establish a valid paid period.
- Reject observed contradictory model claims and flag the same patterns in the operator quality view. These flags are review signals, not proof that a customer problem is fixed.

## Verification and boundaries

Anonymized offline replays exercise the public reply engine with model access disabled or a local stub. Cases cover correct answers and negative boundaries: new topics, real call blockers, buyer/title calling restrictions, unresolved failures, cancellation, guest privacy, old payments and unverified entitlement claims. The four new audit suites are included in the release verifier and automatic test discovery.

This release changes reply generation and quality signals only. It does not send retrospective customer messages, modify conversations, grant access, cancel subscriptions, retry payments, change outreach or run paid provider tests. Earlier unresolved account problems still require their own verified resolution.
