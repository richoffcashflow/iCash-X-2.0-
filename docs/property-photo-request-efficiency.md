# Reuse fetched property image metadata

The customer property-photo route previously skipped the saved metadata read
used by owner inspection. Once the fifteen-minute lookup cache expired, opening
a property with no image in its original snapshot could fetch the same free
DealMachine metadata again.

The route now uses the existing account-and-screening-scoped
`icash_read_photo_cache` read and existing URL validation inside its ordinary
bounded in-memory lookup cache. Concurrent and repeated requests reuse that cache
before any metadata read. A valid saved image avoids a provider request and
a new persistent lookup lease. This is image display metadata only: it does not renew
financial, contact, consent, or source evidence. Reusing a URL does not extend
any validity enforced by its image host.

The authenticated account and completed screening are checked before the read.
Missing or invalid saved metadata uses the original cached/leased lookup. A
failed database read remains a bounded null-photo result and cannot trigger a
provider request. Stored
snapshot images still take precedence and need no extra read.

The behavioral route regression fails on the original implementation because a
saved image triggers another provider lookup. It verifies no lookup or lease for
valid saved metadata, real in-memory cache coalescing and reuse, the exact account/screening read, invalid/missing metadata,
read failures, unauthenticated requests, and the original stored-image fast path.
The existing persistent-cache and photo-validation suites cover leases and URL
validation. No provider requests or paid development tests are required.
