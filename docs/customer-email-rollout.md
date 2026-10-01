# Customer-branded deal email

Shipped code supports neutral-domain customer sender identities and signed per-message reply addresses. Domain ownership/DNS and real delivery have not been verified by these code checks.

## Production configuration

- `ICASH_CUSTOMER_EMAIL_DOMAIN`: owned, Resend-verified sending domain (hostname only).
- `ICASH_CUSTOMER_REPLY_DOMAIN`: Resend receiving-enabled domain/subdomain; defaults to sending domain.
- `ICASH_CUSTOMER_EMAIL_READY=true`: enable only after sending DNS and receiving MX are verified.
- Existing `RESEND_API_KEY` and `RESEND_RECEIVING_WEBHOOK_SECRET` remain server-only.
- Keep legacy `ICASH_TITLE_FROM_EMAIL` and `ICASH_TITLE_REPLY_EMAIL` for title-opening/qualification emails and existing threads. This change brands customer deal emails; it does not rewrite the separate title coordination service.

## Behavior

The display name is the account's actual principal/business. A stable `contact-<account hash>@domain` sender separates customers without provisioning individual inboxes. Replies use `r-<message>-<signature>@reply-domain`; the sender and original outbound record are checked by the existing account/deal-scoped receiving function. Changed subjects do not break signed routing. Direct unsolicited mail to the From address is not yet an inbox entry point. Existing subject-tagged replies remain supported.

Signed routing authenticates the destination, not the person sending the reply. Existing sender matching and email authentication checks remain required. Incoming content never changes payment instructions or runs arbitrary tools. Rotating the receiving signing secret also invalidates old signed reply addresses; plan rotation/migration before changing it.

## Webhook subscriptions

Use the existing `/api/webhooks/title-email` endpoint with `email.received`, `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`, and `email.failed`. Configure them in Resend; deploying code does not add subscriptions.

Events are signature-checked, deduplicated, and retained if they arrive before the outgoing provider ID is saved. Delivery status does not modify acceptance/billing state. Complaints and permanent bounces suppress later deal emails for that account/address. Suppression has no customer-facing override.

## Verification completed

- Neutral sender names, different account identities, changed-subject routing helper.
- Invalid signatures, wrong domains, duplicate destinations and disabled configuration.
- Existing dispatch/idempotency/unknown-delivery handling.
- Rollback database fixtures: early webhook reconciliation, duplicate events, complaint precedence, tenant-scoped suppression, preserved acceptance state.
- Local production build.

Before enabling: connect owned domain, verify DNS, add webhook subscriptions, and send one authorized message/reply. No live email was sent in this implementation task.
