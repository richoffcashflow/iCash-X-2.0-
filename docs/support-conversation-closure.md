# Support conversation closure

The owner requested automatic cleanup and shorter, natural replies on October 20, 2026.

- Inactive means waiting on the customer for at least 24 hours, with an actual support reply as the latest turn. Open troubleshooting, unanswered messages, active guest reply claims, operator-required guests and pending cancellation reviews are excluded.
- Each maintenance pass closes at most 100 eligible account chats and 100 eligible guest chats. Eligibility precedes the limit; locked rows and final message checks protect new replies.
- A system notice explains closure and reopening. History is retained. Inactivity creates no customer email job.
- Refund-only repetition gets the policy, then one warning, then a closing reply. Fixed rules—not model discretion—require actual earlier policy replies. New facts, cancellation requests, unresolved history and adverse payment evidence prevent this shortcut. A repeated complaint is not proof it was fixed.
- Closed is distinct from resolved. Account and guest customers can reply to reopen. Operator inbox separates Closed and preserves trusted-operator controls. Closing support does not cancel subscriptions or pause work.

## Release

Apply the exact committed `20261020185200_support_conversation_closure.sql` after exact-main Reliability success and before the new application is promoted. The guarded SQL expands existing statuses and retains existing authorization/receipt checks. It does not close chats during installation; the existing authenticated maintenance lane starts cleanup with the compatible application. Never replay the migration. Inspect history and schema first.

Validation uses local PGlite and mocked services/browsers; no paid development calls, texts or email. The regression includes older ineligible candidates ahead of eligible chats, batch boundaries, idempotency, reopening, late replies after operator closure, email fanout exclusion and private ACLs. PGlite does not establish real multi-session throughput.
