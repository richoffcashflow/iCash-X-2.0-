# Findable purchase access

The owner requested two access emails and a sign-in text because new buyers often cannot find their account link. The first purchase confirmation remains immediate. One additional email is due 15 minutes after the first email is accepted, only while the paid membership is still unclaimed. Both emails have a searchable “iCash X login link” subject, a large account button and the visible permanent URL `https://www.geticashx.com/access`. The same checkout email and existing code verification are still required.

A first live purchase also queues one short SMS when its saved webinar phone has explicit text permission and is bound to the purchasing browser/account. The final send rechecks that phone, permission, STOP suppression, payment and the enabled messaging setting. The existing stable sender assignment protects property conversations. The SMS contains the permanent sign-in URL and payment-email instructions; it contains no account token or one-time code.

The new private follow-up outbox is independent of the original confirmation, so a text failure cannot prevent the purchase email. It is enrolled only by new first-purchase confirmation inserts: no historical backfill, renewal or test-payment sends. A unique membership/channel pair caps the additional messages. Email retries use frozen content and a stable provider key, stop after six attempts and stay inside 23 hours. An authorized SMS is never automatically replayed after a timeout or missing receipt. Uncertain attempts remain reviewable. Signed delivery events use the existing receipt store, including events arriving before the send result is saved; email bounces and complaints are shared with suppression checks.

The existing immediate post-settlement wake starts both delivery paths independently. The minute maintenance job has a separate follow-up lane to recover pending work. The held webinar-return release in PR #303 remains separate.

Validation: actual PostgreSQL settlement and queue functions with synthetic transports cover message counts, timing, account claiming, absent/mismatched permission, phone changes, STOP after claim, refund holds, sender-role collisions, duplicate wake-ups, renewals, preview exclusion, email idempotency, ambiguous SMS results, lost receipt writes, early delivery callbacks and private grants. No real customer email, SMS, OTP, call or payment was sent in development.

Migration `20261017152224_purchase_access_reminder_and_text` was applied and read back in production. RLS is enabled; anonymous table and RPC access are denied; service-only queue access is granted. The text setting is enabled and two sender numbers are available. No historical follow-up rows were created.

Checkout phone formatting is normalized for comparison using the same country-code rules as the webinar contact form. Formatting never changes the actual saved SMS recipient or upgrades permission. Fixtures cover formatted international and US national numbers as well as mismatches.

Migration `20261017152700_purchase_access_phone_normalization` was also applied and read back; anonymous execution remains denied.
