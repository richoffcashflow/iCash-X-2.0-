# Beginner property workspace

The existing disclosure-card design is retained. Card previews show a provider street-view image when available; expanded cards show saved cash-offer estimates, repair costs, the property-value estimate used for ARV, saved seller call notes, messages, and the next step. Unknown values remain unknown. No comparable-sales dataset is currently saved in screening results; the UI says so rather than inventing comps.

## Imagery

DealMachine documents `images.street_view`, `images.satellite`, and `images.roadmap` as always-included response fields: https://api.docs.dealmachine.com/concepts/response-format#images . We use only returned street-view or satellite URLs from `https://img.dealmachine.com`, never constructed URLs or guessed coordinates. Map views are not used as property photos. Provider origin, URL scheme, path type and credential-free URL are checked. Google may return a gray placeholder with HTTP 200; missing imagery cannot always be detected from load errors.

New normalized property records retain the validated image field. Older records without imagery use `/api/work/property-photo?screeningId=...`. The endpoint first verifies the signed-in account owns that completed screening, then checks existing normalized/raw imagery. It otherwise performs a single five-second, non-redirecting `GET /v1/properties/{storedPropertyId}?enrich=false&contact_audience=none` with the existing server key. DealMachine documents this preview as no-credit base data: https://api.docs.dealmachine.com/api-reference/properties/get-property . No contact lookup, enrichment, write, retry or customer credit charge is introduced.

A bounded account-and-screening-scoped in-memory cache retains successful photo metadata for 15 minutes and missing/failure results for one minute, deduplicates in-flight reads, and limits each account to 12 unique cache misses per minute per runtime instance. It is not a deployment-wide durable quota. No photo results are reused across customer accounts. Credentials and raw property payloads never leave the route. The image is loaded directly by the browser without a referrer; Next's image proxy is not used. Missing or failed images have a neutral placeholder. Explicit workspace Refresh allows another image attempt; background activity polling does not repeat it.

## Simpler controls

The main workspace no longer renders the generic requirement checklist, evidence-submission form, or showing-proposal creation controls. Their server APIs, records and all permission, suppression, offer, jurisdiction, signing and budget enforcement remain unchanged. This is not approval to contact someone, make a binding offer or sign a contract.

Contract preparation is hidden during initial property research. Existing signing envelopes and active/signed deal stages retain access. A draft with a saved seller name, positive agreed-price amount and `seller_reported` provenance can expose preparation. After taking over an early property, the user can explicitly reveal preparation with “Seller is ready for an agreement”; that local reveal changes no records and sends nothing. Once exposed within a property, the tools stay mounted through refresh so edits are not lost. Buyer qualification stays behind a completed real purchase envelope.

“Bot-managed” describes management mode, not proof that the account is running. The global status continues to show actual paused/readiness/balance state. Take over pauses new property work; already-started operations may finish. Return to bot preserves all existing admission checks.

## Verification

Tests use synthetic data. Photo route tests cover tenant ownership, actual stored property IDs, mismatched provider records, invalid origins, provider failure, and private responses. Cache tests cover deduplication and account separation. Contract visibility and presentation tests cover early hidden controls and existing contract access. Production provider images and visual browser behavior must be separately checked after an authorized preview deployment.

## Customer-facing labels

Customer labels use “Property photo,” “Property data” and “Contact data.” The provider name stays in normalized records, API provenance, tests and internal implementation, but is not rendered as an application-added customer badge or explanation. Provider images are still displayed whole with object-fit:contain; original image bytes, copyright marks and proprietary notices are not cropped, covered, removed or altered. This does not establish broader white-label licensing rights. The public terms reviewed October 2, 2026 prohibit removing proprietary notices (section 2(e)): https://www.dealmachine.com/terms-of-service . No separate requirement for our own added badge was found in the image API documentation; any applicable contracted display attribution remains a release requirement.
