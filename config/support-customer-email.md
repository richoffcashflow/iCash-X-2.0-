# Customer support reply email

Production sends a transactional notification after each saved assistant or operator reply. The reply and one email job are committed atomically. Status-only changes do not send mail. Existing owner copies remain independent.

Guest access help uses the email entered on the support form. The notification contains no customer-authored text or account details. Its private link opens only that support conversation, without creating an account or proving payment. Guest support may contain sign-in guidance, public product/migration guidance, and the approved legacy offer after a trusted operator explicitly reviews original purchase proof; email link possession never authorizes account, billing or purchase changes.

The link secret travels in a URL fragment to a standalone page without analytics. The page removes the fragment before exchanging it in a same-origin POST for a Secure, HttpOnly support cookie. Links last 30 days, work across devices, and are reusable so mail scanners cannot consume them. Each browser session lasts 7 days; replying renews it. The original browser stays valid. Only a SHA-256 digest of each proof is used for lookup. The frozen provider payload temporarily holds the email URL for exact retries and is cleared on confirmed acceptance, a delivery receipt, or final review.

Account support resolves the current verified account-owner email through Auth. Its email links to `/support?threadId=...`; normal account authentication and tenant checks still apply, including older threads outside the recent list.

Configuration uses the existing verified `geticashx.com` sender, `ICASH_RELIABILITY_FROM_EMAIL`, `ICASH_AUTH_EMAIL_READY`, Resend API key and signature-verified delivery webhook. `ICASH_SUPPORT_CUSTOMER_EMAIL_ENABLED=false` pauses dispatch. Preview dispatch is always disabled. Customer email does not depend on the owner-copy switch. Never log return tokens or frozen email payloads.

Next.js `after` starts delivery after the saved response, and the minute maintenance job recovers pending/expired leases. Every provider retry reuses the same payload and `support-customer-<job ID>` idempotency key, at most six attempts and strictly within 23 hours of the first authorization. An ambiguous outcome is never resent after that window. Recipient changes, bounces, complaints and suppressions stop sends and remain visible in the support desk. Provider acceptance is displayed separately from confirmed delivery. Guest notification authorization also has a 30-per-recipient daily bound.

The rollout migration queues only the latest reply in up to 50 guest conversations that are currently waiting on the customer and updated within the last day. It does not send old histories or resolved conversations.

Verification: `tests/support-customer-notifications.test.mjs` exercises real SQL and routes with mocked Auth/Resend, including lost receipts, private cross-device access, expiry, original-browser continuity, manual/automatic replies, suppressions and permissions. The access-help browser scenario uses built pages with intercepted APIs, covers mobile layouts, return-link retries/expiry, and the account thread deep link. No paid provider tests are permitted.
