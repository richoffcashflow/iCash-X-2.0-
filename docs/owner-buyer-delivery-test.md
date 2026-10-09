# Owner buyer delivery test

This release keeps the signed deal's buyer-outreach hold active. An explicitly provisioned, service-only test authorizes one canonical package SMS and email to the account owner's previously verified phone and confirmed account email. It does not create buyer consent, DNC evidence, a buyer profile, or an outbound buyer call.

The test has its own buyer thread, sharing a sender pair only under that exact authorization. The seller records stay unchanged. Replies and incoming calls use buyer context after the package has an actual provider acceptance receipt. The scope expires within four hours or can be revoked by setting `revoked_at`. The last test reply cannot become a seller reply after expiry. Normal seller routing remains on its existing sender.

Both channels use the application's existing dispatch services, atomic spending claims and delivery hooks. The package link and total price are checked against the completed purchase agreement at dispatch. Duplicate build runs cannot send duplicates. Unknown provider outcomes stay in review. Only deterministic, received-message-bound factual SMS responses are admitted; manual sends and all other buyer outreach retain the hold.

The one-time deployment runner is restricted to production/main, one existing account/deal, and a cutoff of October 10, 2026 UTC. No owner test is provisioned by a migration, public endpoint, or client permission. Production credentials stay on the server. Live provider acceptance and delivery receipts must be inspected separately from the isolated test results.

Buyer replies also now enter the buyer reply queue instead of being intercepted by the seller acquisition campaign.

Verification: `node --experimental-strip-types scripts/test-buyer-disposition-pglite.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js`. The fixture blocks all network traffic and covers the real SQL claims, exact owner bindings, price, duplicate claims, expiry, opt-out, tenant isolation, the preserved buyer hold, buyer routing, and header validation.
