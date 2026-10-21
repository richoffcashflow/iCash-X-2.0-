# Support conversation closure

The owner requested automatic cleanup and shorter, natural replies on October 20, 2026.

- Inactive means waiting on the customer for at least 24 hours, with an actual support reply as the latest turn. Open troubleshooting, unanswered messages, active guest reply claims, operator-required guests and pending cancellation reviews are excluded.
- Each maintenance pass closes at most 100 eligible account chats and 100 eligible guest chats. Eligibility precedes the limit; locked rows and final message checks protect new replies.
- A system notice explains closure and reopening. History is retained. Inactivity creates no customer email job.
- Refund-only repetition gets the policy, then one warning, then a closing reply. Fixed rules—not model discretion—require actual earlier policy replies. New facts, cancellation requests, unresolved history and adverse payment evidence prevent this shortcut. A repeated complaint is not proof it was fixed.
- Closed is distinct from resolved. Account and guest customers can reply to reopen. Operator inbox separates Closed and preserves trusted-operator controls. Closing support does not cancel subscriptions or pause work.

## Refund evidence and abusive repetition (October 21)

- After a real policy explanation, a refund-only reply containing profanity can receive the final closing response immediately. Ordinary repetition still gets one warning. Profanity alongside a new billing, access, cancellation or software problem does not override the existing unresolved-issue checks.
- The final response summarizes only verified account records: researched properties and incoming seller leads remain distinct; current course/software access is separate from recorded playback and completed work. Guests receive no private account facts. Never call researched prospects motivated sellers, claim a completed deal, or treat an active plan as proof a feature worked.
- Authenticated refund conversations automatically prepare a bounded private snapshot of purchase references, recorded policy acceptance, service delivery, authenticated access and completed usage. It is saved atomically in the existing assistant-message evidence field, including missing-record and truncation notes. No schema change is needed. Replaying a saved response does not regenerate the snapshot.
- “You accepted” requires an actual live final-sale acceptance linked to a paid purchase, with acceptance no later than the recorded payment. The original policy is retained; the claim is about the recorded purchase, not an inferred identity or every historical charge. No acceptance receipt means no agreement claim.
- Operators can inspect the saved snapshot in the conversation. The existing Stripe dispute PDF/JSON automatically includes a matching account/thread delivery snapshot, labeled as account-lifetime context. Its original disputed-payment-specific payment and terms checks remain authoritative. Preparation never submits evidence or contacts Stripe on the customer's behalf.

## Release

Apply the exact committed `20261020185200_support_conversation_closure.sql` after exact-main Reliability success and before the new application is promoted. The guarded SQL expands existing statuses and retains existing authorization/receipt checks. It does not close chats during installation; the existing authenticated maintenance lane starts cleanup with the compatible application. Never replay the migration. Inspect history and schema first.

Validation uses local PGlite and mocked services/browsers; no paid development calls, texts or email. The regression includes older ineligible candidates ahead of eligible chats, batch boundaries, idempotency, reopening, late replies after operator closure, email fanout exclusion and private ACLs. PGlite does not establish real multi-session throughput.
