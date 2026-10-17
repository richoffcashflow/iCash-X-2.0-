# Webinar messaging — October 16, 2026 (America/Chicago)

Status: implemented and locally verified; the owner explicitly approved publication, migrations and production deployment on October 17, 2026. Release checks and deployment evidence are recorded with the release pull request. No customer messages were sent during development. The earlier daily/quiet-hours proposal is superseded by the owner's immediate/15-minute, any-hour request.

## Final behavior

| Journey | First message | Final message | Stops when |
| --- | --- | --- | --- |
| Webinar departure | Immediately after a saved departure signal | 15 minutes after the first provider-accepted send | Viewer returns or advances to checkout/purchase |
| Abandoned webinar checkout | Immediately after a saved departure signal | 15 minutes after the first provider-accepted send | Viewer returns or buys |
| Purchased VIP session | Verified paid purchase, if the buyer has not entered their paired VIP session | 15 minutes after the first provider-accepted send | Buyer enters VIP, upgrades, loses paid access, or replies |
| Reply asking to join | Immediate personal join link, including paid VIP | No extra automatic sequence | Duplicate provider events are ignored; STOP and support requests are handled separately |

These webinar sends have no time-of-day, hourly or daily scheduling block. Each automatic stage can send at most two messages, with one opted-in channel per opportunity and at most six across the journey. Returning ends the pair; repeated exits cannot restart it. Any reply cancels pending automatic nudges on both channels. Checkout and purchase supersede earlier stages. Fresh, explicit channel consent describes the instant/15-minute timing at any hour. Historical opt-ins are not silently expanded.

The departure endpoint authenticates the visitor/session, records an ordered per-page signal, and dispatches after the response. The existing once-per-minute maintenance worker handles the final reminder and recovers missed close beacons after a two-minute heartbeat lease. Therefore the final reminder is eligible at 15 minutes and normally picked up within the next minute; exact carrier or inbox delivery cannot be guaranteed. Payment-provider handoffs and wallet/3DS tab switches have a grace lease to avoid treating an active payment as abandonment. Explicit page closes still report departure. Multiple tabs and matching contact identities suppress duplicate/active-viewer sends. Preview sessions cannot enroll or dispatch.

VIP enrollment requires a canonical live paid membership with a recorded settled invoice, a stored paired VIP destination, and no prior attendance. Purchase notices do not grant paid VIP plan benefits. A delivered VIP link issues a short-lived video-only capability, scoped to that paired session and rechecked against current membership on entry. It never issues an account session or restores another device's funding identity. Refund/review/cancellation blocks new entry. Existing customer-update activation must preserve VIP recovery jobs.

The sender retains STOP, signed one-click unsubscribe, suppression/bounce/complaint checks, sender identity, property-conversation isolation, durable one-use authorization, immutable email retries and no retry of ambiguous SMS attempts. Automatic messages expire rather than accumulating after an outage. The second reminder is scheduled from the accepted first send, not signup or an unsuccessful attempt.

## Verification

Local PostgreSQL scenarios cover overnight departure, accepted-send timing, early-send prevention, checkout advancement, purchase races, VIP attendance, paid-link revocation, renewals, join/support replies, duplicate authorization, channel alternatives, stale beacons, multiple tabs/devices, missing-beacon fallback, payment handoff, STOP/unsubscribe, historical consent and private RPC grants. Client, route and sender fixtures cover ordered lifecycle events, preview/auth isolation, immediate dispatch, video-only token scope, provider errors, idempotency and the existing purchase/return flow. The maintenance worker reuses its existing schedule; no extra cron invocation is added. Validation passed: the full required local release gate, TypeScript (`tsc --noEmit`), 30 focused messaging/purchase tests, three verified-webhook fixture suites, and the real PostgreSQL migration scenarios. No real provider tests are used.

## Production dependencies

Read-only inspection found geticashx.com verified in Resend, the combined delivery/reply webhook enabled, and two enabled text senders. The business mailing address remains blank, so email sending is not ready; SMS can be used for eligible recipients after release. No business address was invented.

The owner's explicit October 17 approval authorizes publishing the prepared branch, applying both messaging migrations in order and deploying. The existing production release gates remain enabled.
