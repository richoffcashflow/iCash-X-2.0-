# Title partner discovery and qualification

Released service-only partner directory and qualification queue. Initial candidates are First Option Title (TX/AZ, phone/contact form only) and CLOSED Title (published office email and website-listed states). These are first-party researched candidates, not verified partners or a promise of coverage. Sources: https://www.1stoptiontitle.com/ and https://www.closedtitle.com/investors . Contact evidence expires in 30 days.

After a signed purchase and current disposition authority, the existing preparation worker queues at most two suitable directory companies and attempts at most one inquiry per run. It asks about assignments, coverage, fees, documents, escrow and a named closer. No seller names, addresses, contracts, wire details or private attachments are included. No partner is auto-approved from a search result or email acceptance. A claim checks Stop, recipient binding, credit/cash reservation, and duplicate company/market inquiries across accounts within 30 days. Unknown outcomes never auto-retry. Directory rejection disables further inquiries; inbound opt-out ingestion is not yet implemented and the reply mailbox requires monitoring.

When no usable inquiry is pending, the worker can fall back to Google Places Text Search (New), using only `places.id` with a five-result cap, one attempt per deal. An existing unexpired directory candidate prevents additional Google spending. Only place IDs are stored, not restricted Google business content. Place IDs require subsequent contact research against first-party sources before addition to the qualification directory. This contact enrichment is not yet automated. No map content is displayed. Sources: https://developers.google.com/maps/documentation/places/web-service/text-search and https://developers.google.com/maps/documentation/places/web-service/policies .

## Required platform configuration
- GOOGLE_PLACES_API_KEY, server-only, with Places API (New) enabled and restricted to that API. No key was supplied or tested in this release.
- Existing RESEND_API_KEY; ICASH_TITLE_FROM_EMAIL on a verified sending domain; ICASH_TITLE_REPLY_EMAIL pointing to an actually monitored receiving inbox. Resend sending capability alone is not inbound mail monitoring.
- Operating funds must be recorded; the current zero balance remains a paid-work block.
- Qualification responses, verified coverage, named closer and recipient confirmation must be recorded before a company becomes qualified. Transaction-specific title contact binding still precedes signed document delivery. Reply parsing and automatic partner approval are not implemented.

## Documentation-based rates
25 cents per qualification inquiry, title email, or ID-only lookup. Each is separately admitted against the account-level margin pool and company funds. Total quote per email $0.0345; 20% buffer rounded up reserves $0.05. Search omits the $0.001 email allowance. Resend allowance is $0.001/send; platform, payment (6.6%), support, acquisition and dispute allocations are estimates, not invoices. Google ID-only SKU has no added lookup component under the published IDs-only pricing; changing the field mask requires a new quote. DocuSeal signing is a separate operation, never double-counted here. Fixed plan fees remain allocated at portfolio level as documented in signing-provider-cost.md.

No inquiries or paid searches were performed. Mock email and fulfillment tests and production build passed. Remaining functionality is stated above; this release is not end-to-end autonomous title closing.
