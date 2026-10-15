# Contract self-service and cancellation notices

Customers take over a property, open Documents, edit and save draft terms, then use Send for signatures. Signer email is optional and retained for transaction updates. The manual signing check keeps source consent, suppression, rate and ownership checks while permitting a seller thread paused by takeover. It does not restart automation or change issued documents.

New cancellation requests atomically save an outbox alongside the existing cancellation hold. Only actual live agreement signers receive notices; the account owner's signing recipient is excluded. A verified closing contact receives email when the cancellation has title activity. Assignment-only cancellation preserves the seller agreement and sends buyer SMS/email only. Seller calls remain the only outbound AI call path.

The messaging cron processes up to 12 notices every five minutes with three workers. Existing SMS/email adapters retain sender identity, reply routing, delivery webhooks, account admission and usage settlement. Missing signer email can be added through an owner-bound, explicitly confirmed action. There is no backfill of historical cancellations, no guessed contact address and no transmission of internal cancellation reasons, purchase prices or assignment fees.

Requested notices describe a request; completion notices report the owner's recorded cancellation. They do not create a release or return deposits. Unsent request notices are superseded on completion. Already accepted or uncertain sends are never rearmed. Provider uncertainty remains visible rather than causing an automatic resend.

A cancellation call is bound to its notice, account, seller phone, property and current cancellation status. It uses the existing reviewed recorded-call service with a 120-second maximum and actual-use billing. Acquisition underwriting is irrelevant to this notification and is narrowly exempted without inventing financial evidence. Membership, positive credits, Run/Pause, current voice configuration, contact permission, hours and opt-outs remain required. The script is limited to the cancellation update and cannot negotiate or promise a refund. An uncertain call is never automatically redialed. Completion never adds a second seller call.

The owner-only course preview now includes an inert editing, sending and cancellation walkthrough. It uses fictional values and no account, messaging, signature or payment APIs.

Validation: actual new PostgreSQL migration in isolated PGlite, actual signing/voice/notice service fixtures, existing cancellation reconciliation and account isolation checks, full verified build, and desktop/mobile browser flows. Development makes no paid provider calls. Production rollout applies `20261015225502_agreement_cancellation_notifications.sql` before releasing the app, then checks exact-commit CI, deployment health and private endpoint behavior.
