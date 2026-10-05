# Hybrid acquisition and live workspace controls

Owner-authorized release, 2026-10-05. Inbound submissions retain priority. Outbound property-only high-equity discovery fills a bounded supply shortfall; paid owner enrichment follows an eligible financial screen. Outbound properties belong to one account. Existing inbound distribution remains capped at three distinct recipients, with immediate / 24-hour / 72-hour delivery, except that later submissions of an exclusive outbound property remain with its original account.

## Budget and scope

- Existing 3× cost-based pricing and immutable historical charges remain intact.
- New searches and owner enrichment share a rolling research allowance of 25% of the account's daily limit. Wallet, daily, platform, permission and rate reservations still apply atomically. Existing reservations stay held for reconciliation if dispatch cannot be confirmed.
- Pipeline target is 2–20 financially eligible property records per rolling day, scaled by daily budget. This is a pacing target, not a guarantee of contacted, interested or qualified sellers. Existing backlog limits and follow-up priority remain.
- Target inbound share rises from 20% below $25/day, to 35% below $50/day, to 50% at $50/day and above. Actual availability, market fit, affordability, waiting time and distribution fairness determine delivery. No fake work or minimum daily charge is created.
- Known ZIP geography is required. The private exclusion table conservatively holds CT, IL, IA, MN, NE, OK, OR, PA, SC, UT, VA and WI for this repeated, automated, unlicensed wholesale model. Requirements differ: some concern public marketing, volume, registration or representation. This is not a legal determination that other states have no requirements. Source URLs and review dates are stored with each exclusion.
- Seller addresses lacking an explicit recognizable state remain saved for review before paid lookup. State names, abbreviations, ZIPs and optional US country suffixes are recognized.
- No account is unpaused or funded by this release. Retired infinite-hold metadata jobs remain historical; a new bounded cycle can begin for running accounts.

## Contact and interface

Fresh paid DealMachine owner results already feed the enabled national-only DNC observation adapter. A missing or positive DNC flag never becomes clearance. State DNC coverage, recipient permissions, suppression/STOP, contact hours, campaign, data rights, recording and dispatch checks remain separate. No receipt, consent, license or provider success is manufactured.

The property feed presents names and properties consistently without acquisition-source badges or lead-age labels. Saved contact provenance remains available in details and the backend. Outbound scripts must not describe a purchased prospect as a seller request.

The full-width monochrome workspace bar contains Run / Stop and the daily-budget popup entry. Authenticated polling exposes only current task labels from unexpired consumed tickets and running screening leases. Dots animate only during recorded active work. Paused, waiting, stale and failed status reads never fabricate activity. Stop remains available during refresh failures and retains existing pause/billing cancellation semantics.

## Verification and rollout

`npm test`, TypeScript and the production build cover existing flows. `scripts/test-hybrid-acquisition-pglite.mjs <installed-pglite-module>` applies the complete migration to isolated production-schema/function metadata and synthetic records; it tests priority, budgets, state parsing, paid-boundary rules, actual exclusive persistence, source separation and private permissions without calling providers.

Apply the migration before deploying code with `ICASH_ACQUISITION_MODE=hybrid`, `ICASH_DISCOVERY_WORK_READY=true` and `ICASH_CONTACT_WORK_READY=true`. Existing live-work/SMS/recording release settings remain in place. Provider-policy and rate expirations remain effective; enabling acquisition does not extend them. A production end-to-end call is not established by an isolated database or UI test.
