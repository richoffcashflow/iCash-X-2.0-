# Daily-budget workspace release

The workspace centers Run bot / Pause bot. Run opens the daily-budget slider; an active plan exposes its budget beneath Pause. Pausing uses the existing atomic work-and-billing stop and preserves unused credits. Daily funding remains separate from the $50 monthly membership. The daily claim now accepts a paid membership account without changing its membership billing model. Stopped plans are not restarted by this release.

Bot activity reports Leads, Calls, Texts and Contracts. Property cards explicitly label Cash offer price. Seller contact has Call and Text actions with one conversation panel. Lead email controls are removed. Missing contacts and load errors have retry/help routes. SMS length accounting supports normal punctuation and contract URLs while enforcing one segment.

## Contract text integration status

Phone signer support uses DocuSeal SMS delivery and phone verification. It requires a permitted, unambiguous thread for the same account, deal, party and number. Live sending additionally requires a reviewed rate containing at least $0.40 in messaging allowance per phone signer (the provider's published $0.20 initial SMS and $0.20 verification SMS). Additional verification messages can incur additional provider costs. Existing rates were not silently increased, and DOCUSEAL_MODE was not switched to live.

The per-call contract-text endpoint can queue only the next pending counterparty's provider-verified link for the exact approved agreement. It derives the account, deal and contact from a bound, unexpired call token. It rejects test envelopes, changed terms, manual takeover and suppressed contacts. A database delivery record prevents duplicate SMS queueing for the same envelope and signer. Responses distinguish provider acceptance from confirmed delivery. The endpoint cannot create an agreement, change terms or sign for a party.

This endpoint is prepared but is not attached to the production voice agent. Recorded-call approval was observed disabled, and the ElevenLabs API key is write-only through the connected environment API. Provider registration, an approved configuration update and an authorized end-to-end call test remain outstanding. Signing was observed in the default test mode. No real seller call, text, signing request or payment was made during verification.

## Verification

- Daily budget UI, billing and checkout retry tests.
- Workspace rendering and manual-call permission/takeover tests.
- PGlite daily paid-claim tests: membership preserved, unpaid membership blocked, paid limits/caps, pause replay and stopped-plan behavior.
- Contract/SMS PGlite tests: alphabet limits, idempotency, tenant and signer isolation, opt-out, call token binding, manual takeover, test isolation and private grants.
- Signing policy/service tests and phone-delivery fixtures: provider payload, wrong number, test/live separation, permission and pricing holds.
- TypeScript and production build checks; live workspace inspected after deployment.

Whop was researched as a possible future payment provider. No Whop integration or payment-provider migration is included in this release.
